/**
 * Thin wrappers over the durable chat-history store (`chat_history.rs`).
 *
 * The store is the AIOS-owned, append-only, full-fidelity log of every chat
 * (`~/.aios/state/chat-history/<engineSessionId>/events.jsonl`), independent of
 * the engine's own transcript files. `read_chat_history` returns the raw
 * normalized event lines for replay through the live stream reducer
 * (`replayHistoryToTurns` in chatStream.ts); `chat_history_meta` is the cheap
 * per-session summary the history pane shows.
 *
 * Plan: PLAN-chatpane-history-and-navigation.md §2 (P1).
 */
import { invoke } from "./tauri";

/** One page of a session's durable event log. */
export interface ChatHistoryPage {
  /** Total settled-event lines on disk for this session. */
  total: number;
  /** 0-based index of the first returned line. */
  from: number;
  /** Raw normalized event rows (one JSON object each), in order. */
  lines: string[];
}

/** Cheap per-session metadata, computed on demand from the log + file stats. */
export interface ChatHistoryMeta {
  /** True when a durable log exists for this id (else fall back to transcript). */
  exists: boolean;
  message_count: number;
  user_count: number;
  assistant_count: number;
  tool_count: number;
  cost_usd: number;
  byte_size: number;
  /** Unix SECONDS (log file create/modify time), or null. */
  first_ts: number | null;
  last_ts: number | null;
}

/**
 * Reads a session's durable event log, paginated by line index (`fromSeq` +
 * `limit`; omit both for the whole log). An empty `lines` array means there's no
 * AIOS-owned store for this id (a foreign/legacy chat) — the caller should fall
 * back to the engine transcript (`readChatTranscript`).
 */
export async function readChatHistory(
  id: string,
  opts: { fromSeq?: number; limit?: number } = {},
): Promise<ChatHistoryPage> {
  return invoke<ChatHistoryPage>("read_chat_history", {
    id,
    fromSeq: opts.fromSeq ?? null,
    limit: opts.limit ?? null,
  });
}

/** Per-session summary for the history pane (counts, cost, size, time range). */
export async function chatHistoryMeta(id: string): Promise<ChatHistoryMeta> {
  return invoke<ChatHistoryMeta>("chat_history_meta", { id });
}

/** Persist a chat's conversation-tree sidecar (Tier-4 branching) so branches
 *  survive a reload. `json` = a serialized `PersistedTree`. */
export async function saveChatTree(id: string, json: string): Promise<void> {
  await invoke("save_chat_tree", { id, json });
}

/** Read a chat's tree sidecar — empty string when none (fall back to the log). */
export async function loadChatTree(id: string): Promise<string> {
  try {
    return await invoke<string>("load_chat_tree", { id });
  } catch {
    return "";
  }
}

// ── history pane + management (P5) ───────────────────────────────────────────

/** One row in the History pane: the /resume index entry + a starred flag.
 *  (Counts/cost load lazily per row via `chatHistoryMeta`.) */
export interface HistoryEntry {
  id: string;
  title: string;
  cwd: string;
  mtime: number;
  engine: string;
  model: string;
  last_user: string;
  starred: boolean;
}

/** A trashed (soft-deleted) chat, recoverable until purged. */
export interface TrashEntry {
  id: string;
  title: string;
  deleted_at: number;
}

/** The browsable history: the /resume index minus trashed ids, + starred flag. */
export async function listChatHistory(limit?: number): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("list_chat_history", { limit: limit ?? null });
}

/** Star / unstar a conversation (starred float to a pinned group + survive cleanup). */
export async function setStarred(id: string, starred: boolean): Promise<void> {
  return invoke("set_starred", { id, starred });
}

/** Soft-delete chats → recoverable trash (leaves history + the /resume picker). */
export async function deleteChats(ids: string[]): Promise<void> {
  return invoke("delete_chats", { ids });
}

/** Undo a soft-delete: restore the chats from trash. */
export async function restoreChats(ids: string[]): Promise<void> {
  return invoke("restore_chats", { ids });
}

/** Permanently purge trashed chats (given ids, or ALL when omitted). */
export async function purgeTrash(ids?: string[]): Promise<void> {
  return invoke("purge_trash", { ids: ids ?? null });
}

/** List the current trash (recoverable soft-deleted chats). */
export async function listTrash(): Promise<TrashEntry[]> {
  return invoke<TrashEntry[]>("list_trash");
}

/** Export one chat from its durable log: "md" (prose) or "json" (raw events). */
export async function exportChat(id: string, format: "md" | "json"): Promise<string> {
  return invoke<string>("export_chat", { id, format });
}

/** A chat whose message content matched a cross-history search: the row data + a
 *  context snippet + how many messages matched. */
export interface SearchHit extends HistoryEntry {
  snippet: string;
  matches: number;
}

/** Full-text search across every durable log's message content (not just titles).
 *  Returns matching chats with a snippet, newest first. */
export async function searchChatHistory(query: string, limit?: number): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_chat_history", { query, limit: limit ?? null });
}
