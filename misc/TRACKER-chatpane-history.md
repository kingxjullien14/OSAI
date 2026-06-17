# ChatPane History & Navigation — live status board

> **Single source of truth for this epic.** Plan: [PLAN-chatpane-history-and-navigation.md](PLAN-chatpane-history-and-navigation.md) (decisions D1–D6 locked 2026-06-17). Check items off here as they land (one commit per batch). Separate from the polish board [TRACKER.md](TRACKER.md).

Legend: `[x]` shipped (commit) · `[~]` in progress · `[ ]` open · `[!]` blocked / needs live run-verify

Decisions (locked): **D1** JSONL · **D2** `@tanstack/react-virtual` + recognition layer · **D3** light inline diff cards + Monaco on "open full" · **D4** new chats full store, old → text-only fallback · **D5** keep forever + management (star, multi-select, clean-up-by-timeframe excl. starred, soft-delete trash) · **D6** History = new sidebar pane.

---

## P1 — Durable history store (the spine) *(plan §2)*

> Refinement vs plan: persist the **raw normalized event lines** the backend already ingests (the true source — `Turn` *and* `RunEvent` both derive from it), not the lossy/500-capped `RunEvent` projection. One store, replayed through the existing reducers = "one code path, live + history."

- [x] **P1a — backend raw-event writer — VERIFIED LIVE 2026-06-17.** New `src-tauri/src/chat_history.rs` (`HistoryLog`: lazy id keying + pre-id pending buffer + append-only `events.jsonl`, path-safe id, skips `stream_event` deltas). Hooked into `chat.rs`: `ingest_line` (all engines — claude/codex-exec/opencode/codex-app-server — records settled engine output + flushes the log id on `session_id` capture) and `chat_send` (records the user turn, text-only). Field added to `ChatSession` + all 3 constructions; `mod chat_history;` in `lib.rs`. `cargo check` clean. **Live verify passed:** user line landed first (pre-id flush works), then `system/init` + settled `assistant` (thinking+text) + `result` with full cost/usage, NO `stream_event` spam. *(known follow-up: stored lines carry no per-event `ts` yet — fine for P1d content replay; add a write-time stamp before P6 scrubber + resumed hover times.)*
- [x] **P1b — per-session metadata (on-demand) — gated.** Stateless `chat_history_meta(id)` command (chat_history.rs) computed from the log + file stats: `exists`, message/user/assistant/tool counts, `cost_usd`, `byte_size`, first/last ts (file ctime/mtime). Chose on-demand over an incremental meta.json file — simpler/robust, and the history pane reads only the visible rows. Title/engine/model/cwd come from `chat-sessions.json`; starred/segments arrive with P5/P2.
- [x] **P1c — `read_chat_history(id, fromSeq?, limit?)` + `src/lib/chatHistory.ts` — gated.** Returns `{total, from, lines}` (raw event rows, paginated by line index). Registered in lib.rs. End-to-end exercised by P1d.
- [~] **P1d — resume replays the store (full fidelity) — CODE COMPLETE, awaiting live run-verify.** New pure `replayHistoryToTurns(lines, uid)` (chatStream.ts, +2 tests) folds stored events through the live `reduceChatStreamEvent` and rebuilds the user-text + result turns. `resumeSession` (ChatPane.tsx) now tries `readChatHistory` first → replay; falls back to `readChatTranscript`/`transcriptToTurns` for foreign/legacy chats (D4). *(verify: rebuild, /resume the "what is my name" chat — should show the thinking block + answer + footer, not just text. Known gap: no hover times on replayed turns until per-event ts lands in the store, pre-P6.)*
- [x] **P1e — RunEvent `file.changed` — gated (+test).** Added the `file.changed` variant (path, adds, dels) to runEvents.ts; `reduceRunEvents` derives it from Edit/MultiEdit/Write tool calls (read-only tools emit none); persisted-state validator updated. `diff.ready` folded into P4's lazy-on-expand diff rather than a separate event. P4/P6 now have structured change data.
- [x] gates GREEN: `cargo check` 0 errors · `tsc` 0 errors · `test:chatpane` 125/125. Live run-verify pending only for P1d (GUI resume render).

## P2 — Compaction segmentation *(plan §3)* — signal confirmed: `system`/`compact_boundary`

> Real signal captured from a `/compact`: `{"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"manual","pre_tokens":27843,"post_tokens":1911,"duration_ms":17777,...}}` followed by a synthetic `isSynthetic` user message carrying the "continued from a previous conversation" summary.

- [x] **P2a — detect compaction — gated (+tests).** `detectCompaction(ev)` → `{trigger, preTokens, postTokens, durationMs}` + `compactionSummary(ev)` (synthetic summary, boilerplate stripped) in chatStream.ts.
- [x] **P2b — boundary persisted — gated.** No synthetic event needed: P1a already records the real `compact_boundary` + summary lines (not `stream_event`), so replay rebuilds the card straight from the store.
- [~] **P2c — collapsible CompactionCard + live path — CODE COMPLETE, awaiting live run-verify.** Quiet divider ("compacted · 27.8k → 1.9k tokens · saved 93% · manual") expanding to trigger/before/after/saved/took + the full summary. Wired into BOTH the live `handleEvent` (fixes the user-reported "nothing shows on compaction") AND `replayHistoryToTurns`; synthetic/replay plumbing suppressed so it never renders as a bogus user bubble. *(verify: rebuild → the compacted chat shows the card on resume; a fresh `/compact` shows it live.)*
- [ ] **P2d — (bonus) re-inject** "model lost this — re-attach turns N–M" via the existing `wirePrefix` path. Deferred.
- [x] gates GREEN: tsc 0 · test:chatpane 128/128 · build ✓ (no Rust change — reads what P1a already stores).

## P3 — Virtualized + legible reload *(plan §5)*

- [ ] **P3a — `@tanstack/react-virtual`** row windowing over `turns`, keyed by `turn.id`, measured-height cache; rebind the existing sticky-autoscroll + jump pill + scrubber to the virtualizer's scroll element.
- [ ] **P3b — segment-level windowing** (collapse all but latest segment on load; stubs expand on view).
- [ ] **P3c — recognition layer:** sticky date/segment header · collapsed-segment summaries · markdown render memoization.
- [ ] **P3d — lazy event paging** via `read_chat_history(fromSeq, limit)` as segments expand.
- [ ] gates + a synthetic 10k-message fixture + manual `verify`

## P4 — Change cards + diffs *(plan §6)*

- [ ] **P4a — collapsed change card** (file path → opens file pane, `+adds −dels`, lang pill) extending `toolDetail` for edit/multiedit/write.
- [ ] **P4b — inline expand:** upgraded hand-rolled differ (Myers/LCS add/remove/context + word-level highlights + syntax tint), 14-line cap lifted on expand.
- [ ] **P4c — "open full diff"** → Monaco `DiffEditor` (full file, gutter, word diff).
- [ ] **P4d — "Files changed in this chat"** roll-up (aggregate `file.changed`; ref thread-system task 4 `ChangesPanel`/`gitDiff.ts`).
- [ ] gates

## P5 — History pane + management *(plan §7, D5/D6)*

- [ ] **P5a — `HistoryPane.tsx` + sidebar entry + pane type** (register like terminal/agents/settings in `App.tsx` / `paneRouting.ts` / `paneBus.ts`).
- [ ] **P5b — browse & recognise:** grouped by date, per-row metadata, hover/expand preview, click → reducer replay.
- [ ] **P5c — `historyManage.ts` pure helpers** (+tests): timeframe→selection, keep-starred filter, group-by-date, trash-retention math.
- [ ] **P5d — curate:** ★ star · multi-select · "Clean up older than 1/3/6/12 mo" with preview + keep-starred default.
- [ ] **P5e — soft-delete trash** (`chat-history/.trash/`, recoverable N days) + Trash view (restore / purge) + export. Backend commands: `set_starred`, `delete_chats`, `restore_chats`, `purge_trash`, `export_chat`.
- [ ] gates

## P6 — Datetime scrubber *(plan §4)*

- [ ] **P6a — `chatTimeline.ts` pure helpers** (+tests): `buildTimeline`, `tickPositions`, `nearestTurnAtTime` — seq/segment-based, not pixels.
- [ ] **P6b — `ChatScrubber.tsx`:** time-tick rail + event minimap (user/assistant/compaction/file-change/error/approval markers) + drag-to-scroll with a date/time bubble + preview-on-hover + jump-to-date popover. Reuses `turnTimesRef`.
- [ ] gates

## P7 — Cross-history search *(plan §8)*

- [ ] **P7a — `search_chat_history(query)`** (ripgrep-style over JSONL) — titles, user/assistant text, file paths, commands.
- [ ] **P7b — deep-links** (`aios://chat/<id>#<seq>`) → open chat at the turn; wire into P5's search box + filters.
- [ ] gates

## P8 — Stretch *(plan §8)*

- [ ] turn-level bookmarks · export (md/json) · context/token timeline on the scrubber · re-inject lost context. Pick by appetite.

---

## Verification gates (every batch)
`npx tsc --noEmit` · `npm run test:chatpane` · `cargo check` (Rust batches) · `npm run build` (per phase) · live run-verify (GUI-only behaviors — store on disk, compaction signal, scroll feel).

---
*Maintained alongside the plan. When an item ships, mark `[x]` with its commit hash.*
