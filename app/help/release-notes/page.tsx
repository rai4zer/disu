"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "../page.module.css";

type ReleaseNote = {
  id: string;
  slug: string;
  locale: "en" | "sv";
  title: string;
  bodyMarkdown: string;
  publishedAt: string | null;
};

type ReleaseNoteAdmin = {
  id: string;
  slug: string;
  status: "draft" | "published";
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  translations: Array<{
    locale: "en" | "sv";
    title: string;
    bodyMarkdown: string;
  }>;
};

type FeatureRequest = {
  id: string;
  userId: string | null;
  message: string;
  status: "new" | "planned" | "done" | "rejected";
  sourcePage: string | null;
  createdAt: string;
  updatedAt: string;
  votes: number;
  comments: number;
};

type FeatureRequestComment = {
  id: string;
  featureRequestId: string;
  userId: string | null;
  message: string;
  createdAt: string;
  updatedAt: string;
};

type SessionState = {
  authenticated: boolean;
  user?: { id: string; email: string };
};

type FeatureStatus = "new" | "planned" | "done" | "rejected";
type FeatureFilter = "all" | FeatureStatus;

function formatDate(value: string | null, language: "en" | "sv"): string {
  if (!value) return language === "sv" ? "Opublicerad" : "Unpublished";
  return new Date(value).toLocaleDateString(language === "sv" ? "sv-SE" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function splitInline(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^\)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    if (start > last) tokens.push(text.slice(last, start));
    const token = match[0];

    if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
      if (linkMatch) {
        const href = linkMatch[2].trim();
        const isSafe = href.startsWith("http://") || href.startsWith("https://");
        tokens.push(
          <a key={`${start}-link`} href={isSafe ? href : "#"} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>
        );
      } else {
        tokens.push(token);
      }
    } else if (token.startsWith("`")) {
      tokens.push(<code key={`${start}-code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      tokens.push(<strong key={`${start}-strong`}>{token.slice(2, -2)}</strong>);
    } else {
      tokens.push(token);
    }

    last = start + token.length;
  }

  if (last < text.length) tokens.push(text.slice(last));
  return tokens;
}

function renderMarkdown(markdown: string): React.ReactNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push(<h3 key={`h3-${key++}`}>{splitInline(line.slice(4))}</h3>);
      i += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(<h2 key={`h2-${key++}`}>{splitInline(line.slice(3))}</h2>);
      i += 1;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(<h1 key={`h1-${key++}`}>{splitInline(line.slice(2))}</h1>);
      i += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("- ")) {
        items.push(<li key={`li-${key++}`}>{splitInline(lines[i].trimStart().slice(2))}</li>);
        i += 1;
      }
      blocks.push(<ul key={`ul-${key++}`}>{items}</ul>);
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      paragraphLines.push(lines[i].trim());
      i += 1;
    }
    blocks.push(<p key={`p-${key++}`}>{splitInline(paragraphLines.join(" "))}</p>);
  }

  return <div className={styles.markdown}>{blocks}</div>;
}

function translationFor(note: ReleaseNoteAdmin, locale: "en" | "sv") {
  return note.translations.find((item) => item.locale === locale);
}

export default function HelpReleaseNotesPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  const [session, setSession] = useState<SessionState>({ authenticated: false });
  const [isAdmin, setIsAdmin] = useState(false);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [adminNotes, setAdminNotes] = useState<ReleaseNoteAdmin[]>([]);
  const [featureRequests, setFeatureRequests] = useState<FeatureRequest[]>([]);
  const [commentsByRequest, setCommentsByRequest] = useState<Record<string, FeatureRequestComment[]>>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [requestStatuses, setRequestStatuses] = useState<Record<string, FeatureStatus>>({});
  const [featureFilter, setFeatureFilter] = useState<FeatureFilter>("all");
  const [featurePage, setFeaturePage] = useState(1);
  const [featureHasMore, setFeatureHasMore] = useState(false);
  const [featureLimit] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState("");
  const [editingReleaseId, setEditingReleaseId] = useState<string | null>(null);
  const [adminForm, setAdminForm] = useState({
    slug: "",
    status: "draft" as "draft" | "published",
    sourceLocale: (isSv ? "sv" : "en") as "en" | "sv",
    title: "",
    bodyMarkdown: ""
  });
  const [adminEditForm, setAdminEditForm] = useState({
    status: "draft" as "draft" | "published",
    sourceLocale: (isSv ? "sv" : "en") as "en" | "sv",
    title: "",
    bodyMarkdown: ""
  });

  const loginHref = useMemo(() => `/auth/login?next=${encodeURIComponent("/help/release-notes")}`, []);

  const refreshData = useCallback(async () => {
    setLoading(true);
    try {
      const [authRes, notesRes, requestsRes, adminRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch(`/api/release-notes?locale=${language}`, { cache: "no-store" }),
        fetch(
          `/api/feature-requests?limit=${featureLimit}&page=${featurePage}&status=${encodeURIComponent(featureFilter)}`,
          { cache: "no-store" }
        ),
        fetch("/api/admin/me", { cache: "no-store" })
      ]);

      if (authRes.ok) {
        const authJson = (await authRes.json()) as SessionState;
        setSession(authJson);
      } else {
        setSession({ authenticated: false });
      }

      const notesJson = (await notesRes.json()) as { notes?: ReleaseNote[] };
      const requestsJson = (await requestsRes.json()) as { requests?: FeatureRequest[]; hasMore?: boolean };
      const adminJson = (await adminRes.json().catch(() => ({ isAdmin: false }))) as { isAdmin?: boolean };

      const nextRequests = requestsJson.requests ?? [];
      setNotes(notesJson.notes ?? []);
      setFeatureRequests(nextRequests);
      setFeatureHasMore(Boolean(requestsJson.hasMore));
      setRequestStatuses(
        nextRequests.reduce<Record<string, FeatureStatus>>((acc, item) => {
          acc[item.id] = item.status;
          return acc;
        }, {})
      );

      const hasAdmin = Boolean(adminRes.ok && adminJson.isAdmin);
      setIsAdmin(hasAdmin);

      if (hasAdmin) {
        const releaseAdminRes = await fetch("/api/admin/release-notes", { cache: "no-store" });
        const releaseAdminJson = (await releaseAdminRes.json().catch(() => ({}))) as {
          releaseNotes?: ReleaseNoteAdmin[];
        };
        if (releaseAdminRes.ok) {
          setAdminNotes(releaseAdminJson.releaseNotes ?? []);
        }
      } else {
        setAdminNotes([]);
      }
    } finally {
      setLoading(false);
    }
  }, [featureFilter, featureLimit, featurePage, language]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    setFeaturePage(1);
  }, [featureFilter]);

  async function submitFeatureRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sourcePage: "/help/release-notes" })
      });

      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || (isSv ? "Kunde inte skicka förslag." : "Failed to submit request."));
      }

      setMessage("");
      setStatusMessage(isSv ? "Tack, ditt förslag är skickat." : "Thanks, your request was submitted.");
      await refreshData();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : isSv ? "Något gick fel." : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(requestId: string) {
    const response = await fetch(`/api/feature-requests/${requestId}/vote`, { method: "POST" });
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean; created?: boolean; error?: string };
    if (!response.ok || !json.ok) {
      setStatusMessage(json.error || (isSv ? "Röstning misslyckades." : "Vote failed."));
      return;
    }

    setFeatureRequests((prev) =>
      prev.map((item) => {
        if (item.id !== requestId) return item;
        return { ...item, votes: json.created ? item.votes + 1 : item.votes };
      })
    );

    setStatusMessage(
      json.created
        ? isSv
          ? "Röst registrerad."
          : "Vote registered."
        : isSv
          ? "Du har redan röstat på detta förslag."
          : "You already voted for this request."
    );
  }

  async function toggleComments(requestId: string) {
    const nextOpen = !expandedComments[requestId];
    setExpandedComments((prev) => ({ ...prev, [requestId]: nextOpen }));
    if (!nextOpen || commentsByRequest[requestId]) return;

    const response = await fetch(`/api/feature-requests/${requestId}/comments`, { cache: "no-store" });
    const json = (await response.json().catch(() => ({}))) as { comments?: FeatureRequestComment[] };
    if (response.ok) {
      setCommentsByRequest((prev) => ({ ...prev, [requestId]: json.comments ?? [] }));
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    const draft = (commentDrafts[requestId] ?? "").trim();
    if (!draft) return;

    const response = await fetch(`/api/feature-requests/${requestId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: draft })
    });

    const json = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      comment?: FeatureRequestComment;
    };

    if (!response.ok || !json.ok || !json.comment) {
      setStatusMessage(json.error || (isSv ? "Kunde inte skicka kommentar." : "Failed to add comment."));
      return;
    }

    setCommentDrafts((prev) => ({ ...prev, [requestId]: "" }));
    setCommentsByRequest((prev) => ({
      ...prev,
      [requestId]: [...(prev[requestId] ?? []), json.comment!]
    }));
    setFeatureRequests((prev) =>
      prev.map((item) => (item.id === requestId ? { ...item, comments: item.comments + 1 } : item))
    );
  }

  async function updateRequestStatus(requestId: string, nextStatus: FeatureStatus, previousStatus: FeatureStatus) {
    if (!nextStatus) return;
    const confirmed = window.confirm(
      isSv
        ? `Uppdatera status till "${nextStatus}"?`
        : `Update request status to "${nextStatus}"?`
    );
    if (!confirmed) {
      setRequestStatuses((prev) => ({ ...prev, [requestId]: previousStatus }));
      return;
    }

    const response = await fetch(`/api/admin/feature-requests/${requestId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus })
    });

    const json = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      request?: FeatureRequest;
    };

    if (!response.ok || !json.ok || !json.request) {
      setRequestStatuses((prev) => ({ ...prev, [requestId]: previousStatus }));
      setAdminMessage(json.error || (isSv ? "Status kunde inte uppdateras." : "Failed to update status."));
      return;
    }

    setFeatureRequests((prev) => prev.map((item) => (item.id === requestId ? json.request! : item)));
    setRequestStatuses((prev) => ({ ...prev, [requestId]: json.request!.status }));
    setAdminMessage(isSv ? "Status uppdaterad." : "Status updated.");
  }

  async function createAdminReleaseNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdminBusy(true);
    setAdminMessage("");

    try {
      const response = await fetch("/api/admin/release-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: adminForm.slug,
          status: adminForm.status,
          sourceLocale: adminForm.sourceLocale,
          title: adminForm.title,
          bodyMarkdown: adminForm.bodyMarkdown
        })
      });

      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || (isSv ? "Kunde inte skapa release note." : "Failed to create release note."));
      }

      setAdminForm({ slug: "", status: "draft", sourceLocale: adminForm.sourceLocale, title: "", bodyMarkdown: "" });
      setAdminMessage(isSv ? "Release note sparad." : "Release note saved.");
      await refreshData();
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : isSv ? "Något gick fel." : "Something went wrong.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function publishReleaseNote(id: string) {
    const confirmed = window.confirm(
      isSv ? "Publicera denna release note nu?" : "Publish this release note now?"
    );
    if (!confirmed) return;
    setAdminBusy(true);
    setAdminMessage("");
    try {
      const response = await fetch(`/api/admin/release-notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "published" })
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || (isSv ? "Kunde inte publicera." : "Failed to publish."));
      }
      setAdminMessage(isSv ? "Publicerad." : "Published.");
      await refreshData();
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : isSv ? "Något gick fel." : "Something went wrong.");
    } finally {
      setAdminBusy(false);
    }
  }

  function startEditReleaseNote(note: ReleaseNoteAdmin) {
    const sourceLocale: "en" | "sv" = isSv ? "sv" : "en";
    const selected = translationFor(note, sourceLocale) ?? translationFor(note, "en") ?? translationFor(note, "sv");
    setEditingReleaseId(note.id);
    setAdminEditForm({
      status: note.status,
      sourceLocale,
      title: selected?.title ?? "",
      bodyMarkdown: selected?.bodyMarkdown ?? ""
    });
    setAdminMessage("");
  }

  async function saveEditedReleaseNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingReleaseId) return;
    const confirmed = window.confirm(
      isSv ? "Spara ändringar för release note?" : "Save changes to this release note?"
    );
    if (!confirmed) return;
    setAdminBusy(true);
    setAdminMessage("");
    try {
      const response = await fetch(`/api/admin/release-notes/${editingReleaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: adminEditForm.status,
          sourceLocale: adminEditForm.sourceLocale,
          title: adminEditForm.title,
          bodyMarkdown: adminEditForm.bodyMarkdown
        })
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || (isSv ? "Kunde inte spara ändringar." : "Failed to save changes."));
      }
      setAdminMessage(isSv ? "Release note uppdaterad." : "Release note updated.");
      setEditingReleaseId(null);
      await refreshData();
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : isSv ? "Något gick fel." : "Something went wrong.");
    } finally {
      setAdminBusy(false);
    }
  }

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Versionsnyheter" : "Release notes"}
        subtitle={
          isSv
            ? "Senaste ändringar i funktioner, stabilitet och UX."
            : "Latest changes in features, stability, and UX."
        }
      >
        {isAdmin ? (
          <section className={`${styles.card} appSection`}>
            <h2>{isSv ? "Adminverktyg" : "Admin tools"}</h2>
            <p className={styles.sectionHint}>
              {isSv
                ? "Skriv i ett språk. Översättning till andra språket skapas automatiskt."
                : "Write in one language. The other locale is generated automatically."}
            </p>
            <details className={styles.adminComposer}>
              <summary>{isSv ? "Ny release note" : "New release note"}</summary>
              <form className={styles.adminFormGrid} onSubmit={createAdminReleaseNote}>
                <div className={styles.inlineFields}>
                  <input
                    className={styles.feedbackMinimalInput}
                    value={adminForm.slug}
                    onChange={(event) => setAdminForm((prev) => ({ ...prev, slug: event.target.value }))}
                    placeholder="slug (e.g. 2026-03-05-release)"
                  />
                  <select
                    className={styles.adminSelect}
                    value={adminForm.sourceLocale}
                    onChange={(event) =>
                      setAdminForm((prev) => ({ ...prev, sourceLocale: event.target.value === "sv" ? "sv" : "en" }))
                    }
                  >
                    <option value="en">{isSv ? "Engelska" : "English"}</option>
                    <option value="sv">{isSv ? "Svenska" : "Swedish"}</option>
                  </select>
                  <select
                    className={styles.adminSelect}
                    value={adminForm.status}
                    onChange={(event) =>
                      setAdminForm((prev) => ({ ...prev, status: event.target.value === "published" ? "published" : "draft" }))
                    }
                  >
                    <option value="draft">draft</option>
                    <option value="published">published</option>
                  </select>
                </div>
                <input
                  className={styles.feedbackMinimalInput}
                  value={adminForm.title}
                  onChange={(event) => setAdminForm((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder={adminForm.sourceLocale === "sv" ? "Titel" : "Title"}
                />
                <textarea
                  className={`${styles.feedbackMinimalTextarea} ${styles.compactTextarea}`}
                  value={adminForm.bodyMarkdown}
                  onChange={(event) => setAdminForm((prev) => ({ ...prev, bodyMarkdown: event.target.value }))}
                  placeholder={adminForm.sourceLocale === "sv" ? "Markdown-innehåll" : "Markdown content"}
                />
                <div className={styles.feedbackMinimalRow}>
                  <button type="submit" className={styles.feedbackMinimalButton} disabled={adminBusy}>
                    {adminBusy ? (isSv ? "Sparar..." : "Saving...") : isSv ? "Skapa" : "Create"}
                  </button>
                  {adminMessage ? <span className={styles.feedbackStatus}>{adminMessage}</span> : null}
                </div>
              </form>
            </details>

            {adminNotes.length > 0 ? (
              <div className={styles.adminNoteList}>
                {adminNotes.map((note) => {
                  const localized = translationFor(note, language) ?? translationFor(note, "en");
                  return (
                    <article key={note.id} className={styles.adminNoteCard}>
                      <div className={styles.adminNoteMeta}>
                        <strong>{note.slug}</strong>
                        <span>{note.status}</span>
                        <span>{formatDate(note.publishedAt, language)}</span>
                      </div>
                      <p>{localized?.title ?? note.slug}</p>
                      <div className={styles.adminStatusRow}>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => startEditReleaseNote(note)}
                          disabled={adminBusy}
                        >
                          {isSv ? "Redigera" : "Edit"}
                        </button>
                        {note.status !== "published" ? (
                          <button
                            type="button"
                            className={styles.feedbackMinimalButton}
                            onClick={() => void publishReleaseNote(note.id)}
                            disabled={adminBusy}
                          >
                            {isSv ? "Publicera" : "Publish"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}

            {editingReleaseId ? (
              <form className={styles.adminFormGrid} onSubmit={saveEditedReleaseNote}>
                <h3>{isSv ? "Redigera release note" : "Edit release note"}</h3>
                <div className={styles.inlineFields}>
                  <select
                    className={styles.adminSelect}
                    value={adminEditForm.sourceLocale}
                    onChange={(event) =>
                      setAdminEditForm((prev) => ({ ...prev, sourceLocale: event.target.value === "sv" ? "sv" : "en" }))
                    }
                  >
                    <option value="en">{isSv ? "Språk: Engelska" : "Language: English"}</option>
                    <option value="sv">{isSv ? "Språk: Svenska" : "Language: Swedish"}</option>
                  </select>
                  <select
                    className={styles.adminSelect}
                    value={adminEditForm.status}
                    onChange={(event) =>
                      setAdminEditForm((prev) => ({
                        ...prev,
                        status: event.target.value === "published" ? "published" : "draft"
                      }))
                    }
                  >
                    <option value="draft">draft</option>
                    <option value="published">published</option>
                  </select>
                </div>
                <input
                  className={styles.feedbackMinimalInput}
                  value={adminEditForm.title}
                  onChange={(event) => setAdminEditForm((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder={adminEditForm.sourceLocale === "sv" ? "Titel" : "Title"}
                />
                <textarea
                  className={`${styles.feedbackMinimalTextarea} ${styles.compactTextarea}`}
                  value={adminEditForm.bodyMarkdown}
                  onChange={(event) => setAdminEditForm((prev) => ({ ...prev, bodyMarkdown: event.target.value }))}
                  placeholder={adminEditForm.sourceLocale === "sv" ? "Markdown-innehåll" : "Markdown content"}
                />
                <div className={styles.adminStatusRow}>
                  <button type="submit" className={styles.feedbackMinimalButton} disabled={adminBusy}>
                    {isSv ? "Spara ändringar" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setEditingReleaseId(null)}
                    disabled={adminBusy}
                  >
                    {isSv ? "Avbryt" : "Cancel"}
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        ) : null}

        <section className={`${styles.card} ${styles.releaseSection} appSection`}>
          <h2>{isSv ? "Release logg" : "Release log"}</h2>
          <p className={styles.sectionHint}>
            {isSv ? "Publicerade uppdateringar för produkten." : "Published product updates."}
          </p>
          {loading ? <p>{isSv ? "Laddar..." : "Loading..."}</p> : null}
          {!loading && notes.length === 0 ? (
            <p>{isSv ? "Inga publicerade release notes ännu." : "No published release notes yet."}</p>
          ) : null}
          <div className={styles.releaseNotesList}>
            {notes.map((note) => (
              <article key={note.id} className={styles.releaseNoteCard}>
                <header className={styles.releaseNoteHeader}>
                  <h3>{note.title}</h3>
                  <span>{formatDate(note.publishedAt, language)}</span>
                </header>
                {renderMarkdown(note.bodyMarkdown)}
              </article>
            ))}
          </div>
        </section>

        <section className={`${styles.card} ${styles.featureSection} appSection`}>
          <h2>{isSv ? "Önskade funktioner" : "Feature requests"}</h2>
          <p className={styles.sectionHint}>
            {isSv ? "Skicka förslag, rösta och kommentera." : "Send ideas, upvote, and comment."}
          </p>
          <form className={`${styles.feedbackFormStack} ${styles.featureComposer}`} onSubmit={submitFeatureRequest}>
            <textarea
              id="release-notes-feedback"
              className={`${styles.feedbackMinimalTextarea} ${styles.compactTextarea}`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={
                isSv
                  ? "Vad ska vi bygga härnäst?"
                  : "What should we build next?"
              }
              maxLength={4000}
            />
            <button type="submit" className={styles.feedbackMinimalButton} disabled={submitting || !message.trim()}>
              {submitting ? (isSv ? "Skickar..." : "Sending...") : isSv ? "Skicka" : "Send"}
            </button>
            {statusMessage ? <span className={styles.feedbackStatus}>{statusMessage}</span> : null}
          </form>

          <div className={styles.featureToolbar}>
            <label className={styles.feedbackMinimalLabel} htmlFor="feature-filter">
              {isSv ? "Filter" : "Filter"}
            </label>
            <select
              id="feature-filter"
              className={styles.adminSelect}
              value={featureFilter}
              onChange={(event) => setFeatureFilter(event.target.value as FeatureFilter)}
            >
              <option value="all">{isSv ? "Alla" : "All"}</option>
              <option value="new">new</option>
              <option value="planned">planned</option>
              <option value="done">done</option>
              <option value="rejected">rejected</option>
            </select>
          </div>
          {!loading && featureRequests.length === 0 ? (
            <p>{isSv ? "Inga förslag ännu." : "No requests yet."}</p>
          ) : null}
          <div className={styles.featureRequestList}>
            {featureRequests.map((request) => (
              <article key={request.id} className={styles.featureRequestCard}>
                <header className={styles.featureRequestHeader}>
                  <span className={styles.statusBadge} data-status={request.status}>
                    {request.status}
                  </span>
                  <time dateTime={request.createdAt}>{formatDate(request.createdAt, language)}</time>
                </header>
                <p className={styles.featureRequestMessage}>{request.message}</p>
                <div className={styles.featureRequestActions}>
                  <button type="button" className={styles.feedbackMinimalButton} onClick={() => void vote(request.id)}>
                    {isSv ? "Rösta" : "Upvote"} ({request.votes})
                  </button>
                  <button type="button" className={styles.ghostButton} onClick={() => void toggleComments(request.id)}>
                    {isSv ? "Kommentarer" : "Comments"} ({request.comments})
                  </button>
                  {isAdmin ? (
                    <select
                      className={styles.adminSelect}
                      value={requestStatuses[request.id] ?? request.status}
                      onChange={(event) => {
                        const nextStatus = event.target.value as FeatureStatus;
                        const previousStatus = requestStatuses[request.id] ?? request.status;
                        setRequestStatuses((prev) => ({ ...prev, [request.id]: nextStatus }));
                        void updateRequestStatus(request.id, nextStatus, previousStatus);
                      }}
                    >
                      <option value="new">new</option>
                      <option value="planned">planned</option>
                      <option value="done">done</option>
                      <option value="rejected">rejected</option>
                    </select>
                  ) : null}
                </div>

                {expandedComments[request.id] ? (
                  <div className={styles.commentsBlock}>
                    <div className={styles.commentsList}>
                      {(commentsByRequest[request.id] ?? []).map((comment) => (
                        <div key={comment.id} className={styles.commentItem}>
                          <p>{comment.message}</p>
                          <time dateTime={comment.createdAt}>{formatDate(comment.createdAt, language)}</time>
                        </div>
                      ))}
                      {(commentsByRequest[request.id] ?? []).length === 0 ? (
                        <p className={styles.commentsEmpty}>{isSv ? "Inga kommentarer ännu." : "No comments yet."}</p>
                      ) : null}
                    </div>

                    {session.authenticated ? (
                      <form className={styles.commentForm} onSubmit={(event) => void submitComment(event, request.id)}>
                        <input
                          className={styles.feedbackMinimalInput}
                          value={commentDrafts[request.id] ?? ""}
                          onChange={(event) =>
                            setCommentDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))
                          }
                          placeholder={isSv ? "Skriv en kommentar" : "Write a comment"}
                          maxLength={4000}
                        />
                        <button type="submit" className={styles.feedbackMinimalButton}>
                          {isSv ? "Kommentera" : "Comment"}
                        </button>
                      </form>
                    ) : (
                      <p className={styles.commentsLoginHint}>
                        {isSv ? "Logga in för att kommentera." : "Sign in to comment."} <Link href={loginHref}>{isSv ? "Logga in" : "Sign in"}</Link>
                      </p>
                    )}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          <div className={styles.paginationRow}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setFeaturePage((prev) => Math.max(prev - 1, 1))}
              disabled={loading || featurePage <= 1}
            >
              {isSv ? "Föregående" : "Previous"}
            </button>
            <span className={styles.feedbackStatus}>
              {isSv ? `Sida ${featurePage}` : `Page ${featurePage}`}
            </span>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setFeaturePage((prev) => prev + 1)}
              disabled={loading || !featureHasMore}
            >
              {isSv ? "Nästa" : "Next"}
            </button>
          </div>
        </section>
      </Workspace>
    </main>
  );
}
