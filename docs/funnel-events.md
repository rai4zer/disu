# Funnel events

How DISU measures its own funnel, why it is a second event stream rather than a
column on the first, and what you have to do when you add an event.

Roadmap item: §2.6 Observability, "Product analytics".

## The problem this solves

`recordEvent()` (`app/lib/db/events.ts`) writes to `events` through
`userScoped()`, which takes a user id as its first argument and cannot express a
row without one. That is deliberate and correct for an audit log.

It also makes `events` structurally incapable of holding a funnel. The two
numbers that tell you whether the funnel works — how many people arrived, and how
many of them opened the sign-up form — belong to people who do not have an
account yet. `events.user_id` is `not null references users(id)`; there is no
value to put there.

So there are two streams, and keeping them apart is not tidiness:

| | `events` | `analytics_events` |
|---|---|---|
| Subject | what a user did to their account | a step in a funnel |
| `user_id` | `not null` | nullable |
| Lawful basis | legitimate interest (security/audit) | **consent only** |
| Retention | life of the account | 180 days (`ANALYTICS_RETENTION_DAYS`) |
| Tenant scoping | `userScoped()` | none — write-only, never read per user |
| Written from | anywhere | only where a request is in scope |

Some facts land in both, on purpose. A sign-in is an audit record of who used the
account *and* a funnel step; they are written separately because they are held
under different bases and deleted on different schedules.

## The consent rule

**No funnel row is written without analytics consent, and consent is read from
the request that caused the event.**

The privacy policy names consent as the only basis DISU uses for analytics, so a
first-party stream is in exactly the same position as the GA4 tag. The gate lives
in `analyticsAllowed()` (`app/lib/analytics/funnel-store.ts`) and every write path
goes through it — a gate you have to remember is a gate that ships open.

Two consequences worth knowing before you add an event:

- **You need a request.** `quant_run` and `primer_run` are recorded at enqueue in
  the API route rather than on completion in `app/lib/jobs/processor.ts`, because
  the worker runs minutes later with no request, no consent cookie, and therefore
  no lawful basis to write anything.
- **Adding a new *kind* of measurement means bumping `CONSENT_VERSION`.** A
  recorded yes was an answer to the purposes as they stood. Extending what
  `analytics` covers invalidates it. Adding a ninth event of a kind already
  described does not; adding cross-visit tracking, or sending the data to a
  vendor, does.

## The anonymous id

`disu_anon_id` — a random UUID in `sessionStorage`, created only after analytics
consent and deleted the moment it is withdrawn
(`app/lib/analytics/anon-id.ts`, `app/components/consent-provider.tsx`).

`sessionStorage`, not a cookie and not `localStorage`: it is never attached to
another request, and it dies with the tab. That is enough to link the steps of one
visit — which is what a funnel measures — and it structurally cannot follow anyone
to their next visit, a capability the funnel does not need and would have to be
justified separately.

When a signed-out visitor's event arrives, the route attaches their user id if a
session happens to be present. That is what joins the anonymous half of the
funnel to the signed-in half.

## The closed shape

`POST /api/analytics/events` is unauthenticated by necessity — the top of a
funnel has no session. Everything unusual about it follows from that:

- **Only `origin: "client"` events.** A browser may post `landing_view` and
  `signup_start`. `signup_complete` is the number the funnel is judged on, so a
  client that could post it could forge the metric.
- **Declared properties only.** Every event names its properties in
  `FUNNEL_EVENT_SPECS`, and each value is an enum member, a short slug or a
  bounded count. An open `properties` bag on a public write path is a PII leak
  waiting for a careless call site. Anything undeclared is dropped — the *event*
  still counts, because dropping it would let a broken client silently zero out a
  funnel step.
- **Paths are routes, not URLs.** The query string is discarded (it carries reset
  tokens and OAuth codes) and identifier segments collapse to `:id` (they
  re-identify the person the anonymous id was meant to keep anonymous).
- **Rate limited by IP**, before the consent check, so a caller with no consent
  does not get an unmetered endpoint.
- **204 whatever happens**, except on malformed input, where a 400 turns a
  silently-dead metric into an obvious bug in development.

## Adding an event

1. Add it to `FUNNEL_EVENTS` and `FUNNEL_EVENT_SPECS` in
   `app/lib/analytics/funnel.ts`, with an `origin` and a `measures` line.
2. Declare its properties there too. If you want free text, you want a different
   feature.
3. Server-side: `void recordFunnelEvent(request, "name", { userId, path, properties })`
   in the handler. Never in the job worker.
4. Client-side (only for an `origin: "client"` event): `useFunnelEvent("name")` on
   mount, or `useFunnelTracker()` for an interaction
   (`app/lib/analytics/track.ts`).
5. If it is a new *kind* of measurement, bump `CONSENT_VERSION` and update the
   analytics section of `app/lib/legal/privacy-document.ts`.
6. `tests/funnel-events.test.ts` covers the taxonomy and the gate.

## Reading the funnel

There is no dashboard yet — that is the next bullet in §2.6. Until then, query
Supabase directly; `analytics_events_name_created_at_idx` is the access path:

```sql
select name, count(*) as events, count(distinct coalesce(user_id, anon_id)) as people
from analytics_events
where created_at > now() - interval '7 days'
group by name
order by events desc;
```

Two things to remember when reading the numbers:

- They only cover visitors who agreed to analytics. Treat them as a ratio between
  steps, never as an absolute count of people.
- `holding_added` is the activation step. An account that never reaches it is a
  dead account, whatever the signup number says.
