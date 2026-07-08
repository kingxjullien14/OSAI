/** Offline outbox for Stone & Chisel notes — the last piece of decision D6
 *  (misc/PLAN-notes-stone-chisel.md).
 *
 *  EDITS to an existing note never come through here: the pane keeps them
 *  dirty and retries, and a 409 goes through the diff3 merge. The outbox
 *  covers what used to fail hard offline — CREATING a note and TRASHING one.
 *  A note created offline lives as a "local" doc (id `local-…`) that is
 *  fully editable; its latest text rides the queued create op, and replay
 *  swaps the temp id for the real server row ("if new, then can just add
 *  it" — the owner's Q3 answer, verbatim).
 *
 *  PURE — no tauri/fs import, so the node:test suite runs it directly.
 *  Persistence (one JSON file under `~/.osai/cache/snc/`, so a restart while
 *  offline loses nothing) lives in ./snc.ts with the rest of the I/O; the
 *  replay takes injected deps for the same reason. */

import type { SncDoc } from "./sncCore";

export interface OutboxCreate {
  kind: "create";
  /** local placeholder id (`local-…`) — swapped for the server id on replay. */
  tempId: string;
  title?: string;
  content: string;
  tags: string[];
  folderId: string | null;
  ts: number;
}

export interface OutboxTrash {
  kind: "trash";
  id: string;
  ts: number;
}

export type OutboxOp = OutboxCreate | OutboxTrash;

export function isLocalId(id: string): boolean {
  return id.startsWith("local-");
}

export function newLocalId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Insert or update a queued create (edits to a local doc coalesce into its
 *  create op — one op per local note, always carrying the latest text). */
export function upsertCreate(ops: OutboxOp[], op: OutboxCreate): OutboxOp[] {
  const i = ops.findIndex((o) => o.kind === "create" && o.tempId === op.tempId);
  if (i === -1) return [...ops, op];
  const next = ops.slice();
  next[i] = op;
  return next;
}

/** Queue a trash. Trashing a LOCAL doc simply cancels its queued create —
 *  the server never needs to hear about a note that never existed. */
export function queueTrash(ops: OutboxOp[], id: string): OutboxOp[] {
  if (isLocalId(id)) return ops.filter((o) => !(o.kind === "create" && o.tempId === id));
  if (ops.some((o) => o.kind === "trash" && o.id === id)) return ops;
  return [...ops, { kind: "trash", id, ts: Date.now() }];
}

/** Narrow whatever JSON.parse produced back to a queue (corruption-tolerant). */
export function parseOutbox(parsed: unknown): OutboxOp[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (o): o is OutboxOp =>
      !!o &&
      typeof o === "object" &&
      ((o as OutboxOp).kind === "create" || (o as OutboxOp).kind === "trash"),
  );
}

// ---------------------------------------------------------------------------
// replay

export interface ReplayDeps {
  create: (seed: {
    title?: string;
    content: string;
    tags: string[];
    folderId: string | null;
  }) => Promise<SncDoc>;
  trash: (id: string) => Promise<void>;
  /** true = the failure was transport-level (offline) → stop and keep the
   *  rest of the queue; false = a server-side rejection → drop the op (a 404
   *  trash means it's already gone; a 400 create would never succeed). */
  isTransportError: (e: unknown) => boolean;
}

export interface ReplayResult {
  remaining: OutboxOp[];
  /** tempId → the real server doc, so the pane can swap ids in its state. */
  created: Map<string, SncDoc>;
}

/** Replay in arrival order. Stops at the first transport failure (still
 *  offline) so ordering is preserved for the next attempt. */
export async function replayOutbox(ops: OutboxOp[], deps: ReplayDeps): Promise<ReplayResult> {
  const created = new Map<string, SncDoc>();
  const remaining: OutboxOp[] = [];
  let halted = false;
  for (const op of ops) {
    if (halted) {
      remaining.push(op);
      continue;
    }
    try {
      if (op.kind === "create") {
        const doc = await deps.create({
          title: op.title,
          content: op.content,
          tags: op.tags,
          folderId: op.folderId,
        });
        created.set(op.tempId, doc);
      } else {
        await deps.trash(op.id);
      }
    } catch (e) {
      if (deps.isTransportError(e)) {
        remaining.push(op);
        halted = true; // still offline — keep the rest, in order
      }
      // else: server rejected it — dropping is the only honest move
    }
  }
  return { remaining, created };
}
