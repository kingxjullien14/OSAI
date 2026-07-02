# PLAN — Work Sessions (the "Continue working" spine)

Status: **COMPLETE — P0–P4c SHIPPED.** Save (title + **goal**) → the home's "Continue working"
rail (msgs · panes · age, with **done/remove**) → one click restores the deck, **re-threads every
bound chat** (multi-chat), and **re-seeds the goal**; also switchable from ⌘K. (Gated tsc 0 /
tests / build ✓ throughout.)
Tier 1 of `REVIEW-2026-06-22-go-to-harness.md`. Owner: Jul.Nazz. Started 2026-06-23.

---

## 0. Why

The app organizes **tools** (panes, saved layouts in `lib/workspaces.ts`) and **projects**
(the structured tree in `lib/projectWorkspaces.ts`), but not **work**. There's no object that
says *"**Ship the WRMS Beta login fix** — this is the chat thread, these are the panes, this is
the component, pick it all back up in one click."* The home even asks *"what should we **work**
on?"* but nothing remembers the answer. A **Work Session** is that missing unit — and the thing
that turns AIOS from "hosts my tools" into "tracks my work."

This is the **Lite** scope from the review: compose what already exists (chat history + saved
layouts + project workspaces + the chat goal box) into one named, resumable thing. No new
backend. **Display-/persistence-level** — the model's own context is untouched.

---

## 1. Data model (`src/lib/workSessions.ts`) — **DONE**

```ts
interface WorkSession {
  id: string;
  title: string;
  goal?: string;                 // seeds the chat goal box on resume
  projectRoot?: string;          // ↔ projectWorkspaces (the "where")
  chatSessionIds: string[];      // ↔ durable chat history (the thread(s))
  panes: WorkSessionPane[];      // ↔ saved-layout shape (the open tools)
  tracks?: number[] | null;      // grid fr-fractions
  createdAt; lastActiveAt; status: "active" | "paused" | "done";
}
```

Store: localStorage `aios.worksessions.v1`, guarded, pub/sub (`subscribe`). Pure helpers
(`makeWorkSession`, `upsertWorkSession`, `removeFromList`, `sortByRecency`, `touchInList`,
`patchInList`, `bindChatInList`) are unit-tested (9 tests) so the logic is verifiable even
though the UI can't be GUI-tested here. Store wrappers: `listWorkSessions` / `getWorkSession`
/ `createWorkSession` / `saveWorkSession` / `updateWorkSession` / `touchWorkSession` /
`setWorkSessionStatus` / `bindChatToWorkSession` / `removeWorkSession`.

`WorkSessionPane.kind` is the real `PaneContent` (type-only import → no runtime/bundle coupling),
and a chat pane keeps its `kind.resume = { id, … }` so restoring the session **resumes the same
thread**, not a fresh chat — the whole point over a plain saved layout.

---

## 2. Phases

- **P0 — spine.** ✅ **DONE.** `lib/workSessions.ts` + `workSessions.test.ts` (9). Not yet wired
  into any consumer — purely additive, so it's safe.
- **P1 — capture.** ✅ **DONE (v1).** Explicit `saveCurrentSession` (App), exposed via the palette
  **"save work session…"** — snapshots the non-chat panes (`persistableKind` + grid tracks) and
  binds the most-recent chat (`chats[0]`) by id. Auto-capture: launching a project **as a chat**
  from the launch picker upserts a session (dedup by workspace root; terminal launches don't, to
  keep the rail signal-not-noise). *(v1 binds one chat; goal-at-save + multi-chat → P4.)*
- **P2 — the "Continue working" rail.** ✅ **DONE (v1).** New `ContinueWorking` component replaces
  `MiniHistory` in the home's right column (title · project chip · goal · "N panes · age" via
  `sortByRecency`); **falls back to recent chats when no session exists** (no regression). Threaded
  App → IdleDashboard → IdleControlCenter.
- **P3 — one-click resume.** ✅ **DONE (v1).** `resumeWorkSession` (App): restores the tool panes
  via `applyWorkspace` (terminal reattach + browser last-url ride along) **and** re-threads the
  bound chat via `resumeChat` (or resume-by-id if it's aged out of the recent list); `touch` bumps
  recency. *(Re-seeding the goal into the live chat goal box → P4.)*
- **P4a — goal.** ✅ **DONE.** "save work session" opens a **title + goal modal**
  (`SaveSessionModal`); the goal is stored on the session, shown on the rail row, and
  **re-seeded into the chat's goal box on resume** (chat `goal?` field → ChatPane `initialGoal`
  prop → the goal state) so the agent carries the standing intent across the resume.
- **P4b — lifecycle + switcher.** ✅ **DONE.** Each "Continue working" row gets hover actions —
  **✓ mark done** (archives it from the rail; the rail falls back to recent chats when all are
  done) and **× remove** (deletes). A **palette session switcher** lists "session: ‹title›" resume
  entries (`appCommands`, done-filtered) → ⌘K drops you straight back into a session.
- **P4c — multi-chat + activity readout.** ✅ **DONE.** ChatPane reports its durable id once
  recorded (`onSessionRecorded` → App's `chatMetaByPaneKey` registry), so **"save work session"
  binds EVERY open chat** and resume **re-threads them all** (each seeded with the goal). The rail
  shows a **"N msgs" chip** per session (summed `message_count` from the durable meta) — the owner
  chose a sub-friendly message count over $ cost (which the codebase deliberately omits).
  *(Optional notes deferred — not requested.)*

**Epic status: COMPLETE (P0–P4c).** The unit of WORK is now first-class: save (name + goal) →
"Continue working" home rail (msgs · panes · age, with done/remove) → one-click resume restores
the deck, re-threads every bound chat, and re-seeds the goal; switchable from ⌘K too.

Each phase gated: `tsc 0` · `test:chatpane` · `build ✓`. No multi-agent fan-out (quota).
Neon-Glass tokens only in new UI.

---

## 3. Decisions — RESOLVED (2026-06-23, owner)

1. **Capture trigger → AUTO + EXPLICIT.** Auto-create a session as you work (a recorded chat /
   a project launch becomes a session), PLUS an explicit "save as work session" to name + set a
   goal + snapshot the whole deck. Zero-effort history you can still curate.
2. **Home placement → REPLACE the recent-chats column.** A session *is* a chat thread + panes,
   so "Continue working" takes over the right column (no duplication). To avoid an empty-rail
   regression before any session exists, the rail **falls back to recent chats** when the store
   is empty.
3. **Sidebar pane → not now.** The home rail + palette are enough for v1; a dedicated manage
   pane (like Projects) can come later if the list grows.

> **Implementation note (low-risk path):** ride the EXISTING `chats` (`listChatSessions`) +
> `resumeChat` + `applyWorkspace` infra — auto-capture diffs the `chats` list into sessions and
> resume re-threads via `resumeChat`, so **no ChatPane surgery** is needed (the 8k-line file
> stays untouched). Explicit save snapshots the deck via the `saveCurrentWorkspace` capture and
> binds the active chat id for re-threading on resume.

---

## 4. Files

- **New:** `src/lib/workSessions.ts` (done), `src/lib/workSessions.test.ts` (done).
- **Will touch (P1–P3):** `src/App.tsx` (capture action + resume wiring + thread the rail props),
  `src/components/IdleControlCenter.tsx` + `IdleDashboard.tsx` (the rail), `src/components/CommandPalette.tsx`
  (a `save session` / `resume session` verb), possibly `src/lib/paneBus.ts` (capture live chat ids).
