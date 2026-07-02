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
- [x] **P2c — collapsible CompactionCard + live path — CODE COMPLETE, awaiting live run-verify.** Quiet divider ("compacted · 27.8k → 1.9k tokens · saved 93% · manual") expanding to trigger/before/after/saved/took + the full summary. Wired into BOTH the live `handleEvent` (fixes the user-reported "nothing shows on compaction") AND `replayHistoryToTurns`; synthetic/replay plumbing suppressed so it never renders as a bogus user bubble. *(verify: rebuild → the compacted chat shows the card on resume; a fresh `/compact` shows it live.)*
- [ ] **P2d — (bonus) re-inject** "model lost this — re-attach turns N–M" via the existing `wirePrefix` path. Deferred.
- [x] gates GREEN: tsc 0 · test:chatpane 128/128 · build ✓ (no Rust change — reads what P1a already stores).

## P3 — Virtualized + legible reload *(plan §5)* — windowing approach revised (see P3a)

- [~] **P3a — native windowing via `content-visibility` (NOT @tanstack/react-virtual) — CODE COMPLETE, awaiting live verify.** Revised D2: a JS virtualizer would have to re-implement the already-tuned autoscroll + jump pill + find-scroll + minimap geometry, and that rewrite can't be GUI-verified here → high regression risk. Instead `.chat-block { content-visibility: auto; contain-intrinsic-size: auto 100px }` (App.css) lets Chromium/WebView2 skip layout+paint for off-screen turns while keeping the FULL DOM, so all those behaviors keep working untouched. 60fps scroll on long transcripts. *(JS windowing stays available if extreme 10k+ scale ever needs bounded mount — see P3b.)*
- [x] **P3c (partial) — recognition layer — gated.** (1) `Markdown` wrapped in `memo` so settled bubbles don't re-parse on every streamed token. (2) Sticky day header: `DaySeparator` is now `position: sticky; top:0` (frosted bar) so the current day pins as you scroll a multi-day chat. Collapsed-segment summaries deferred to P3b.
- [ ] **P3b — bound initial mount for huge reopens** (render-cap "↑ show earlier" and/or collapse-all-but-latest-segment). content-visibility gives 60fps scroll but still MOUNTS every block on reopen; this bounds that for 10k+ chats. Care: find/minimap must reveal blocks outside the window. NEXT sub-batch.
- [ ] **P3d — lazy event paging** via `read_chat_history(fromSeq, limit)` as the window grows.
- [x] gates GREEN (P3a/P3c): tsc 0 · test:chatpane 129/129 · build ✓. *(perf at 10k scale = live verify; no headless fixture run.)*

## Chat-pane rendering fixes (user-reported, 2026-06-17) — gated, awaiting live verify

- [~] **Thinking blocks now settle live.** Reducer settles the open thinking turn on the next `content_block_start` instead of only on the turn-ending `assistant` event. Root cause: server-tool turns (web_search) stream think→search→think→… as ONE message, so the settle fired only at the very end → every earlier "thought" stayed "thinking". +test (chatStream.ts).
- [~] **Markdown tables + rules + blockquotes.** `MarkdownBlocks` rewritten with an indexed loop: `| … |` + `|---|` → a real `<table>` (was raw pipes, user screenshot); `---`/`***`/`___` → `<hr>`; `>` → blockquote. Gates: tsc 0 · 130 tests · build ✓.
- [x] **AskUserQuestion answerable + cancellable (user-reported "tool not working").** The picker was `disabled={streaming}`, but the model BLOCKS waiting for the answer (streaming stays true) → un-answerable until you stopped the turn. Now: answerable while streaming; on submit, if still live we send a real `tool_result` (tool_use id) via `chatSendRaw` to unblock the SAME turn (else `dispatch` a fresh turn); stopping before answering shows a "cancelled" verdict (`askCancelled`). Memory [[askuserquestion-and-cwd-picker]] corrected (was "auto-denies"). Gates: tsc 0 · build ✓.

## P4 — Change cards + diffs *(plan §6)*

- [~] **P4b — interleaved diff + word-level 2-tone + accordion — CODE COMPLETE, gated, awaiting live verify.** `src/lib/textDiff.ts`: `lineDiff` (bounded LCS), `diffStat`, plus `wordDiff` + `refineDiff` for intra-line highlights (+tests). `DiffBlock`: interleaved context/removed/added; the whole changed line gets a light tint and the exact changed **tokens** a brighter one (GitHub-style 2-tone, per user screenshot); collapsed to a **6-line preview** with an "expand" **accordion** (.disclose). `embedded` mode lets ChangeCard own the frame.
- [~] **P4a — standalone always-visible `ChangeCard` — CODE COMPLETE, gated, awaiting live verify.** File-edit tools (Edit/Write/MultiEdit/NotebookEdit) render as a prominent card (file name + verb + `+adds/-dels` + click-to-open) with the diff **inline**, pulled OUT of the collapsible activity group. Fixes the user reports: edits no longer flash-then-collapse, the diff shows without a click, and the duplicate "open" `FileCard` is gone (edits leave the group → no artifact dup). Also fixed the **"N steps · N steps"** label dup (the count only complements a "Worked for Xs" label). `DiffBlock` gained an `embedded` mode (card owns the frame/stat).
- [ ] **P4c — "open full diff" — DEPRIORITIZED.** The ChangeCard header already opens the file in the editor pane. A true Monaco old↔new *full-file* diff needs the file's PRE-edit content, which the store doesn't capture (only the edit's old/new snippet) → not worth it now; the inline hunk diff covers the need.
- [~] **P4d — "Files changed in this chat" roll-up — CODE COMPLETE, gated, awaiting live verify.** `ChangedFilesBar` at the top of the transcript: a "N files changed · +adds/-dels" chip that expands (accordion) to the file list, each row opening the file in a pane. Aggregated from the edit/write tool turns; shows only when ≥1 file changed.
- [x] gates GREEN: tsc 0 · test:chatpane 137/137 · build ✓.

## P5 — History pane + management *(plan §7, D5/D6)* — DATA LAYER DONE, UI NEXT

- [x] **P5c — `historyManage.ts` pure helpers — gated (+4 tests).** `dateGroup`/`groupByDate` (today/yesterday/this week/this month/older), `monthsAgoCutoff`, `selectForCleanup` (timeframe + keep-starred), `expiredTrash` (retention). 141 tests total.
- [x] **P5-backend — management commands — gated (cargo 0).** `chat_history.rs`: `list_chat_history` (resume index − trashed + starred flag), `set_starred` (stars.json), `delete_chats` (soft-delete → `.trash/<id>/` + `manifest.json`, also pulls the entry from the /resume index), `restore_chats`, `purge_trash` (ids or all), `list_trash`, `export_chat` (md/json). Registered in lib.rs; `chatHistory.ts` wrappers added. Decoupled: trash dir + manifest, the index edited as generic JSON (no struct coupling).
- [~] **P5a — `HistoryPane.tsx` + sidebar entry + pane type — CODE COMPLETE, awaiting GUI verify.** Added `{type:"history"}` to apps.ts `PaneContent` + a firstClass `SPAWN` entry (History icon) so it seeds into the sidebar (loadSidebar reconciles new apps into existing rails), + App.tsx lazy-import + render branch; threaded a new `onResumeChat` prop (→ App's `resumeChat`) so a row click reopens the chat. New 10.7kb lazy chunk.
- [~] **P5b — browse & recognise UI — CODE COMPLETE.** Grouped by date (`groupByDate`) with a pinned ★ starred group on top; each row: ★ toggle · title · `engine·model · time · cwd`; click → resume. Live search box (title/last_user/cwd). Empty/loading/no-match states.
- [~] **P5d — curate UI — CODE COMPLETE.** Per-row ★ star (optimistic), checkbox multi-select → action bar (export / delete), and a "Clean up ▾" menu (older than 1/3/6/12mo) → `selectForCleanup` (keep-starred) → a confirm bar before moving to trash.
- [~] **P5e — Trash view UI — CODE COMPLETE.** A "Trash · N" toggle → restore / delete-forever per row + "empty trash". Export copies markdown (`exportChat`) to the clipboard.
- [x] gates GREEN: tsc 0 · test:chatpane 141/141 · build ✓ (HistoryPane lazy chunk). *(GUI verify: sidebar "history" entry → browse/star/select/cleanup/trash/resume.)*
- [~] **P5 resume fix + restyle (user-reported "can't load conversation") — CODE COMPLETE.** Opening from history showed "No conversation found" / an empty pane. Two causes fixed: (1) `resumeChat` (App.tsx) now passes **`cwd`** so claude `--resume` runs in the SAME project dir the chat was recorded in — else claude can't find the session (verified: both the durable store + claude transcript existed, the cwd was just missing). (2) A fresh resumed pane now **repaints from the durable store on mount** (claude `--resume` continues the thread but never re-emits past turns → empty pane). Plus a row **restyle**: select/★ hover-reveal (gold+always when starred), engine-color dot, more breathing room, selected-row highlight. Gates: tsc 0 · build ✓.
- [~] **Resume opens at the LATEST message + per-event `ts` store (user-reported) — CODE COMPLETE.** (1) A freshly loaded/resumed conversation jumps to the **bottom** (one-shot `forceBottomRef` consumed in the autoscroll layout effect, set by both repaint paths) — was sitting at the first message. (2) The store writer now stamps each event with `_ts` (write-time ms — stays a valid event, ignored by reducers); `replayHistoryToTurns` reads it → resumed turns carry `createdAt` (hover times + day separators). Old pre-stamp rows just have no time (graceful). **This is the prerequisite the P6 scrubber needs.** Gates: cargo 0 · tsc 0 · 141 tests · build ✓.

## P6 — Datetime scrubber *(plan §4)* — CODE COMPLETE, awaiting GUI verify

- [x] **P6a — `chatTimeline.ts` pure helpers — gated (+4 tests).** `markerStyle` (tick color/size by kind+error), `nearestTick` (closest tick by scroll frac — drag/hover), `dayBoundaries` (day-change tick indices), `fmtTickTime` (clock/date bubble label). 145 tests.
- [~] **P6b — scrubber (enhanced the existing W4-3 minimap, NOT a separate `ChatScrubber`) — CODE COMPLETE.** The minimap rail now: **drag to scrub-scroll** with a floating **time + snippet bubble** (`railScrubTo`/`railFrac`/`nearestTick` + `tickLabel`); **hover** shows the same preview; **day-boundary hairlines**; richer marker colors (compaction=info, change=success, ask/approval=warning, user=accent, error=danger); per-tick click-to-jump kept. Times come from `turn.createdAt` (the P6-prereq `_ts`) via `blockTime`. A separate `ChatScrubber.tsx` would have duplicated the minimap, so it was enhanced in place.
- [x] gates GREEN: tsc 0 · test:chatpane 145/145 · build ✓.

## P7 — Cross-history search *(plan §8)*

- [x] **P7a — `search_chat_history(query)`** (chat_history.rs): scans every durable log, fast-reject via lowercase `contains`, then parses user/assistant `message_text` for precise match counts, joins the /resume index, returns `Vec<SearchHit>` (id/title/cwd/mtime/engine/model/last_user/starred + `snippet` + `matches`). `make_snippet` = char-safe ~140-char window with … elision. Registered in lib.rs; `searchChatHistory`/`SearchHit` in chatHistory.ts.
- [x] **P7a UI** — HistoryPane: debounced (280ms) `searchChatHistory` → `contentHits`; `searchResults` memo unions content hits (with snippet) + client title/cwd/last_user matches over loaded rows, newest first; ≥2-char trigger; result rows show a 2-line snippet + "· N matches"; search-vs-browse body branch (browse = pinned starred + grouped-by-date).
- [x] **P7b — deep-link to the matched message.** Opening a search result carries the query through `resume.findText` (apps.ts PaneContent → App `resumeChat` → ChatPane `resume` prop). On mount-repaint, once the transcript paints, ChatPane opens its existing **in-chat find bar** pre-filled with the query — the find machinery scrolls to + highlights (`find-current`) the first matching block. Reuses the W4 find system (no fragile line-index→turn-index map; no backend change). No-match → find bar opens empty and the forced-bottom stands. Row tooltip switches to "open at the matching message" while searching.
- [x] gates GREEN: tsc 0 · test:chatpane 145/145 · build ✓ · cargo 0.

## P8 — Stretch *(plan §8)*

- [ ] turn-level bookmarks · export (md/json) · context/token timeline on the scrubber · re-inject lost context. Pick by appetite.

---

## 2026-06-23 — live trust-pass fixes + response branching (gated: tsc 0 · 169 tests · build ✓)

The user ran the Tier-0 trust pass against this epic and surfaced three live issues; all
fixed + one new feature. Build-verified; final GUI-verify is the user's. (Marks the P2c +
AskUserQuestion items above as done.)

- [x] **Compaction empty frame + no progress indicator.** A `/compact` rendered a hollow
  "AIOS · worked 30s" frame and showed nothing while running. Root cause: the LIVE result
  path composed the duration ("30s") as the footer text, so the empty result still rendered
  (the replay path already skipped it — see chatStream.ts:428). Fixed at the SOURCE (`ChatPane`
  result handler): an ok result with no tokens + no message emits an EMPTY footer → no result
  block → no frame. The working indicator now reads "Compacting context…" during a `/compact`.
  (My first attempt gated suppression on "result has text" — dead code, since the duration IS
  the text; corrected.)
- [x] **AskUserQuestion answer "came through empty".** The earlier `tool_result` injection
  rested on a WRONG premise: the claude CLI AUTO-DISMISSES AskUserQuestion in headless /
  stream-json mode (no TTY), so the model never blocks — injecting a `tool_result` for the
  already-resolved tool_use id arrived as a contentless user turn. Fixed: answer as a plain
  follow-up user message (queued if a turn is mid-flight), which reliably reaches the model.
  (The model may still SAY "dismissed" first — CLI behavior, not suppressible.) Memory
  [[askuserquestion-and-cwd-picker]] re-corrected.
- [x] **Response branching (NEW) — the ‹N/M› switcher.** Regenerate no longer stacks a 2nd
  answer; it's a switchable VARIANT. New pure `src/lib/chatBranching.ts` (+8 tests) segments
  the transcript into response variants (runs between user turns, delimited by results);
  `ChatPane` renders only the active variant + a ‹N/M› nav in the frame header; reconstructs
  free on reload (derived from turn order). DISPLAY-level only — the model's context still
  holds every variant (the CLI owns context). **True context-forking deferred to the BYO-key
  API epic** (Tier 4 of `REVIEW-2026-06-22-go-to-harness.md`).

## Verification gates (every batch)
`npx tsc --noEmit` · `npm run test:chatpane` · `cargo check` (Rust batches) · `npm run build` (per phase) · live run-verify (GUI-only behaviors — store on disk, compaction signal, scroll feel).

---
*Maintained alongside the plan. When an item ships, mark `[x]` with its commit hash.*
