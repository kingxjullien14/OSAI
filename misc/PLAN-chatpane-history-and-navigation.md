# PLAN — ChatPane durable history, time navigation & change previews

> Reviewed — decisions locked 2026-06-17 (see §9) · grounded in the real code (anchors are `file:line`).
> Scope: the six asks below + improvements. Sequential/solo build (no agent fan-out).
>
> **The asks (verbatim, paraphrased):**
> 1. Save the **whole** conversation history locally, **safe from compacting**, always referable.
> 2. A **datetime scrubber** on the scroll — fast-forward scroll and jump straight to a date/time.
> 3. On every **compact**, add a **segmentation** divider marking what's been compacted.
> 4. **Jump back into a conversation** and load the whole history — **without lag** (optimisation).
> 5. A **history pane** — conversations list with time, last conversed, context, etc.
> 6. When the AI edits/writes code, show a **change preview** + an **expand** to the detailed per-step diff.
> 7. Improve on the idea / add more that makes it interesting and usable.
>
> **Decisions — locked 2026-06-17 (details in §9):** D1 JSONL · D2 `@tanstack/react-virtual`
> + a "recognition layer" (sticky date/segment headers, scrubber preview-on-hover, segment
> summaries) · D3 light inline diff cards + Monaco `DiffEditor` on "open full" · D4 new chats get
> the full store, old ones fall back to text-only replay · D5 keep forever **+ a full management
> system** (star, multi-select, bulk-delete-by-timeframe excluding starred, soft-delete trash) ·
> D6 History is a new **sidebar pane**. Quality over speed — no ship-fast pressure.

---

## 0. TL;DR — the one decision that unlocks all six

Today the transcript you "resume" is **the engine's own file** (`~/.claude/projects/*/<id>.jsonl`,
or a codex rollout), and we parse **only user/assistant text** out of it
(`parse_claude_transcript`, [chat.rs:2774](../src-tauri/src/chat.rs)). Tool calls,
thinking, diffs, approvals, costs — all dropped on reload. Worse, those files are the
engine's to **compact and prune**: the very thing you want to be safe from.

So the spine of this whole plan is **one new thing**:

> **A durable, append-only, full-fidelity history store that AIOS owns** — written by the
> Rust backend as events stream, independent of the engine's files, never compacted by anyone
> but us, and replayed through the *same* reducer the live stream uses.

Everything else (scrubber, segmentation, fast reload, history pane, diff previews) is a **read
view over that store**. Build the store first; the five UI features become additive.

This also matches the direction already written down:
- `PLAN-chatpane-daily-driver.md` → *"Adopt JSONL-per-session rollout for chat (date-bucketed,
  append-only, greppable) … resume replays through the live reducer + an index powers a fast
  session switcher."* This plan is that bet, made concrete and justified by a real need.
- `docs/superpowers/plans/2026-06-01-aios-codex-grade-thread-system.md` → task 2 makes
  **`RunEvent` the source of truth** and has `Turn` derive from it. We persist the `RunEvent`
  stream. This plan is the *durable-history + navigation* slice of that epic.

---

## 1. Current state (verified on disk)

| Area | What exists today | Gap for this plan |
|---|---|---|
| In-memory model | `ChatTurn` union (`user`/`assistant`/`thinking`/`tool`/`approval`/`result`) — [chatStream.ts:3](../src/lib/chatStream.ts). `RunEvent` model + reducer in `runEvents.ts`, kept in parallel ([ChatPane.tsx:1613](../src/components/ChatPane.tsx)). | `RunEvent` is the richer stream but isn't yet the persisted source of truth. |
| Persisted transcript | Engine's JSONL, read via `read_chat_transcript` → **text-only** turns ([chat.rs:2746](../src-tauri/src/chat.rs)). | Lossy + engine-owned + compactable. Need our own full store. |
| Session index | `~/.aios/state/chat-sessions.json`: `{id,title,cwd,mtime,engine,model,last_user}`, capped 200, mtime-sorted ([chat.rs:2581](../src-tauri/src/chat.rs), `record_chat_session` :2596, `list_chat_sessions` :2668). Powers `/resume`. | A good seed for the history pane; missing counts/context/segments/search. |
| Per-turn time | `turnTimesRef: Map<id, ms>` — real transcript time or live stamp ([ChatPane.tsx:1320](../src/components/ChatPane.tsx), used :4482). | Perfect substrate for the scrubber — already there. |
| Run-event persistence | `localStorage["aios.chat.run-events:<id>"]` ([ChatPane.tsx:869](../src/components/ChatPane.tsx), :918–942). | localStorage is ~5–10 MB/origin, not crash-safe, not synced. Move durable copy to disk. |
| Scroll | Sticky-pause autoscroll + "jump to latest" pill ([ChatPane.tsx:2055](../src/components/ChatPane.tsx), pill :4916). | No time scrubber, no event minimap. |
| Diffs | Hand-rolled red/green `DiffBlock`, 14-line cap, collapsible ([ChatPane.tsx:5475](../src/components/ChatPane.tsx)); `toolDetail` renders Edit/Write/Bash/Todo ([:5398](../src/components/ChatPane.tsx)). `monaco-editor` is a dependency. | No per-step change *card*, no full-file diff, no roll-up of "files changed this chat". |
| Compaction | **Nothing.** | Greenfield — detect + segment + (bonus) re-inject. |

**Hard constraints to respect**
- `model` / `permission` / `effort` / `cwd` are **session-restart effect deps** — changing any
  tears down and re-spins the engine (`PLAN-chatpane-daily-driver.md` "sharp architectural edge").
  Anything that reloads history must NOT thrash these.
- Backend already supports **detached sessions** (turn keeps running with the pane closed). The
  store must be written **backend-side** so history is captured even when no pane is mounted.
- House style: lean deps, pure-helper-+-test before renderer wiring (see `chatPaneState.test.ts`),
  `pnpm test:chatpane` + `pnpm build` (+ `cargo check`) as the gate.

---

## 2. Feature 0 — the durable history store (foundation)

**Goal.** Every conversation is written to an AIOS-owned, append-only log the moment events
stream, captured backend-side (survives pane close / app quit / engine compaction), and replayable
at full fidelity.

### 2.1 Storage layout
```
~/.aios/state/chat-history/
  index.json                      # fast list for the history pane (see §7)
  <sessionId>/
    events.jsonl                  # append-only RunEvent log (source of truth)
    meta.json                     # title, engine, model, cwd, counts, segments, first/last ts
```
- **JSONL, append-only** — crash-safe (a torn last line is just skipped), greppable, trivial to
  tail, and matches the "date-bucketed append-only rollout" bet. One object per line:
  `{seq, ts, type, ...payload}` where `type` is the `RunEvent` discriminant.
- We control retention. **We never compact this** (or only on an explicit, user-driven "archive
  old chats" action). This is the "safe from compacting" guarantee.

> **Decision D1 — format.** JSONL + a JSON `index.json` (recommended: zero new deps, append-only,
> greppable). Alternative: SQLite for O(log n) search/scan at thousands of chats — revisit only
> when the JSON index gets slow. Start JSONL; the index is swappable behind a Rust trait.

### 2.2 Who writes it
- **Backend (Rust), in `ingest_line`** ([chat.rs](../src-tauri/src/chat.rs) ~:1269) — the single
  choke point every engine's normalized stream already flows through. Append each adapted event to
  `events.jsonl`; update `meta.json` counters on `result`/compaction. This is the same place the
  6000-line ring buffer + usage re-read already hook in, so history capture inherits
  **detach-survival for free**.
- Keep the existing `localStorage` run-event cache as a fast warm-start; the disk log is the
  durable truth. On mount, read disk; fall back to localStorage; fall back to engine transcript.

### 2.3 Replay path (one reducer, live + history)
- New `read_chat_history(id, {fromSeq?, limit?})` Tauri command streams stored `RunEvent`s back.
- Frontend feeds them through the **existing `runEvents.ts` reducer** → identical render to live.
  This kills today's lossy `transcriptToTurns` ([ChatPane.tsx:2777](../src/components/ChatPane.tsx))
  for AIOS-owned chats (keep it as the fallback for foreign/legacy sessions).
- Paginated by `seq` so we can lazy-load (feeds §5 virtualization).

**Effort:** L (the spine). **Risk:** event schema completeness — must capture file-change/diff
payloads (thread-system task 2 "extend RunEvent for `file.changed`, `diff.ready`"). Land that
extension here since §6 depends on it.

---

## 3. Feature 1 — compaction segmentation

**Goal.** Each compaction draws a labeled divider; everything above it is a closed **segment**.

### 3.1 Detect a compaction (verify exact signal during build)
- **claude** headless stream: a compaction surfaces as a `system` event and the transcript gains a
  summary marker (claude writes an `isCompactSummary`/summary line). **Verify the precise shape
  live** — capture one compaction's raw lines first, then key off it. (Cheap to do: trigger
  `/compact`, log the stream.)
- **codex** app-server: compact is a distinct turn kind — `PLAN-chatpane-daily-driver.md` notes
  *"`review` and `compact` turns reject steer"*, so the turn-kind is already on the wire; emit a
  segment boundary when a compact turn completes.
- Normalize both into one **synthetic `RunEvent`**: `{type:"compaction", ts, reason, beforeSeq,
  tokensBefore, tokensAfter, summary?}`. Persist it (§2) like any event.

### 3.2 Render
- A full-width divider in the transcript: `─── compacted · Jun 17, 14:32 · 48k→9k tokens ───`,
  with a chevron to **collapse the whole segment above it** (keeps the DOM light — pairs with §5).
- Segments are first-class in `meta.json` (`segments: [{seq, ts, tokensBefore, tokensAfter}]`) so
  the scrubber (§4) and history pane (§7) can show "3 compactions" and offsets without re-scanning.

### 3.3 Bonus that makes the "safe archive" pay off — **re-inject**
Because the pre-compaction turns are safe on disk, add a divider action:
**"the model lost this — re-attach turns N–M"** → pulls the selected stored turns and prepends them
to the next send (reuse the existing `wirePrefix` path in `dispatch`,
[ChatPane.tsx:2224](../src/components/ChatPane.tsx)). Turns the archive from read-only into a
recovery tool. *(Stretch within this feature; gate behind the store landing.)*

**Effort:** M. **Risk:** the detection signal — isolate it behind one `detectCompaction(ev)` helper
with a test so a future engine change is a one-line fix.

---

## 4. Feature 2 — datetime scrubber + event minimap

**Goal.** A vertical rail beside the transcript: drag to fast-scroll, with **time ticks** you can
jump to, plus **markers** for meaningful events — a table of contents for the conversation.

```
 transcript ▕ rail
            ▕  ● 09:14  ← user msg
            ▕  │
            ▕  ◆ 09:18  ← compaction
            ▕  + 09:21  ← file change
            ▕  ! 09:25  ← error
            ▕  ● 11:02  ← (after a gap) today
   [now] ──▶▕  ▼
```

### 4.1 Data — already mostly there
- `turnTimesRef` ([ChatPane.tsx:1320](../src/components/ChatPane.tsx)) gives `(turnId → ms)`.
  Build a derived `timeline: {id, ts, kind, y}[]` memo from `turns` + `turnTimesRef`, where `y` is
  the row's offset (measure via `getBoundingClientRect` / an `IntersectionObserver`, or a
  ResizeObserver-backed offset map).
- `kind` drives marker glyph/color: user · assistant · compaction · file-change · error · approval.

### 4.2 Interaction
- **Drag the rail** → scroll proportionally; a floating bubble shows the date/time under the cursor
  (like a video scrubber). Release → `scrollTo` that offset.
- **Tick rail**: day/hour ticks at the left; clicking a tick jumps to the first turn ≥ that time.
- **"Jump to date"** affordance: a tiny date/time popover (jump to "yesterday 3pm", or pick).
- Markers are clickable; hovering shows a one-line preview.
- Respect `prefers-reduced-motion` (the codebase already does — jump pill uses it,
  [ChatPane.tsx:2165](../src/components/ChatPane.tsx)) — instant vs smooth.

### 4.3 Implementation
- New `src/components/ChatScrubber.tsx` + pure `src/lib/chatTimeline.ts`
  (`buildTimeline`, `tickPositions`, `nearestTurnAtTime`) with tests — matches house pattern.
- Coexist with the existing sticky-pause autoscroll: dragging the rail = an explicit user scroll →
  set `pausedRef` (reuse `setPaused`, [ChatPane.tsx:2082](../src/components/ChatPane.tsx)); the
  jump-to-latest pill already covers the way back.

**Effort:** M. **Risk:** offset measurement with variable-height rich rows + virtualization (§5) —
the timeline must map `ts → seq → estimated offset`, not absolute pixels, once rows are windowed.
Design `chatTimeline.ts` against **seq/segment**, not pixels, from day one.

---

## 5. Feature 3 — load the whole history without lag (virtualization)

**Goal.** Reopen a 10,000-message chat and it opens fast, scrolls at 60fps, **and stays legible
while you scroll** — you can recognise where you are and what you're looking for even when you
don't remember the exact words. (That second half is your D2 note, and it's a feature, not a side
effect — see "Recognition layer" below.)

### Decision D2 — locked: `@tanstack/react-virtual` + a recognition layer
You don't need this to ship fast, you need it to **load properly and stay browsable** — which
argues *for* the battle-tested headless virtualizer, not against it. The hard part is correct
variable-row windowing with stable scroll anchoring, and that's exactly what a mature lib gets
right. It's a small headless dep (no UI, ~few KB), React-19-ready, and the codebase already carries
heavier deps (monaco, xterm). We spend the "take your time" budget on correctness + the recognition
layer, not on re-deriving windowing math.

### Two windowing layers (both — each also serves legibility)
1. **Segment-level windowing.** Collapse all but the **latest segment** on load (segments from §3).
   Older segments render as a one-line summary stub — `▸ 142 messages · Jun 16 · "debugging the
   psmux status bar"` — expanding on click / when scrolled into view. This both cuts the DOM *and*
   gives you a skimmable table of contents as you scroll up.
2. **Row windowing** (`@tanstack/react-virtual`) inside an expanded segment, so even one huge
   segment scrolls smoothly. Keyed by the stable `turn.id`; a measured-height cache handles
   variable row heights (markdown, diffs). The existing sticky-autoscroll + jump pill + scrubber
   all bind to the virtualizer's scroll element.
3. **Lazy event load.** Page older events in via §2's `read_chat_history(fromSeq, limit)` as
   segments expand — never materialise the whole log up front.

### Recognition layer — "see what I'm scrolling through" (your D2 emphasis)
The part that makes a long history *findable* without remembering exact words:
- **Sticky date/segment header.** A pinned bar at the top of the viewport always shows the current
  date + segment as you scroll (WhatsApp/Photos-style "Jun 16" sticky). You never lose your place.
- **Scrubber preview-on-hover** (§4). Hovering the rail shows a floating card with that turn's
  timestamp + first line; dragging shows a live preview bubble — scrub to *recognise*, then release.
- **Collapsed-segment summaries.** The one-line stubs above double as skim targets.
- **In-place find (⌘F)** within the open chat (highlight + next/prev), distinct from cross-history
  search (§7/§8). Both jump via seq, so they work under virtualization.

### Care points
- Markdown render is the per-row cost — memoize rendered blocks by `(turn.id, text.length)`; today
  every row re-renders. (A win even before windowing.)
- Keep `turnsRef` as the full logical list; the virtualizer only governs what's **mounted**.
- Design the scrubber/timeline against **seq/segment**, not pixels (see §4.3), so it stays correct
  when rows are windowed.

**Effort:** L (done properly: lib integration + recognition layer + autoscroll/scrubber rebind).
**Risk:** autoscroll/scrubber regressions — gate on a synthetic 10k-message fixture + a manual
`verify` pass.

---

## 6. Feature 4 — code change preview + expandable per-step diffs

**Goal.** When the AI edits/writes code, show a tight **change card**; expand → full per-step diff.

### 6.1 Card (collapsed, default)
Replace/extend `toolDetail` for `edit`/`multiedit`/`write` ([ChatPane.tsx:5398](../src/components/ChatPane.tsx)):
```
 ✎ src/components/ChatPane.tsx   +12 −3   ▸ expand
```
- File path (clickable → opens the file pane — pane bus already exists), `+adds −dels` stat,
  language pill. For `multiedit`, one card per hunk or a rolled-up stat with N hunks.
- Pull adds/dels from the Edit `old_string`/`new_string` already in the tool input.

### 6.2 Expand (detailed diff)
- Inline expand grows to the full diff (today's `DiffBlock` is the seed — keep its red/green +
  `.disclose` grow animation, [ChatPane.tsx:5475](../src/components/ChatPane.tsx)), **lifting the
  14-line cap** when expanded.
- **Decision D3 — locked: light inline cards + Monaco on "open full".** Inline expand uses an
  upgraded hand-rolled differ — real add/remove/context lines (small Myers/LCS), intra-line
  word-level highlights, syntax tint — keeping it cheap to mount. A separate **"open full diff"**
  affordance opens the already-bundled **Monaco `DiffEditor`** (gutter, word diff, full file).
  *Why not Monaco inline:* one editor instance per edit step, multiplied by virtualized
  mount/unmount (§5), is a memory/perf trap — Monaco is perfect for a single focused full view,
  wrong for dozens of inline cards.
- A **"view at this step"** toggle: old vs new vs unified.

### 6.3 Roll-up — "Files changed in this chat"
- Aggregate all `file.changed` RunEvents (thread-system task 2 extension) into a per-conversation
  changeset surface — overlaps **thread-system task 4 `ChangesPanel`/`gitDiff.ts`**; build the
  per-step card here, reference task 4 for the git-backed panel. A header chip `◑ 7 files changed`
  opens it.

**Effort:** M. **Risk:** large `write` content flooding — keep the collapsed card cheap; only
materialize the diff DOM on expand (lazy).

---

## 7. Feature 5 — the history pane

**Goal.** A full history **management** surface — browse, recognise, search, and curate past
conversations. A new **sidebar pane** (D6), not a picker.

### Seed data is already on disk
`~/.aios/state/chat-sessions.json` ([chat.rs:2581](../src-tauri/src/chat.rs)) already has
`{id,title,cwd,mtime,engine,model,last_user}`. Enrich `meta.json` (§2) with: message count,
first/last ts, segment/compaction count, cumulative cost, last context %, **starred** flag,
byte size, and a 1-line auto-summary.

### UX
```
┌ History ───────────────── ⌕ search ─┐
│ ★ Windows psmux port      2h ago     │  opus 4.8 · 142 msgs · 3 compactions
│   AIOS-Superapp · "test the…"        │  ◑ 7 files · $0.42
│   ─────────────────────────────────  │
│   Composer pills layout   yesterday  │  gpt-5.5 · 38 msgs
│   …                                  │
└──────────────────────────────────────┘
```
### Browse & recognise
- Group by **today / yesterday / this week / this month / older**; sort by last-conversed.
- Each row: title, engine+model, msg count, compaction count, last context %, cost, cwd, ★ star.
- Hover/expand a row → a few-line **preview** (first user message + last exchange) so you can
  recognise a chat without opening it — pairs with the in-chat recognition layer (§5).
- Click → resume **into the live reducer replay** (§2), opening at the last turn (the scrubber, §4,
  lets you rewind). A search hit opens at that exact turn.

### Search & filter (the "I don't remember exactly" path)
- A search box over **all** history (backend `search_chat_history`, §8) — matches titles, user
  messages, assistant text, file paths, commands. Results list the chat + the matching turns;
  picking one deep-links into the chat at that turn.
- Filters: starred-only, by engine/model, by project (cwd), by date range.

### Curate — the management system (D5: keep forever, but let me prune)
Nothing auto-deletes; you stay in control:
- **★ Star** a conversation (toggle per row). Starred float to a pinned group and are the unit the
  cleanup tools protect.
- **Multi-select** (checkbox / shift-click / "select all in group") → bulk **star**, **export**, or
  **delete**.
- **Clean up…** flow: pick a scope (*older than 1 / 3 / 6 / 12 months*, or a custom date range) →
  it shows a **preview** (N chats, total size, X starred) → a checkbox **"keep starred"**
  (default on) → confirm. This is your "delete a timeframe but exclude starred".
- **Soft-delete (trash).** Delete moves `<sessionId>/` to `chat-history/.trash/` (recoverable for N
  days, then purged) rather than `rm` — because "keep everything forever" means an accidental delete
  must be undoable. A **Trash** view restores or permanently purges.
- **Export** before/instead of delete (md or json; §8) so pruning never means data loss you didn't
  choose.

### Wiring
- New `src/components/HistoryPane.tsx` + a **sidebar entry** registered like the other panes
  (terminal / agents / settings) — see the sidebar + pane router in `src/App.tsx` and
  `src/lib/paneRouting.ts` / `paneBus.ts`. Reachable in one click (D6).
- Backend `chat_history.rs` (§12) owns: list/enrich `index.json`, `set_starred`, `delete_chats`
  (→ trash), `restore_chats`, `purge_trash`, `search_chat_history`, `export_chat`. The pane only
  **reads** + issues these commands; backend stays the sole writer (keeps `index.json` and
  per-session `meta.json` in sync).
- Replaces today's `/resume` picker as the primary surface (`listChatSessions`,
  [chat.ts:74](../src/lib/chat.ts)); keep a slim `/resume` quick-switcher for keyboard flow.

**Effort:** L (a real management surface, not a list). **Risk:** destructive actions — mitigated by
soft-delete trash + explicit preview/confirm + keep-starred default.

---

## 8. Stretch — the things that make it *interesting* (ride free on the store)

Once AIOS owns a full, greppable log, these are mostly read-views:

1. **Full-text search across all history** — backend `search_chat_history(query)` greps the JSONL
   logs (ripgrep-style; D1 is JSONL, so no index to maintain — add a SQLite FTS index only if scan
   latency ever bites). Powers the History pane's search box (§7); results jump to the exact turn
   (deep-link below). The feature that makes a durable archive actually *useful*, not just safe.
2. **Deep-links to a turn** — every turn has a stable id+seq; `aios://chat/<id>#<seq>` opens the
   chat at that turn (scrubber centers it). Powers search hits, bookmarks, "go to where we decided
   X".
3. **Bookmarks / pins on turns** — star a turn; a jump-list in the scrubber. Cheap given seq ids.
4. **Export / share a conversation** — md or json, whole or a segment range. Trivial once we own
   the log; pairs with the existing handoff/"create a clean handoff" prompt
   ([ChatPane.tsx:3456](../src/components/ChatPane.tsx)).
5. **Context/token timeline** — plot context-window fill over time on the scrubber and mark *why*
   each compaction fired. Usage data already flows (`usage` synthetic events; `SidebarUsage.tsx`).
6. **Crash-safety** — because the store is append-only and backend-written, an app crash mid-turn
   leaves the partial answer on disk; on relaunch, replay shows it. (Falls out of §2 for free.)
7. **Cross-machine** — the sync work (per memory: `feat/cross-machine-sync`) can sync
   `~/.aios/state/chat-history/` so history follows you. Out of scope here, but the layout is
   chosen to make it a copy job.

---

## 9. Decisions — locked 2026-06-17

All resolved with you. Quality bar over ship speed (your call: *"it can take long … as long as it
satisfies what I want"*).

- **D1 — store format → JSONL.** Append-only JSONL per session + a JSON `index.json`. No SQLite
  unless search scan latency ever bites (§8). *(→ §2, §8)*
- **D2 — virtualization → `@tanstack/react-virtual` + a recognition layer.** Headless windowing for
  a "loads properly" big history, plus sticky date/segment headers, scrubber preview-on-hover, and
  collapsed-segment summaries so you can *recognise* history while scrolling. *(→ §5)*
- **D3 — diff renderer → light inline cards + Monaco `DiffEditor` on "open full".** Hand-rolled
  inline (word-level, syntax tint) stays cheap under virtualization; Monaco for the focused full
  view. *(→ §6)*
- **D4 — scope → recommended.** New chats get the full store; old claude/codex chats fall back to
  today's text-only replay. No risky migration. *(→ §2)*
- **D5 — retention → keep forever + full management.** Never auto-delete. Star conversations;
  multi-select; bulk "clean up older than <timeframe>" with a **keep-starred** option; soft-delete
  **trash** (recoverable) instead of a hard `rm`. *(→ §7)*
- **D6 — placement → History is a new sidebar pane.** First-class, one-click, registered like the
  other panes. The scrubber lives in the ChatPane gutter. *(→ §7, §4)*

---

## 10. Suggested build order

| Phase | Ships | Why first |
|---|---|---|
| **P1 — Store spine** (§2) + RunEvent `file.changed`/`diff.ready` extension | Durable full-fidelity log, backend-written, replayed via the live reducer. | Everything reads this. The "safe from compacting" guarantee lands here. |
| **P2 — Compaction segments** (§3) | Divider + collapsible segments + segment metadata. | Small, high-signal; segments are the unit P5 + P3 lean on. |
| **P3 — Virtualized + legible reload** (§5) | Segment + row windowing (`@tanstack/react-virtual`) + recognition layer (sticky headers, preview-on-hover, segment summaries). | "Loads properly" *and* stays browsable — your core D2 ask. |
| **P4 — Change cards** (§6.1–6.2) | Per-step preview + expandable diff. | Self-contained; upgrades `DiffBlock`/`toolDetail` in place. |
| **P5 — History pane + management** (§7) | Sidebar pane: browse/recognise/search + star, multi-select, clean-up-by-timeframe (keep-starred), soft-delete trash. | The full D5/D6 management system; reads P1's metadata. |
| **P6 — Scrubber** (§4) | Time rail + event minimap + jump-to-date + preview-on-hover. | Best once P3 windowing + P2 segments exist (maps time→seq). |
| **P7 — Cross-history search** (§8) | `search_chat_history` + deep-links wired into P5's search box. | Needs P1's store + P5's pane; central to "find what I don't remember". |
| **P8 — Stretch** (§8) | Turn-level bookmarks, export, re-inject lost context, context/token timeline. | All read-views over P1; pick by appetite. |

Each phase: pure helpers + tests first (`pnpm test:chatpane`), then renderer; gate on
`pnpm build` + `cargo check`; one manual `verify` pass per UI phase.

---

## 11. Key files cheat-sheet

| What | Where |
|---|---|
| In-memory turn union | `src/lib/chatStream.ts:3` |
| RunEvent model / reducer | `src/lib/runEvents.ts`; used `ChatPane.tsx:1613` |
| ChatPane state / refs | `turns` `ChatPane.tsx:915`, `turnsRef` :916, `turnTimesRef` :1320 |
| Run-event localStorage | `ChatPane.tsx:869`, :918–942 |
| Autoscroll + jump pill | `ChatPane.tsx:2055`–:2174, pill :4916 |
| Transcript replay (lossy, to replace for owned chats) | `transcriptToTurns` `ChatPane.tsx:2777`; `resumeSession` :2789 |
| Diff / tool detail | `DiffBlock` `ChatPane.tsx:5475`; `toolDetail` :5398 |
| Backend ingest (write store here) | `ingest_line` `src-tauri/src/chat.rs` ~:1269 |
| Session index + commands | `chat.rs:2581` (path), `record_chat_session` :2596, `list_chat_sessions` :2668, `read_chat_transcript` :2746, `parse_claude_transcript` :2774 |
| Frontend chat API | `src/lib/chat.ts` (`listChatSessions` :74, `readChatTranscript`) |
| Usage data (for context timeline) | `usage.rs`; `SidebarUsage.tsx` |
| Related plans | `misc/PLAN-chatpane-daily-driver.md`; `misc/PLAN-chatpane-steer-usage-detach.md`; `docs/superpowers/plans/2026-06-01-aios-codex-grade-thread-system.md` (tasks 2 & 4) |

---

## 12. New files this plan introduces

- `src-tauri/src/chat_history.rs` — append-only store writer/reader; commands `read_chat_history`,
  `search_chat_history`, `set_starred`, `delete_chats` (→ trash), `restore_chats`, `purge_trash`,
  `export_chat`; `index.json` / `meta.json` upkeep.
- `src/lib/chatTimeline.ts` (+ test) — `buildTimeline`, `tickPositions`, `nearestTurnAtTime` (seq-based).
- `src/components/ChatScrubber.tsx` — the time/minimap rail + preview-on-hover.
- `src/components/HistoryPane.tsx` — the history + management browser; **register a sidebar entry +
  pane type** alongside the others (`src/App.tsx`, `src/lib/paneRouting.ts`, `paneBus.ts`).
- `src/components/ChangeCard.tsx` (or extend `toolDetail`/`DiffBlock` in place) — change preview;
  Monaco `DiffEditor` behind the "open full diff" action.
- `src/lib/historyManage.ts` (+ test) — pure helpers: timeframe→selection, keep-starred filter,
  group-by-date, trash-retention math.
- (reuse, don't recreate) `runEvents.ts`, pane bus, `gitDiff.ts`/`ChangesPanel.tsx` from thread-system task 4.
