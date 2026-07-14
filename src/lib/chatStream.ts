import type { ChatEvent } from "./chat.ts";

export type ChatTurn =
  | {
      kind: "user";
      id: string;
      text: string;
      steered?: boolean;
      createdAt?: number;
      /** disk paths of images attached to THIS turn (rendered as bubble thumbnails). */
      images?: string[];
      /** selection snippets attached to THIS turn (rendered as expandable chips). */
      snippets?: { id: string; text: string }[];
    }
  | {
      kind: "assistant";
      id: string;
      text: string;
      streaming: boolean;
      createdAt?: number;
      /** engine model id that GENERATED this turn (from the event's
       *  `message.model`) — so the frame header shows the model each answer was
       *  actually produced by, not whatever the composer is set to NOW. Undefined
       *  while streaming (stamped when the settled `assistant` event lands) and on
       *  turns from older logs that predate this field. */
      model?: string;
    }
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
      /** tool_use id of the parent Task when this call was made BY a sub-agent
       *  (from the event's top-level `parent_tool_use_id`). Drives transcript
       *  nesting — children render under their Agent row, not flat. Undefined for
       *  main-agent tool calls. */
      parentId?: string;
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
      /** true when this result closes a turn TRIGGERED BY a background agent
       *  finishing (`origin.kind === "task-notification"`), not a user prompt or a
       *  regenerate. The variant segmenter treats such a run as its own stacked
       *  segment instead of a ‹N/M› alternate of the previous prompt. */
      continuation?: boolean;
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
  // self-heal: the id ref can desync from the turn list under very fast local
  // streams (owner-reported mid-sentence splits on LM Studio) — if the tail is
  // still a LIVE assistant turn, it IS this stream; keep appending there
  // instead of splitting the sentence into a second bubble.
  const last = turns[turns.length - 1];
  if (last?.kind === "assistant" && last.streaming) {
    turns[turns.length - 1] = { ...last, text: last.text + text, streaming: true };
    return { ...state, turns, streamingTurnId: last.id };
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
  // the model that produced THIS turn (rides on every assistant event) — stamped
  // onto the assistant turn(s) so the frame header reflects it per-turn.
  const msgModel =
    typeof ev.message?.model === "string" && ev.message.model ? ev.message.model : undefined;
  // the live streaming turn (built from token deltas) that this settled event
  // closes — captured before we clear streamingTurnId, so we can stamp its model.
  const streamId = next.streamingTurnId;
  // did this event carry assistant prose? (used to decide whether to stamp a
  // trailing turn's model when the streaming-id bookkeeping has desynced.)
  const hadText = (ev.message?.content ?? []).some(
    (b) => b.type === "text" && (b.text ?? "").trim(),
  );
  // sub-agent (Task) events carry the parent Task's tool_use id here → nest.
  const parentId =
    typeof ev.parent_tool_use_id === "string" ? ev.parent_tool_use_id : undefined;
  for (const block of ev.message?.content ?? []) {
    // Sub-agent PROSE/THINKING stays inside the sub-agent: its final report
    // arrives as the Task's tool_result, and the fleet strip narrates progress.
    // Without this guard every sub-agent sentence rendered as a main-transcript
    // bubble (owner-reported: fan-outs looked like the agent talking to itself).
    if (parentId && (block.type === "text" || block.type === "thinking")) continue;
    if (block.type === "text") {
      const full = (block.text ?? "").trim();
      if (full && next.streamingTurnId == null) {
        // content-level dedup: claude (and some engines) re-emit the cumulative
        // assistant message as a SECOND `assistant` event after the first one
        // already cleared streamingTurnId — without this guard that repeat
        // renders a duplicate identical bubble. Drop it if the last assistant
        // turn already holds this exact text. GENERALIZED for streamed
        // fragments (API tier): if the TRAILING assistant turns concatenate to
        // exactly this text, they are the streamed halves of THIS message —
        // coalesce them into one settled turn instead of appending a dupe.
        let firstTrailing = turns.length;
        while (firstTrailing > 0 && turns[firstTrailing - 1].kind === "assistant") {
          firstTrailing--;
        }
        const trailing = turns.slice(firstTrailing) as Extract<
          ChatTurn,
          { kind: "assistant" }
        >[];
        const concat = trailing.map((t) => t.text).join("").trim();
        if (trailing.length > 1 && concat === full) {
          turns.splice(firstTrailing, trailing.length, {
            kind: "assistant",
            id: trailing[0].id,
            text: full,
            streaming: false,
            ...(msgModel ? { model: msgModel } : {}),
          });
        } else {
          const lastAssistant = trailing[trailing.length - 1];
          const isDuplicate = lastAssistant != null && lastAssistant.text.trim() === full;
          if (!isDuplicate) {
            turns.push({
              kind: "assistant",
              id: options.uid(),
              text: full,
              streaming: false,
              ...(msgModel ? { model: msgModel } : {}),
            });
          }
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
    // `server_tool_use` = claude's SERVER-side tools (built-in web_search etc.).
    // Same card treatment as client tools — skipping them made a server search
    // an invisible step (thinking… then sourced prose out of nowhere).
    if (block.type === "tool_use" || block.type === "server_tool_use") {
      const toolId = block.id ?? options.uid();
      if (!turns.some((turn) => turn.kind === "tool" && turn.id === toolId)) {
        turns.push({
          kind: "tool",
          id: toolId,
          name: block.name ?? "tool",
          input: (block.input as Record<string, unknown>) ?? {},
          // only attach when it's a real sub-agent child — keeps main-agent tool
          // turns shape-identical (no `parentId: undefined` key) so existing
          // deepStrictEqual tests + serialized history stay byte-stable.
          ...(parentId ? { parentId } : {}),
        });
      }
    }
    // a server tool's result rides in the SAME assistant message (not a user
    // tool_result event) — attach it to its card as "title — url" lines.
    if (block.type === "web_search_tool_result") {
      const ref = (block as { tool_use_id?: string }).tool_use_id;
      const content = (block as { content?: unknown }).content;
      const text = Array.isArray(content)
        ? content
            .map((r) => {
              const row = r as { title?: string; url?: string };
              return [row.title, row.url].filter(Boolean).join(" — ");
            })
            .filter(Boolean)
            .join("\n")
        : resultToText(content);
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        if (t.kind === "tool" && t.id === ref) {
          turns[i] = { ...t, result: text || "(no results)" };
          break;
        }
      }
    }
  }
  // Streaming tier (claude): the turn was built by token deltas and carries no
  // model yet — stamp it now from this settling event so its header shows the
  // model that produced it (not the composer's current model). Prefer the turn
  // this event actually settles (streamId); if that id desynced (fast local
  // streams can split a turn — see appendAssistantDelta's self-heal), fall back
  // to the most recent still-unstamped assistant turn, but ONLY when this event
  // carried prose (a tool-only assistant event must not backfill a prior turn).
  if (msgModel) {
    let idx = streamId
      ? turns.findIndex((t) => t.id === streamId && t.kind === "assistant")
      : -1;
    if (idx < 0 && hadText) {
      for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i];
        if (t.kind === "assistant" && !t.model) {
          idx = i;
          break;
        }
      }
    }
    if (idx >= 0) {
      turns[idx] = { ...(turns[idx] as Extract<ChatTurn, { kind: "assistant" }>), model: msgModel };
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
    // Sub-agent token deltas carry the parent Task's id. They must NOT append to
    // the main assistant/thinking bubble — a sub-agent's prose belongs to the
    // sub-agent (its settled text/thinking is already dropped in
    // reduceAssistantEvent; the fleet strip narrates its progress). Without this,
    // parallel sub-agents' tokens interleave into the main reply mid-stream — the
    // "it becomes messed up when subagents run" report. Swallow (handled) so the
    // main stream is untouched.
    if (typeof ev.parent_tool_use_id === "string" && ev.parent_tool_use_id) {
      return { handled: true, state };
    }
    const event = ev.event;
    // A new content block begins → the prior thinking phase is over. claude
    // streams a whole server-tool turn (think → web_search → think → …) as ONE
    // message, so the full `assistant` event that normally settles thinking only
    // lands at the very END — leaving every earlier "thought" stuck showing
    // "thinking". Settling on the next block's start flips each one to "thought
    // for Xs" the moment it's actually done.
    if (event?.type === "content_block_start") {
      if (state.thinkingTurnId) {
        return {
          handled: true,
          state: { ...settleThinking(state, options.now), thinkingTurnId: null },
        };
      }
      return { handled: false, state };
    }
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
    // tool_result-bearing user events fill their tool turn's output slot.
    const content = ev.message?.content as unknown;
    const blocks = Array.isArray(content) ? (content as Array<Record<string, unknown>>) : [];
    if (blocks.some((b) => b?.type === "tool_result")) {
      return { handled: true, state: reduceToolResultEvent(state, ev) };
    }
    // Sub-agent user events (the Task prompt injected into the CHILD's
    // transcript, tagged parent_tool_use_id) are not the user speaking — the
    // prompt is already visible in the Task tool card. Rendering them made
    // fan-outs read as giant phantom "YOU" messages (owner-reported).
    if (typeof ev.parent_tool_use_id === "string" && ev.parent_tool_use_id) {
      return { handled: true, state };
    }
    // A text-bearing user event: claude never echoes typed turns live, so this
    // only arrives on a reattach replay (the backend buffers the user's own
    // lines for exactly this). Render it as a user bubble — without it a
    // replayed transcript is answers-only and the variant segmentation
    // collapses every run into phantom ‹N/M› alternates of one rootless prompt.
    const text = Array.isArray(content)
      ? blocks
          .filter((b) => b?.type === "text")
          .map((b) => String((b as { text?: unknown }).text ?? ""))
          .join("")
          .trim()
      : typeof content === "string"
        ? content.trim()
        : "";
    // image PATH refs recorded alongside the turn (chat.rs user_record_line).
    const images = blocks
      .filter((b) => b?.type === "osai_image_ref")
      .map((b) => String((b as { path?: unknown }).path ?? ""))
      .filter(Boolean);
    if (text || images.length) {
      return {
        handled: true,
        state: {
          ...state,
          turns: [
            ...state.turns,
            {
              kind: "user",
              id: options.uid(),
              text: text || `[${images.length} image${images.length > 1 ? "s" : ""}]`,
              images: images.length ? images : undefined,
              createdAt: options.now,
            },
          ],
        },
      };
    }
    return { handled: true, state };
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
 * Pure + deterministic (caller supplies `uid`) so it's unit-testable. Each row's
 * `_ts` (the store's write-time ms) becomes the turn's `createdAt`, so resumed
 * turns carry hover times + day separators; rows recorded before stamping get none.
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
    // `_ts` is the write-time ms the store stamped (chat_history.rs); 0 for older
    // rows recorded before stamping → no time (graceful).
    const ts =
      typeof (ev as { _ts?: number })._ts === "number"
        ? (ev as { _ts?: number })._ts!
        : 0;
    const comp = detectCompaction(ev);
    if (comp) {
      push({ kind: "compaction", id: uid(), createdAt: ts || undefined, ...comp });
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
      // sub-agent prompt echoes (parent_tool_use_id) are not the user — skip
      // on replay exactly like live (the Task card carries the prompt).
      if (
        !hasToolResult &&
        typeof (ev as { parent_tool_use_id?: unknown }).parent_tool_use_id === "string" &&
        (ev as { parent_tool_use_id?: string }).parent_tool_use_id
      ) {
        continue;
      }
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
        // image PATH refs recorded alongside the turn (chat.rs user_record_line)
        // — restore the bubble's thumbnails instead of silently dropping the
        // picture the model was shown.
        const images = blocks
          .filter((b) => (b as { type?: string }).type === "osai_image_ref")
          .map((b) => String((b as { path?: unknown }).path ?? ""))
          .filter(Boolean);
        if (text || images.length) {
          push({
            kind: "user",
            id: uid(),
            text: text || `[${images.length} image${images.length > 1 ? "s" : ""}]`,
            images: images.length ? images : undefined,
            createdAt: ts || undefined,
          });
        }
        continue;
      }
      // a tool_result-bearing user event → let the reducer fill its tool turn
    }
    if (ev.type === "result") {
      const ok = !ev.is_error;
      const text = ok ? "" : ev.result ?? "";
      const continuation = ev.origin != null;
      // skip empty success footers (e.g. the compaction turn's own result) — the
      // grouping drops text-less results anyway. A background-continuation result
      // (origin set) is kept even when empty so its run stays a segment boundary.
      if (text || !ok || continuation) {
        push({
          kind: "result",
          id: uid(),
          text,
          cost: typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : undefined,
          durationMs: typeof ev.duration_ms === "number" ? ev.duration_ms : undefined,
          ok,
          ...(continuation ? { continuation: true } : {}),
        });
      }
      continue;
    }
    const before = state.turns.length;
    state = reduceChatStreamEvent(state, ev, { now: ts || 0, uid }).state;
    // stamp the assistant turns this event created so resumed bubbles carry a
    // hover time (the reducer sets thinking.startedAt via `now` but not createdAt).
    if (ts && state.turns.length > before) {
      state = {
        ...state,
        turns: state.turns.map((t, i) =>
          i >= before && t.kind === "assistant" && t.createdAt == null
            ? { ...t, createdAt: ts }
            : t,
        ),
      };
    }
  }
  return finalizeStreamingTurns(state, 0).turns;
}
