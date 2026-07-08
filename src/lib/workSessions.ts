// Work Sessions — the unit of WORK, not just tools or projects. A session binds a
// goal + the chat thread(s) + the open panes (a layout) + the project into one
// named, resumable thing, surfaced as "Continue working" on the home. It composes
// the stores that already exist (chat history, saved layouts, project workspaces)
// rather than replacing them — this file is the persistence + pure-logic SPINE;
// the UI wiring (capture, the home rail, one-click resume) rides on top.
//
// Tier 1 of the go-to-harness review (misc/REVIEW-2026-06-22-go-to-harness.md);
// epic plan + phases in misc/PLAN-work-sessions.md.

import type { PaneContent } from "./apps";

export type WorkSessionStatus = "active" | "paused" | "done";

/** A pane captured into a session's layout. A chat pane keeps its durable chat
 *  session id (carried in `kind.resume`) so restoring the session RESUMES that
 *  thread rather than spawning a fresh chat — the whole point over a plain saved
 *  layout. Same structural shape the boot layout + saved workspaces persist. */
export interface WorkSessionPane {
  key?: string;
  label: string;
  kind: PaneContent;
}

export interface WorkSession {
  id: string;
  title: string;
  goal?: string;
  /** the project/workspace root this work is about (optional). */
  projectRoot?: string;
  /** durable chat thread ids bound to this session (quick resume + future cost roll-up). */
  chatSessionIds: string[];
  /** the layout to restore (panes + grid fr-fractions), shape-compatible with saved workspaces. */
  panes: WorkSessionPane[];
  tracks?: { cols: number[]; rows: number[] } | null;
  createdAt: number;
  lastActiveAt: number;
  status: WorkSessionStatus;
}

export interface NewWorkSession {
  title: string;
  goal?: string;
  projectRoot?: string;
  chatSessionIds?: string[];
  panes?: WorkSessionPane[];
  tracks?: { cols: number[]; rows: number[] } | null;
}

// ── pure helpers (no I/O — unit-tested) ──────────────────────────────────────

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

/** Build a session from input + an id + a clock (both injected, so it stays pure). */
export function makeWorkSession(input: NewWorkSession, id: string, now: number): WorkSession {
  return {
    id,
    title: input.title.trim() || "untitled session",
    goal: input.goal?.trim() || undefined,
    projectRoot: input.projectRoot,
    chatSessionIds: dedupe(input.chatSessionIds ?? []),
    panes: input.panes ?? [],
    tracks: input.tracks ?? null,
    createdAt: now,
    lastActiveAt: now,
    status: "active",
  };
}

/** Add or replace a session by id (a replace preserves the original createdAt). */
export function upsertWorkSession(list: WorkSession[], s: WorkSession): WorkSession[] {
  const i = list.findIndex((x) => x.id === s.id);
  if (i < 0) return [s, ...list];
  const next = [...list];
  next[i] = { ...s, createdAt: list[i].createdAt };
  return next;
}

export function removeFromList(list: WorkSession[], id: string): WorkSession[] {
  return list.filter((s) => s.id !== id);
}

/** Most-recently-active first — the order the "Continue working" rail wants. */
export function sortByRecency(list: WorkSession[]): WorkSession[] {
  return [...list].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/** Bump lastActiveAt (and re-activate a done session) — call on resume / activity. */
export function touchInList(list: WorkSession[], id: string, now: number): WorkSession[] {
  return list.map((s) =>
    s.id === id
      ? { ...s, lastActiveAt: now, status: s.status === "done" ? "active" : s.status }
      : s,
  );
}

/** Shallow-merge a patch into a session by id, bumping lastActiveAt. */
export function patchInList(
  list: WorkSession[],
  id: string,
  patch: Partial<Omit<WorkSession, "id" | "createdAt">>,
  now: number,
): WorkSession[] {
  return list.map((s) => (s.id === id ? { ...s, ...patch, lastActiveAt: now } : s));
}

/** Bind a chat thread id to a session (dedup); no-op if already present. */
export function bindChatInList(
  list: WorkSession[],
  id: string,
  chatId: string,
  now: number,
): WorkSession[] {
  return list.map((s) =>
    s.id === id
      ? { ...s, chatSessionIds: dedupe([...s.chatSessionIds, chatId]), lastActiveAt: now }
      : s,
  );
}

// ── store (localStorage-backed; guarded; pub/sub) ────────────────────────────

const STORAGE_KEY = "osai.worksessions.v1";
let cache: WorkSession[] | null = null;
const listeners = new Set<() => void>();

function read(): WorkSession[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(arr) ? (arr as WorkSession[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: WorkSession[]) {
  cache = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota / unavailable — keep the in-memory cache so the session still works this run */
  }
  listeners.forEach((fn) => fn());
}

let seq = 0;
function newId(): string {
  // app-side id; Date.now/Math.random are fine here (only Workflow scripts forbid them).
  return `ws_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Recency-sorted snapshot for the "Continue working" rail. */
export function listWorkSessions(): WorkSession[] {
  return sortByRecency(read());
}

export function getWorkSession(id: string): WorkSession | undefined {
  return read().find((s) => s.id === id);
}

export function createWorkSession(input: NewWorkSession): WorkSession {
  const s = makeWorkSession(input, newId(), Date.now());
  write(upsertWorkSession(read(), s));
  return s;
}

export function saveWorkSession(s: WorkSession): void {
  write(upsertWorkSession(read(), s));
}

export function updateWorkSession(
  id: string,
  patch: Partial<Omit<WorkSession, "id" | "createdAt">>,
): void {
  write(patchInList(read(), id, patch, Date.now()));
}

export function touchWorkSession(id: string): void {
  write(touchInList(read(), id, Date.now()));
}

export function setWorkSessionStatus(id: string, status: WorkSessionStatus): void {
  write(patchInList(read(), id, { status }, Date.now()));
}

export function bindChatToWorkSession(id: string, chatId: string): void {
  write(bindChatInList(read(), id, chatId, Date.now()));
}

export function removeWorkSession(id: string): void {
  write(removeFromList(read(), id));
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
