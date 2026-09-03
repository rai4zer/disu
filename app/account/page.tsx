import { redirect } from "next/navigation";

/**
 * `/account` moved to `/profile` when it became a module of its own ("My
 * Profile") rather than a link tucked next to sign-out in the market strip.
 *
 * This redirect stays because the old path is still reachable from outside the
 * app's own navigation: a bookmark, and — the case that would actually break —
 * a Google OAuth round-trip already in flight, whose signed `state` carries
 * `nextPath: "/account"` from before the deploy. Those users come back to a
 * path this build no longer has a page for, and the honest fix is to forward
 * them rather than to 404 someone mid-sign-in.
 */
export default function AccountRedirect() {
  redirect("/profile");
}
