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
