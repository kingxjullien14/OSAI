/** Stone & Chisel — pure shapes + protocol logic (no tauri import, so the
 *  node:test suite can chew on it directly). Transport lives in ./snc.ts.
 *  Epic: misc/PLAN-notes-stone-chisel.md (N1). */

// ---------------------------------------------------------------------------
// shapes (mirror S&C's drizzle schema — only the fields the pane consumes)

/** List-row shape: `GET /api/documents` returns metadata WITHOUT content. */
export interface SncDocMeta {
  id: string;
  title: string;
  kind: "md" | "mdx";
  tags: string[];
  pinned: boolean;
  isPublic: boolean;
  shareSlug: string | null;
  folderId: string | null;
  isTemplate: boolean;
  wordGoal: number | null;
  updatedAt: string;
  createdAt: string;
}

/** Full doc: `GET /api/documents/[id]` adds content (and more we ignore). */
export interface SncDoc extends SncDocMeta {
  content: string;
}

export interface SncFolder {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  documentCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface SncTrashRow {
  id: string;
  title: string;
  deletedAt: string;
  updatedAt: string;
}

export interface SncStatus {
  baseUrl: string;
  hasToken: boolean;
}

export type SncSort = "updated" | "created" | "alpha";

export interface SncListOpts {
  sort?: SncSort;
  /** Server-side full-text search (websearch syntax: quotes, OR, -minus). */
  q?: string;
  tag?: string;
  /** `"none"` = root-level docs only; a folder id filters to that folder. */
  folder?: string;
}

export interface SncDocPatch {
  title?: string;
  content?: string;
  pinned?: boolean;
  tags?: string[];
  folderId?: string | null;
  /** The `updatedAt` this edit was based on. With a content change, the
   *  server 409s (→ SncConflictError) if the row moved on — never clobbers. */
  baseUpdatedAt?: string;
}

// ---------------------------------------------------------------------------
// errors

/** A 409 from a content PATCH — the server refused to clobber and handed back
 *  the live row. Feed `current` to the merge (D6). */
export class SncConflictError extends Error {
  current: SncDoc;
  constructor(current: SncDoc) {
    super("conflict: the note changed on the server since this edit was based");
    this.name = "SncConflictError";
    this.current = current;
  }
}

/** Non-2xx that isn't a conflict. `status` 0 = transport/config failure. */
export class SncHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SncHttpError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// pure protocol logic

/** Human-readable server error out of whatever the body was. */
export function errorMessage(status: number, data: unknown): string {
  if (data && typeof data === "object") {
    const err = (data as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
  }
  if (typeof data === "string" && data.trim())
    return `HTTP ${status}: ${data.slice(0, 140)}`;
  return `HTTP ${status}`;
}

/** Turn a non-2xx `(status, body)` into the right typed error. */
export function toError(status: number, data: unknown): SncHttpError | SncConflictError {
  if (status === 409) {
    const current = (data as { current?: SncDoc } | null)?.current;
    if (current) return new SncConflictError(current);
  }
  return new SncHttpError(status, errorMessage(status, data));
}

/** S&C's auto-title rule: first non-empty line, "#" stripped, 80 max. Used by
 *  the pane's title field AND every "save to notes" entry point (chat bubble,
 *  terminal selection, control-plane create). */
export function deriveTitle(content: string): string {
  const line = content.split("\n").find((l) => l.trim());
  return (line ?? "").replace(/^#+\s*/, "").trim().slice(0, 80) || "Untitled";
}

/** Query string for the documents list. */
export function listQuery(opts: SncListOpts = {}): string {
  const params = new URLSearchParams();
  if (opts.sort && opts.sort !== "updated") params.set("sort", opts.sort);
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.tag?.trim()) params.set("tag", opts.tag.trim());
  if (opts.folder) params.set("folder", opts.folder);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Tag universe from a doc list, most-used first then alphabetical. S&C has
 *  no tags-list GET — tags ride on the docs. */
export function collectTags(docs: Pick<SncDocMeta, "tags">[]): string[] {
  const counts = new Map<string, number>();
  for (const d of docs)
    for (const t of d.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}
