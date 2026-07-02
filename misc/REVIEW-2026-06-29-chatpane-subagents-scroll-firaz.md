# ChatPane review — sub-agent rendering, scroll lag, and the Firaz gap

> Written 2026-06-29 for review BEFORE any code changes. Three asks, in order:
> (1) the sub-agent "mess", (2) the scrollbar/scroller lag, (3) what Firaz's
> `feat/cross-machine-sync` branch has that we don't and what we have above him.

## ✅ STATUS — IMPLEMENTED 2026-06-29

All of §1, §2, and the FleetView from §3 are now shipped (tsc 0 · 221 tests pass ·
production build OK). New chat UI was split into its own modules (per the request
to keep ChatPane refactor-ready), wired in with minimal coupling.

**New files**
- `src/lib/subagentFleet.ts` (+ `subagentFleet.test.ts`) — pure logic: `partitionTools`
  (parent→children grouping), `deriveFleet` (per-agent summaries), `isAgentTurn`,
  `previewTool`. Registered in the `test:chatpane` script.
- `src/components/chat/FleetView.tsx` — live fleet strip (one card per sub-agent).
- `src/components/chat/AgentStep.tsx` — nested Agent row; children injected via a
  `renderChild` render-prop so it stays decoupled + recurses to any depth.

**Edited**
- `src/lib/chat.ts` — typed `parent_tool_use_id` on `ChatEvent`.
- `src/lib/chatStream.ts` — `parentId` on the `tool` turn + reducer reads
  `parent_tool_use_id` (conditional, so main-agent turns stay shape-identical).
- `src/lib/runEvents.ts` — same `parentId` on `action.started`.
- `src/components/ChatPane.tsx` — block builder no longer hoists a sub-agent's
  edits/asks; `ActivityGroup` partitions + renders `AgentStep`/`FleetView`;
  rail thumb is now imperative (`hasRail` boolean + `railThumbRef` +
  `positionRailThumb`, transition removed).

**Post-test fix (the important one):** live testing showed sub-agents still rendering
flat. Root cause: the sub-agent tool is named **`Agent`** in current Claude Code
(it was `Task`), confirmed from the raw stream (`~/.aios/state/chat-history/<id>/
events.jsonl` → `"name":"Agent"` ×2, with `parent_tool_use_id` present). My
`isAgentTurn` only matched `"task"`, so every sub-agent fell back to the flat
`ActivityStep`/`previewArgs` path ("Agent description:…", no fleet). Broadened
`isAgentTurn` to match `agent`/`task`/`subagent`/`sub-agent` + added a regression
test. (Firaz's regex already matched `agent` — that's why his worked.) Also worth
knowing: WebView2 caches compiled JS aggressively; a hook-shape change needs a full
reload, and clearing `…\com.julnazz.aios\EBWebView\Default\{Cache,Code Cache}`
forces it without wiping Local Storage.

**Scroll thumb — ACTUAL root cause + final fix:** the rail-sync (`syncJumpVisibility`,
which sets `railWin`) ran from a `useEffect` that did `el.addEventListener("scroll", …)`
capturing `scrollRef.current` ONCE at mount. That listener never reached the live
scroll element, so wheel-scrolls never updated `railWin` — the thumb only moved when
some OTHER re-render refreshed it (drag worked because it calls `syncJumpVisibility`
directly; hover worked only while a stale `railWin` happened to be current). Two red
herrings cost time first: the CSS `transition-[top,height]` (a real but minor lag)
and an imperative-ref rewrite (made it worse). **Fix:** moved ALL scroll handling
(`handleScroll` + `handleWheel`) onto the scroll element's React `onScroll`/`onWheel`
props — React binds these to the LIVE node every render — and deleted the stale
addEventListener effect. Thumb is state-driven (`railWin`), no position transition.
This also restores autoscroll-pause, which rode the same stale listener.

The original plan/diagnosis is kept below for the record.

---

---

## TL;DR / recommended order of work

1. **Scroll fix, Part 1 (5 min)** — delete one CSS transition. Kills ~80% of the
   perceived scrollbar lag immediately. Lowest risk, biggest felt win.
2. **Sub-agent nesting (half a day)** — thread `parent_tool_use_id` through, then
   nest each sub-agent's tool calls under its "Agent" row instead of dumping them
   flat. This is the actual fix for the screenshot mess.
3. **Scroll fix, Part 2 (~1h)** — drive the rail thumb imperatively via a ref +
   rAF so it never waits on a React re-render. Makes it buttery even mid-stream.
4. **Optional (later)** — borrow Firaz's live "fleet" strip as a complement to the
   inline nesting; lift his `isAgentTool` / `parent_tool_use_id` helpers verbatim.

Everything below is frontend-only. **No Rust change is needed** — `chat.rs` already
streams the raw JSON lines untouched (`src-tauri/src/chat.rs:30`, and
`ch.send(line.to_string())` at `:1234`), so `parent_tool_use_id` already reaches
the frontend intact. The screenshot itself proves the child tool calls arrive —
those `Read`/`Globbed` rows ARE the sub-agents' own calls; we just render them flat.

---

## 1. Sub-agent rendering — the "mess"

### What's happening in the screenshot
Two `Agent` rows (Task tool, still spinning) are followed by a flat, interleaved
dump of `Read splash_page.dart`, `Globbed …collections…`, etc. Those Reads/Globs
are the **child tool calls made by the two sub-agents**, but they render as flat
siblings *below* the Agent rows — so you can't tell which file-read belongs to
which agent, and the Agent rows look empty while a wall of unattributed activity
piles up underneath. With parallel agents the children interleave, making it worse.

### Root cause (verified, 3 layers)
The Claude Code stream tags every sub-agent event with a top-level
`parent_tool_use_id` linking it back to the parent Task's `tool_use` id. We drop
it at every layer:

1. **Type** — `ChatEvent` (`src/lib/chat.ts:145`) only carries
   `parent_tool_use_id` via its catch-all `[key: string]: unknown` (`:211`); it's
   never read.
2. **Reducer** — `reduceAssistantEvent` (`src/lib/chatStream.ts:195`) builds a
   `tool` turn from each `tool_use` block but **never reads
   `ev.parent_tool_use_id`**. The `tool` variant of `ChatTurn`
   (`src/lib/chatStream.ts:24-31`) has **no `parentId` field**.
   - Same blind spot in `src/lib/runEvents.ts:261-271` (the durable event log),
     for whenever that path is used.
3. **Block builder** — `blocks` (`src/components/ChatPane.tsx:4707`) collapses
   *all* consecutive tool turns into ONE flat `activity` block
   (`tools: ToolTurn[]`, type at `:221`). Parent Task rows and every child from
   every parallel agent land in the same flat list. `ActivityGroup` /
   `ActivityStep` (`:5956` / `:6064`) then render that list with no hierarchy.

`toolVerb("task") -> "Agent"` (`:732`) and the task->description label (`:653`)
already exist, so the Agent row renders fine — it just doesn't *contain* its work.

### The fix (frontend only)

**Layer A — carry `parentId` through ingestion** (`src/lib/chatStream.ts`)
- Add `parentId?: string` to the `tool` variant of `ChatTurn` (`:24-31`).
- In `reduceAssistantEvent`, read `const parentId = ev.parent_tool_use_id` and set
  it on each tool turn created in that event.
- Add a typed `parent_tool_use_id?: string` to `ChatEvent` for clarity (`:145`).
- `replayHistoryToTurns` (`:365`) routes through the same reducer, so **resumed /
  history chats nest for free**. Same one-line add in `runEvents.ts` if we keep it.

**Layer B — build a hierarchy in the block builder** (`src/components/ChatPane.tsx:4707`)
- Instead of `activity.tools: ToolTurn[]`, build a small tree: top-level tools in
  order, and each Task turn gets `children: ToolTurn[]` = the tools whose
  `parentId === task.id`.
- Route children by `parentId` regardless of interleaving (parallel agents
  interleave in the stream — keying by id handles it). A child whose `parentId`
  matches no Task in the group falls back to top-level (defensive).
- Decision to make: a sub-agent's **file edits / AskUserQuestion** currently get
  hoisted to their own cards (`:4733`, `:4736`). Recommend **nesting them under
  the agent** so the transcript stays clean — a sub-agent's edits are part of its
  work, not top-level conversation. (Flag if you'd rather keep edits hoisted.)

**Layer C — render nested** (`ActivityGroup` `:5956`, `ActivityStep` `:6064`)
- Task step becomes a parent row: `Agent · <description>` + a sub-agent-type chip
  (general-purpose / Explore / …), a spinner while running, and a collapsed rollup
  ("12 steps · 3 files").
- Expanded, render `children` as an indented nested list (reuse `ActivityStep`;
  the left-border indent convention already exists at `:6042` / `:6135`).
- Auto-expand the running agent's children, auto-collapse on done — same toggle
  pattern the group already uses (`:5978-5979`).
- The Agent row's own `result` (the sub-agent's final summary) renders as the
  expandable result at the bottom of its child list.
- Handle N-deep recursion gracefully even though Claude Code currently caps Task
  depth at 1 — so a future nested spawn doesn't break the layout.

**Tests:** extend `src/lib/chatStream.test.ts` (parentId threading from
`parent_tool_use_id`) and add a block-builder case (parent + interleaved children
-> one parent with the right children).

**Effort:** A ~30 min · B ~1-2h · C ~1-2h. Half a day with tests.

**Optional enhancement (borrow from Firaz):** a compact live "fleet strip" (one
chip per running sub-agent: label + spinner + last line + token count) above the
composer or atop the activity group. Complementary to nesting — nesting is the
*record*, the strip is the *live glance*. Do nesting first (it fixes the
complaint); strip is a follow-up. See §3.

---

## 2. Scrollbar / scroller lag

### What you're seeing
The purple bar on the right is a **custom rail thumb**, not the native scrollbar —
the native one is hidden (`src/components/ChatPane.tsx:5317`:
`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`). So the rail is the only
scroll indicator, and it visibly trails your real position ("takes time then
follows"), worst while a reply is streaming.

### Root cause (verified) — two compounding issues

1. **A CSS transition on a scroll-driven position** — the thumb has
   `transition-[top,height] duration-100` (`src/components/ChatPane.tsx:5713`).
   Its `top` is set from `railWin` state on every scroll, then CSS *eases* it to
   the new spot over 100ms. During a continuous scroll the target keeps moving, so
   the thumb is permanently ~100ms behind. **This is the main "feels out of place."**

2. **A full React re-render per scroll event** — `onScroll`
   (`:2283`) calls `syncJumpVisibility` -> `setRailWin(...)` (`:2229`) on *every*
   scroll event, re-rendering the entire (very large) ChatPane each time. The
   render can't keep up with the native scroll framerate — and mid-stream it
   competes with token re-renders — so the thumb updates in chunks and lags. This
   is the "sometimes it takes a while" part.

### The fix (two parts)

**Part 1 — remove the position transition (1 line, ~5 min, big win)**
- Drop `transition-[top,height] duration-100` from the thumb (`:5713`); keep the
  color hover transition. The thumb then tracks `scrollTop` 1:1.
- Programmatic jumps already animate the *container* via
  `scrollTo({ behavior: "smooth" })` (`jumpToLatest` `:2334`; `scrollToBlock`;
  `railScrubTo`), and the thumb should simply follow `scrollTop` — no separate
  ease needed. (If you want a glide only on click-jump, gate the transition behind
  a transient class set during programmatic scroll, never during live scroll.)

**Part 2 — drive the thumb imperatively + rAF (~1h, removes the per-frame render)**
- Give the thumb a `thumbRef`. In `onScroll`, instead of `setRailWin` every event,
  schedule ONE coalesced `requestAnimationFrame` that reads
  `el.scrollTop/scrollHeight/clientHeight` and writes
  `thumbRef.current.style.top/height` directly. Bypasses React render -> the thumb
  tracks at native framerate.
- Keep React state only for booleans that change rarely: does the rail exist at
  all (`railWin` null vs not) and jump-pill visibility (`showJump`). Update those
  at most once per rAF, ideally only when the boolean flips.
- Net: zero React renders during a pure scroll; the thumb is glued to the pointer.

**Effort:** Part 1 ~5 min · Part 2 ~1h. Part 1 alone is most of the felt fix;
Part 2 makes it perfect under streaming load. Adjust a `chatScroll` test if the
rAF logic gets extracted into `src/lib/chatScroll.ts`.

---

## 3. Firaz `feat/cross-machine-sync` vs ours

Compared his branch against our working tree (file-level dir listings on both
sides, plus reading his `subagentFleet.ts` and the relevant ChatPane bits).

### 3a. Chat pane — what Firaz has that we DON'T
- **Sub-agent fleet** (`src/lib/subagentFleet.ts` + `chat/FleetView`). The thing
  our transcript mess is crying out for. His `reduceFleet(state, ev)`:
  - detects spawns via `isAgentTool(name,input)` — regex matching
    `task|subagent|sub-agent|multi-agent|parallel-agent|spawn-agent` and a bare
    `agent` (excluding `user-agent`/`browser-agent`), plus a `workflow` branch;
  - links children via top-level `parent_tool_use_id` (confirms the field is live);
  - tracks per agent `{ id, label, subagentType, status: running|done|failed,
    lastLine (trailing 120 chars of its streamed text), tokens (summed from
    usage), startedAt, endedAt }`, and **Workflow phases** separately;
  - completes an agent on its matching `tool_result` (`is_error` -> failed).
  - Renders as a **separate fleet panel** (`<FleetView>`), not inline.
- **Split `Composer.tsx`** — his composer is its own component + a `chat/`
  submodule folder (`chat/toolPresentation`, `chat/FleetView`). Ours is one
  ~364 KB / ~8,500-line `ChatPane.tsx`. Maintainability, not a user feature.

### 3b. Chat pane — what we have ABOVE Firaz
- **Durable history + branching/edit-rewind** — `chatHistory.ts`, `chatTree.ts`,
  `chatTreePersist.ts`, `chatTimeline.ts`, `chatBranching.ts`, `historyManage.ts`,
  `HistoryPane.tsx`. Conversation tree, sibling `‹N/M›` switcher, durable local
  store, management UI. Firaz has **none** of these.
- **BYO-key model-agnostic API chat (Tier 4)** — `apiKeys.ts`, `apiMessages.ts`,
  `providers.ts` + OS keychain. Native multi-provider API path; Firaz is
  CLI-engines only.
- **RunCinema** (replay a run segment), **work sessions** (`workSessions.ts`),
  **control plane** (`control.ts` + the `aios-control` MCP), **Workspaces**
  (`workspaces.ts`, `projectWorkspaces.ts`, `ProjectsPane`,
  `WorkspaceLaunchPicker`), the **Neon Glass** restyle, and **sessionUsage** with
  the OAuth-429 backoff fix.

### 3c. Sub-agent approach — his model vs the fix proposed here
- **Firaz:** separate fleet *panel* (roster of agent cards). Great live "who's
  running / how many tokens" glance; child tool calls appear to stay flat in the
  transcript (no `parent_tool_use_id` filtering shown on the transcript side).
- **Proposed here (§1):** inline *nesting* in the transcript (children grouped
  under their Agent row). Fixes the actual mess and gives a per-agent record.
- **Best:** do the inline nesting, then optionally add a Firaz-style live strip.
  They're complementary, and we can lift his `isAgentTool`, the
  `parent_tool_use_id` reader, and `tokensFromUsage` almost verbatim.

### 3d. Broader repo delta (by filename — directional, see caveats)
- **Firaz-only panes/libs** (mostly the cross-machine / collaboration theme):
  `AnalyticsPane`+`analytics`, `GitPane`, `LiveRoomPane`+`liveRoom`+`MissionBoard`,
  `MemoryPane`, `LoopPane`, `TicketPane`, `CdpChromePane`+`cdp`,
  `WrmsDevicePane`+`device`+`wrmsQa`, `BoxCockpit`, `pm2`, `ticker`, `safeStorage`,
  `fileIcons`/`fileKinds`, `AgentsSection`, and of course `subagentFleet`.
- **Ours-only:** `PetPane`, `ShortcutHud`, `Onboarding`, `ScheduledAgents*` (our
  rename+evolution of his `MoneyAgents*`), `ProjectsPane`/Workspaces, `PaneMenu`,
  `RunCinema`, `conductor`, `updater`, `sound`, `shortcuts`, `paletteMorph`,
  `textDiff`, `sessionLabel`, `providerDetect`, plus the whole chat-history /
  branching / API-chat stack in §3b.
- **Renamed, not missing:** his `MoneyAgents*` -> our `ScheduledAgents*`; his
  `AgentsSection` -> our `OracleRoster` + `ScheduledAgentsSection`.

### 3e. Confidence notes
- File-existence deltas (3a top line, 3d): **high** — listed both repos' dirs.
- `subagentFleet.ts` model (3a, 3c): **high** — read the actual source.
- Same-named panes may differ in depth (I didn't deep-read every Firaz pane); the
  3d delta is by filename only.
- Any wider "his ChatPane feature list" beyond the above (voice, watchdogs, goal
  pills, etc.) is **medium** confidence — summarized by a reader model, and several
  of those we already have too (e.g. `VoiceButton` exists on both sides). Verify
  before treating any as a real gap.

---

## Files this touches (when we implement)
- `src/lib/chatStream.ts` — `parentId` on tool turns; read `parent_tool_use_id`.
- `src/lib/chat.ts` — type `parent_tool_use_id` on `ChatEvent`.
- `src/lib/runEvents.ts` — same `parentId` add (durable log path).
- `src/components/ChatPane.tsx` — block-builder tree (`:4707`), `ActivityGroup` /
  `ActivityStep` nested render (`:5956` / `:6064`), and the rail thumb
  (`:5713`) + scroll handler (`:2283`/`:2229`).
- Tests: `src/lib/chatStream.test.ts` (+ a block-builder test); `chatScroll` if
  the rAF logic is extracted.
