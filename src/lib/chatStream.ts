import type { ChatEvent } from "./chat.ts";

export type ChatTurn =
  | { kind: "user"; id: string; text: string; steered?: boolean; createdAt?: number }
  | { kind: "assistant"; id: string; text: string; streaming: boolean; createdAt?: number }
  | {
      kind: "thinking";
      id: string;
      text: string;
      streaming: boolean;
      startedAt?: number;
      durationMs?: number;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      result?: string;
      isError?: boolean;
    }
  | {
      kind: "approval";
      id: string;
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      decision?: "allow" | "allow_always" | "deny";
    }
  | {
      kind: "result";
      id: string;
      text: string;
      cost?: number;
      tokens?: number;
      durationMs?: number;
      /** false = a failure (renders as a danger footer with a retry), undefined/
       *  true = a benign completion footer. */
      ok?: boolean;
    }
  | {
      kind: "compaction";
      id: string;
      /** "manual" (/compact) or "auto" (context-window pressure). */
      trigger?: string;
      preTokens?: number;
      postTokens?: number;
      durationMs?: number;
      /** the recap claude carries forward (collapsible); absent on older chats. */
      summary?: string;
      createdAt?: number;
    };

export interface ChatStreamState {
  turns: ChatTurn[];
  streamingTurnId: string | null;
  thinkingTurnId: string | null;
}

export interface ChatStreamReduceOptions {
  now: number;
  uid: () => string;
}

export interface ChatStreamReduceResult {
  handled: boolean;
  state: ChatStreamState;
}

export function resultToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text: unknown }).text)
          : JSON.stringify(b),
      )
      .join("\n");
  }
  return JSON.stringify(content, null, 2);
}

function appendThinkingDelta(
  state: ChatStreamState,
  text: string,
  options: ChatStreamReduceOptions,
): ChatStreamState {
  const turns = [...state.turns];
  const id = state.thinkingTurnId;
  const idx = id ? turns.findIndex((t) => t.id === id) : -1;
  if (idx >= 0 && turns[idx].kind === "thinking") {
    const turn = turns[idx] as Extract<ChatTurn, { kind: "thinking" }>;
    turns[idx] = { ...turn, text: turn.text + text, streaming: true };
    return { ...state, turns };
  }
  const nextId = options.uid();
  turns.push({
    kind: "thinking",
    id: nextId,
    text,
    streaming: true,
    startedAt: options.now,
  });
  return { ...state, turns, thinkingTurnId: nextId };
}

function appendAssistantDelta(
  state: ChatStreamState,
  text: string,
  options: ChatStreamReduceOptions,
): ChatStreamState {
  const turns = [...state.turns];
  const id = state.streamingTurnId;
  const idx = id ? turns.findIndex((t) => t.id === id) : -1;
  if (idx >= 0 && turns[idx].kind === "assistant") {
    const turn = turns[idx] as Extract<ChatTurn, { kind: "assistant" }>;
    turns[idx] = { ...turn, text: turn.text + text, streaming: true };
    return { ...state, turns };
  }
  const nextId = options.uid();
  turns.push({ kind: "assistant", id: nextId, text, streaming: true });
  return { ...state, turns, streamingTurnId: nextId };
}

function settleThinking(state: ChatStreamState, now: number): ChatStreamState {
  const id = state.thinkingTurnId;
  if (!id) return state;
  return {
    ...state,
    turns: state.turns.map((turn) =>
      turn.id === id && turn.kind === "thinking"
        ? {
            ...turn,
            streaming: false,
            durationMs: turn.startedAt != null ? now - turn.startedAt : undefined,
          }
        : turn,
    ),
  };
}

function reduceAssistantEvent(
  state: ChatStreamState,
  ev: ChatEvent,
  options: ChatStreamReduceOptions,
): ChatStreamState {
  let next = settleThinking(state, options.now);
  const turns = [...next.turns];
  for (const block of ev.message?.content ?? []) {
    if (block.type === "text") {
      const full = (block.text ?? "").trim();
      if (full && next.streamingTurnId == null) {
        // content-level dedup: claude (and some engines) re-emit the cumulative
        // assistant message as a SECOND `assistant` event after the first one
        // already cleared streamingTurnId — without this guard that repeat
        // renders a duplicate identical bubble. Drop it if the last assistant
        // turn already holds this exact text.
        const lastAssistant = [...turns]
          .reverse()
          .find((t) => t.kind === "assistant");
        const isDuplicate =
          lastAssistant?.kind === "assistant" &&
          lastAssistant.text.trim() === full;
        if (!isDuplicate) {
          turns.push({ kind: "assistant", id: options.uid(), text: full, streaming: false });
        }
      }
    }
    if (block.type === "thinking") {
      const full = (block.thinking ?? "").trim();
      if (full && next.thinkingTurnId == null) {
        // same content-level dedup as assistant text above: the cumulative
        // re-emit otherwise renders a second identical "thought" block.
        const lastThinking = [...turns]
          .reverse()
          .find((t) => t.kind === "thinking");
        const isDuplicate =
          lastThinking?.kind === "thinking" && lastThinking.text.trim() === full;
        if (!isDuplicate) {
          turns.push({ kind: "thinking", id: options.uid(), text: full, streaming: false });
        }
      }
    }
    if (block.type === "tool_use") {
      const toolId = block.id ?? options.uid();
      if (!turns.some((turn) => turn.kind === "tool" && turn.id === toolId)) {
        turns.push({
          kind: "tool",
          id: toolId,
          name: block.name ?? "tool",
          input: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }
  }
  next = { turns, streamingTurnId: null, thinkingTurnId: null };
  return next;
}

function reduceToolResultEvent(state: ChatStreamState, ev: ChatEvent): ChatStreamState {
  let turns = state.turns;
  for (const block of ev.message?.content ?? []) {
    if (block.type !== "tool_result") continue;
    const ref = block.tool_use_id;
    const text = resultToText(block.content);
    turns = turns.map((turn) =>
      turn.kind === "tool" && turn.id === ref
        ? { ...turn, result: text, isError: block.is_error }
        : turn,
    );
  }
  return { ...state, turns };
}

export function finalizeStreamingTurns(
  state: ChatStreamState,
  now: number,
): ChatStreamState {
  return {
    turns: state.turns.map((turn) => {
      if (turn.kind === "assistant" && turn.streaming) return { ...turn, streaming: false };
      if (turn.kind === "thinking" && turn.streaming) {
        return {
          ...turn,
          streaming: false,
          durationMs: turn.startedAt != null ? now - turn.startedAt : turn.durationMs,
        };
      }
      return turn;
    }),
    streamingTurnId: null,
    thinkingTurnId: null,
  };
}

export function reduceChatStreamEvent(
  state: ChatStreamState,
  ev: ChatEvent,
  options: ChatStreamReduceOptions,
): ChatStreamReduceResult {
  if (ev.type === "stream_event") {
    const event = ev.event;
    if (!event || event.type !== "content_block_delta") {
      return { handled: false, state };
    }
    if (event.delta?.type === "thinking_delta") {
      const tok = event.delta.thinking ?? "";
      return tok
        ? { handled: true, state: appendThinkingDelta(state, tok, options) }
        : { handled: true, state };
    }
    if (event.delta?.type === "text_delta") {
      const tok = event.delta.text ?? "";
      return tok
        ? { handled: true, state: appendAssistantDelta(state, tok, options) }
        : { handled: true, state };
    }
    return { handled: false, state };
  }
  if (ev.type === "assistant") {
    return { handled: true, state: reduceAssistantEvent(state, ev, options) };
  }
  if (ev.type === "user") {
    return { handled: true, state: reduceToolResultEvent(state, ev) };
  }
  return { handled: false, state };
}

/** Token + trigger metadata from a claude `compact_boundary` system event. */
export interface CompactionInfo {
  trigger?: string;
  preTokens?: number;
  postTokens?: number;
  durationMs?: number;
}

/** Recognizes claude's compaction boundary (`system`/`compact_boundary`) and
 *  pulls its `compact_metadata` (trigger + pre/post tokens + duration). Returns
 *  null for any other event. One helper, shared by the live path and replay. */
export function detectCompaction(ev: ChatEvent): CompactionInfo | null {
  if (ev.type !== "system" || ev.subtype !== "compact_boundary") return null;
  const m =
    (ev as { compact_metadata?: Record<string, unknown> }).compact_metadata ?? {};
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v : undefined;
  return {
    trigger: str(m.trigger),
    preTokens: num(m.pre_tokens),
    postTokens: num(m.post_tokens),
    durationMs: num(m.duration_ms),
  };
}

/** The synthetic "continued from a previous conversation" summary claude injects
 *  right after a compaction (an `isSynthetic` user message whose content is the
 *  summary string). Returns the cleaned summary body, or null if `ev` isn't it. */
export function compactionSummary(ev: ChatEvent): string | null {
  if (ev.type !== "user") return null;
  if (!(ev as { isSynthetic?: boolean }).isSynthetic) return null;
  const content = ev.message?.content as unknown;
  if (typeof content !== "string") return null;
  if (!/continued from a previous conversation/i.test(content)) return null;
  return cleanCompactionSummary(content);
}

/** Strips claude's boilerplate around the summary body so the card shows just the
 *  recap (drops the "This session is being continued…" preamble + the trailing
 *  "read the full transcript… / Continue the conversation…" instructions). */
function cleanCompactionSummary(raw: string): string {
  let s = raw.trim();
  const start = s.indexOf("Summary:");
  if (start >= 0) s = s.slice(start + "Summary:".length).trim();
  for (const marker of [
    "If you need specific details",
    "Continue the conversation",
    "Continue from where",
  ]) {
    const i = s.indexOf(marker);
    if (i >= 0) s = s.slice(0, i).trim();
  }
  return s;
}

/**
 * Rebuilds a rendered transcript from a session's durable event log
 * (`chat_history.rs` → `read_chat_history`). Replays the SAME settled events the
 * live stream produced, through the SAME reducer, PLUS the turn kinds the live
 * path builds outside the reducer — the user-text bubble, the result footer, and
 * the compaction segment card — so a resumed chat shows thinking, tool calls,
 * diffs and compaction boundaries, not just text (the old `transcriptToTurns` was
 * text-only). Partial/unknown lines and synthetic plumbing are skipped.
 *
 * Pure + deterministic (caller supplies `uid`) so it's unit-testable. Timestamps
 * aren't reconstructed: the stored rows carry no per-event stamp yet (that lands
 * with the P6 scrubber), so resumed turns simply have no hover time.
 */
export function replayHistoryToTurns(lines: string[], uid: () => string): ChatTurn[] {
  let state: ChatStreamState = {
    turns: [],
    streamingTurnId: null,
    thinkingTurnId: null,
  };
  const push = (turn: ChatTurn) => {
    state = { ...state, turns: [...state.turns, turn] };
  };
  // fold a compaction summary into the most recent compaction card
  const attachSummary = (summary: string) => {
    for (let i = state.turns.length - 1; i >= 0; i--) {
      if (state.turns[i].kind === "compaction") {
        const turns = [...state.turns];
        turns[i] = { ...turns[i], summary } as ChatTurn;
        state = { ...state, turns };
        return;
      }
    }
  };
  for (const raw of lines) {
    let ev: ChatEvent;
    try {
      ev = JSON.parse(raw) as ChatEvent;
    } catch {
      continue;
    }
    const comp = detectCompaction(ev);
    if (comp) {
      push({ kind: "compaction", id: uid(), ...comp });
      continue;
    }
    if (ev.type === "user") {
      const summary = compactionSummary(ev);
      if (summary) {
        attachSummary(summary);
        continue;
      }
      // other synthetic / replay plumbing (e.g. "<local-command-stdout>") → drop
      if (
        (ev as { isSynthetic?: boolean }).isSynthetic ||
        (ev as { isReplay?: boolean }).isReplay
      ) {
        continue;
      }
      // content is typed as a block array but the synthetic continuation message
      // carries a raw string — treat as unknown so the string branch narrows.
      const content = ev.message?.content as unknown;
      const blocks = Array.isArray(content) ? content : [];
      const hasToolResult = blocks.some((b) => b.type === "tool_result");
      if (!hasToolResult) {
        const text = Array.isArray(content)
          ? blocks
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("")
              .trim()
          : typeof content === "string"
            ? content.trim()
            : "";
        if (text) push({ kind: "user", id: uid(), text });
        continue;
      }
      // a tool_result-bearing user event → let the reducer fill its tool turn
    }
    if (ev.type === "result") {
      const ok = !ev.is_error;
      const text = ok ? "" : ev.result ?? "";
      // skip empty success footers (e.g. the compaction turn's own result) — the
      // grouping drops text-less results anyway.
      if (text || !ok) {
        push({
          kind: "result",
          id: uid(),
          text,
          cost: typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : undefined,
          durationMs: typeof ev.duration_ms === "number" ? ev.duration_ms : undefined,
          ok,
        });
      }
      continue;
    }
    state = reduceChatStreamEvent(state, ev, { now: 0, uid }).state;
  }
  return finalizeStreamingTurns(state, 0).turns;
}
