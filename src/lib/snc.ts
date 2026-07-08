/** Stone & Chisel client (Notes × S&C epic, N1 — misc/PLAN-notes-stone-chisel.md).
 *
 *  The typed face of `src-tauri/src/snc.rs`: Rust holds the keychain token +
 *  base URL and moves authenticated JSON; the shapes + pure protocol logic
 *  (queries, error typing, tag derivation) live in ./sncCore.ts so the test
 *  suite can import them without a tauri runtime.
 */

import { invoke } from "./tauri";
import { homeDir, readTextFile, writeTextFile } from "./fs";
import { parseOutbox, replayOutbox, type OutboxOp, type ReplayResult } from "./sncOutbox";
import {
  deriveTitle,
  listQuery,
  toError,
  SncHttpError,
  type SncDoc,
  type SncDocMeta,
  type SncDocPatch,
  type SncFolder,
  type SncListOpts,
  type SncStatus,
  type SncTrashRow,
} from "./sncCore";

export * from "./sncCore";

// ---------------------------------------------------------------------------
// transport

interface SncResponse {
  status: number;
  data: unknown;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  let resp: SncResponse;
  try {
    resp = await invoke<SncResponse>("snc_fetch", { method, path, body });
  } catch (e) {
    throw new SncHttpError(0, String(e));
  }
  if (resp.status >= 200 && resp.status < 300) return resp.data as T;
  throw toError(resp.status, resp.data);
}

// ---------------------------------------------------------------------------
// connection management (the pane's connect card)

export async function sncStatus(): Promise<SncStatus> {
  return invoke<SncStatus>("snc_status");
}

/** Live-verifies against the server before anything is stored — a bad token
 *  fails HERE, at paste time. Omitted fields keep their current value. */
export async function sncConfigure(opts: {
  baseUrl?: string;
  token?: string;
}): Promise<SncStatus> {
  return invoke<SncStatus>("snc_configure", {
    baseUrl: opts.baseUrl ?? null,
    token: opts.token ?? null,
  });
}

export async function sncDisconnect(): Promise<void> {
  await invoke("snc_disconnect");
}

// ---------------------------------------------------------------------------
// documents

export async function listDocs(opts: SncListOpts = {}): Promise<SncDocMeta[]> {
  return request<SncDocMeta[]>("GET", `/api/documents${listQuery(opts)}`);
}

export async function getDoc(id: string): Promise<SncDoc> {
  return request<SncDoc>("GET", `/api/documents/${id}`);
}

export async function createDoc(seed: {
  title?: string;
  content?: string;
  tags?: string[];
  folderId?: string | null;
}): Promise<SncDoc> {
  return request<SncDoc>("POST", "/api/documents", seed);
}

export async function updateDoc(id: string, patch: SncDocPatch): Promise<SncDoc> {
  return request<SncDoc>("PATCH", `/api/documents/${id}`, patch);
}

/** Order-tolerant server-side append — the agent path (N3). */
export async function appendDoc(
  id: string,
  text: string,
  separator?: string,
): Promise<Pick<SncDoc, "id" | "title" | "updatedAt">> {
  return request("POST", `/api/documents/${id}/append`, { text, separator });
}

/** Soft-delete (S&C trash — restorable). */
export async function trashDoc(id: string): Promise<void> {
  await request("DELETE", `/api/documents/${id}`);
}

export async function restoreDoc(id: string): Promise<void> {
  await request("POST", `/api/documents/${id}/restore`);
}

export async function listTrash(): Promise<SncTrashRow[]> {
  return request<SncTrashRow[]>("GET", "/api/documents/trash");
}

/** The one-call "put this text in my notebook" used by every capture surface
 *  (assistant bubble, terminal selection, control-plane `notes.create`):
 *  title from the first line, tagged so S&C can filter what came from here. */
export async function saveToNotes(
  text: string,
  opts: { title?: string; tags?: string[] } = {},
): Promise<SncDoc> {
  return createDoc({
    title: opts.title ?? deriveTitle(text),
    content: text,
    tags: opts.tags ?? ["from-osai"],
  });
}

// ---------------------------------------------------------------------------
// offline outbox persistence (queue logic + replay live in ./sncOutbox.ts —
// pure and tested; this is just its disk anchor, one JSON file so a restart
// while offline loses nothing)

async function outboxPath(): Promise<string> {
  const home = await homeDir();
  return `${home}/.osai/cache/snc/outbox.json`;
}

export async function loadOutbox(): Promise<OutboxOp[]> {
  try {
    return parseOutbox(JSON.parse(await readTextFile(await outboxPath())));
  } catch {
    return []; // missing / unreadable / corrupt — start clean, never crash
  }
}

export async function saveOutbox(ops: OutboxOp[]): Promise<void> {
  await writeTextFile(await outboxPath(), JSON.stringify(ops, null, 2));
}

/** Replay against the real client: creates POST, trashes DELETE; only a
 *  transport failure (status 0) halts and keeps the queue. */
export async function replayOutboxLive(ops: OutboxOp[]): Promise<ReplayResult> {
  return replayOutbox(ops, {
    create: (seed) =>
      createDoc({
        title: seed.title ?? deriveTitle(seed.content),
        content: seed.content,
        tags: seed.tags,
        folderId: seed.folderId,
      }),
    trash: (id) => trashDoc(id),
    isTransportError: (e) => e instanceof SncHttpError && e.status === 0,
  });
}

// ---------------------------------------------------------------------------
// folders

export async function listFolders(): Promise<SncFolder[]> {
  return request<SncFolder[]>("GET", "/api/folders");
}

export async function createFolder(name: string): Promise<SncFolder> {
  return request<SncFolder>("POST", "/api/folders", { name });
}
