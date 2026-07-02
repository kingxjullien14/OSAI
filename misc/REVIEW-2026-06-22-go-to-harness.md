# REVIEW + PLAN — making AIOS the go-to harness

> A walkthrough verdict + forward plan, written 2026-06-22 at the owner's request
> ("go through the app, find what needs fixing + what improves UX, write the
> verdict/plan in a .md to review later"). Grounded in a read of `App.tsx`,
> `ChatPane.tsx`, the shell wiring, the design system, every tracker in `misc/`,
> and a live health check. Not a tracker — a decision document. Pick what to build;
> a tracker spins up after.

---

## TL;DR — the verdict

**AIOS is already a complete, healthy, polished app.** It is not "almost there" in
the sense of missing panes or being broken — every capability in the README ships,
the codebase is clean (zero `TODO/FIXME/HACK` markers), it **typechecks at 0 errors
and passes 161/161 tests** as of today, and Waves 1–5 + Build‑02 + the ChatPane‑History
epic + the Projects→Workspaces epic are all done.

So the feeling that "it needs something more" is **not a features gap.** It's three
things, in priority order:

1. **Trust debt.** A large amount of recent work is marked `[~] CODE COMPLETE — awaiting
   live run‑verify` and never confirmed in the GUI. Built-but-unverified features are
   *exactly* what reads as "not quite finished," even when nothing is broken.
2. **No work‑session spine.** The app organizes **tools** (panes, saved layouts) and
   **projects** (the workspace tree), but not **work**. There's no first‑class "what I'm
   working on right now" that binds a goal + the agent thread + the open panes + the
   project into one named, resumable unit. The home even asks *"what should we **work**
   on?"* — but nothing remembers the answer.
3. **The agent can't drive the shell.** The Conductor builds a layout from your *voice*,
   but the chat **agent** itself still can't open a browser, run a terminal command, or
   open a file. The "co‑founder's command deck" promise is half‑kept. `PLAN-control-plane.md`
   already specs this; it's unbuilt.

Fix #1 and the app *feels* finished. Build #2 and it *becomes* a daily driver you
return to. Build #3 and it becomes the thing nothing else is.

---

## 0. Baseline — what's actually here (so we don't re‑litigate it)

| Area | State |
|---|---|
| Panes | Chat (8.2k LOC), Terminal, Oracle roster, Browser, Files, Editor+LSP, Viewer, Notes, Pulse, Bridges, Plugins, App‑mirror, Scheduled Agents, Pet, History — **all shipped** |
| Shell | Resizable pane grid, Mission‑Control overview, drag/swap/snap‑zone window manager, maximize/minimize, focus spotlight, command palette (`>` verb mode), file finder, global search, shortcut HUD |
| Design | "Neon Glass" system fully applied; tokenized; ratchet‑guarded; `motion`‑based fx with a strict reduce‑motion contract |
| Chat | Multi‑engine (claude/codex/opencode), model+effort+permission pickers, thinking blocks, tool‑activity cards, change cards + diffs, find‑in‑chat, minimap scrubber, durable JSONL history + resume, cross‑history search, per‑turn token sparkline, persistent goal box, image vision, slash/@ menus, cwd picker, push‑to‑talk |
| Platform | Native macOS + Windows, self‑updating (signed), graceful degradation everywhere |
| Health (today) | `tsc --noEmit` → **0 errors**; `test:chatpane` → **161/161 pass**; no code‑level TODO/FIXME debt |

This is a *lot*. The plan below assumes none of it needs rebuilding.

---

## 1. Diagnosis — why it "feels like it needs something more"

### A. Trust debt (the biggest "feel" gap, the cheapest to close)

The team's own discipline pushed debt out of the code and into the trackers as
**unverified built work**. Counting just the open `[~]` items:

- **ChatPane‑History epic** — `P1d` resume replay, `P2c` compaction card, `P3a/P3b`
  windowing, `P4a/P4b/P4d` change cards + diffs + roll‑up, `P5a–P5e` the entire
  History pane UI, `P6b` the scrubber, plus the four user‑reported render fixes
  (thinking settle, markdown tables, AskUserQuestion answerable) — **all `[~]`,
  "awaiting live run‑verify."**
- **Build‑02** — the framed‑turn / mission‑control / terminal‑HUD work is mostly `[x]`,
  but its visual fidelity passes were never run‑verified in light theme or at 60fps
  with a native pane open (called out explicitly in the Wave‑5 audit).

None of this is *known broken* — but "I built it, I think it works" is not the same as
"I've watched it work," and the difference is felt. **A built feature that's subtly wrong
is worse than a missing one**, because it erodes trust in the whole surface.

### B. No work‑session spine (the conceptual "something more")

Today the organizing units are:

- **Saved layouts** (`lib/workspaces.ts`) — a named set of open panes + grid fractions.
  No goal, no chat binding. `saveCurrentWorkspace` (`App.tsx:1988`) persists *panes + tracks*, nothing else.
- **Project workspaces** (`lib/projectWorkspaces.ts`) — the repo *structure* (front/back,
  Beta/Staging, components). Static; about the code, not your activity.
- **Chat goal box** (`ChatPane.tsx:7270`) — a persistent goal, but **per chat**.
- **History** — a flat list of past chats.

These are *adjacent to* a work‑session but never compose into one. There is no object
that says: *"**Ship the WRMS Beta login fix** — this is the chat thread, these are the
panes (api terminal + admin‑web browser + the two files), this is the component, pick it
all back up in one click."* That object is the spine a "go‑to harness" is built around.
It's the difference between an app that **hosts your tools** and one that **tracks your work**.

### C. The agent can't drive the shell (the command‑deck gap)

`PLAN-control-plane.md` opens with the owner's own words: *"it's very important that AIOS
has every control of the shell app just as I do, so I can technically tell it to do
everything I do in shell."* The plan even enumerates every action (`spawn`, `openFile`,
`openUrl`, `resumeChat`, layout ops…) — all reachable via the existing `lib/paneBus.ts`.
But the agent in the chat pane can only *talk*; it can't *act* on the deck around it. The
Conductor proves the wiring works from voice → pane bus; the missing piece is exposing
that same bus to the model as tools.

---

## 2. The plan — five tiers, prioritized by "complete‑feeling per unit effort"

> Each tier is independent and shippable on its own. Standard gates per batch
> (`tsc 0` · `test:chatpane` · `build ✓` · `cargo check` if Rust). No multi‑agent
> fan‑out (quota). Neon‑Glass tokens only in new UI.

### ⭐ Tier 0 — The Trust Pass *(do this first; days, not weeks)*

The single highest‑leverage work. Turn every `[~]` into `[x]` or a filed bug.

1. **One build, one checklist.** `npx tauri dev`, then walk the `[~]` backlog with a
   scripted scenario per item:
   - Resume a real chat → confirm the full transcript replays (thinking + answer +
     footer), not just text (`P1d`); lands at the **bottom**; hover times present.
   - `/compact` a chat → the compaction card shows live *and* on resume (`P2c`).
   - Open a long chat → 60fps scroll, sticky day header, minimap scrub + hover bubble (`P3a`,`P6b`).
   - Trigger an Edit/Write → the change card shows the diff inline, doesn't flash‑collapse,
     no duplicate "open" card, no "N steps · N steps" dup (`P4a/b`); roll‑up bar at top (`P4d`).
   - History pane: browse → star → multi‑select → clean‑up‑by‑timeframe → trash → restore →
     resume → cross‑history search → deep‑link to the matched message (`P5*`,`P7b`).
   - Markdown tables/rules/blockquotes render; AskUserQuestion is answerable mid‑stream.
2. **Light‑theme + native‑coexistence pass** (the Wave‑5 open loop): every surface in light
   theme; a busy chat (BorderBeam lapping) next to an open browser pane; check nothing
   composites wrong or drops frames.
3. **File the misses, fix the cheap ones inline, mark the trackers honestly.**

**Outcome:** the app stops *feeling* provisional. This alone may be 70% of "it needs
something more."

---

### ⭐ Tier 1 — Work Sessions *(the headline "something more")*

Introduce a first‑class **Session**: the unit of work the home is built around.

```ts
interface WorkSession {
  id: string;
  title: string;            // "WRMS Beta login fix" — editable, or auto from the goal/first prompt
  goal?: string;            // the standing intent (seeds the chat goal box)
  workspaceRoot?: string;   // ↔ projectWorkspaces.ts (+ optional component/env target)
  chatSessionIds: string[]; // the durable chat thread(s) — reuses the history store
  layout?: SavedLayout;     // ↔ workspaces.ts snapshot (panes + grid tracks)
  createdAt: number; lastActiveAt: number;
  status: "active" | "paused" | "done";
}
```

It doesn't replace anything — it **composes what already exists**:
`projectWorkspaces` (the where) + `workspaces.ts` layout (the panes) + the chat history
store (the thread) + the chat goal box (the intent).

**The UX shift — the home becomes "resume your work," not "launch a tool":**
- The idle home's two‑column section gains a **"Continue working"** rail: recent sessions,
  each showing title · project chip · engine dot · "3 panes · 2h ago." **One click restores
  the layout, reattaches the chat thread, sets the cwd, and re‑seeds the goal.** This is the
  payoff — pick up exactly where you were, mid‑thought.
- "what should we work on?" + a fresh prompt → **starts a new session** (today it just spawns
  a loose chat that nothing remembers as a unit).
- A session is the natural home for the cumulative cost HUD (Tier 3) and the agent's scope
  (Tier 2).

**Scope choice (your call — see §4):**
- **Lite** (~1 session of work): a thin `lib/workSessions.ts` that *links* an existing chat
  id + the current layout + a project + a title, surfaced as the "Continue working" rail.
  Reuses every existing store. Low risk, most of the felt value.
- **Full**: status lifecycle, multi‑chat sessions, a session switcher in the sidebar,
  per‑session notes. Bigger, do it after Lite proves the concept.

---

### Tier 2 — Agent control plane *(the command deck)*

Make `PLAN-control-plane.md` real, smallest slice first.

1. **Expose the pane bus to the model as tools.** A curated, safe subset first:
   `open_pane(kind, ctx)`, `open_url`, `open_file`, `run_in_terminal(cmd)`,
   `read_app_state()` (open panes + active). All already exist as functions behind
   `lib/paneBus.ts` — this is a thin tool wrapper, *not* new logic (one source of truth,
   per the plan's own rule).
2. **Surface it** as a local MCP server (the plan's preferred route) or an in‑process tool
   bridge for the chat engine. Gate behind a setting + per‑action confirm at first (reuse the
   existing permission‑mode + approval‑card machinery) so "the agent opened a browser" is
   never a surprise.
3. **Tie to sessions (Tier 1):** the agent acts *within the current session's* scope — opens
   panes into your session, runs in the session's cwd.

This is what turns "a chat that can edit files" into "an agent that drives my workspace."

---

### Tier 3 — Chat power features *(the daily‑use papercuts)*

These are listed "on deck" in the README and hit on every heavy day:

1. **True edit‑and‑resend.** Today `editMessage` (`ChatPane.tsx:2752`) just refills the
   composer — it doesn't rewind. Real version: edit a prior user turn → **fork/truncate the
   thread at that point** and resend, so the transcript reflects the new branch (the durable
   JSONL store + replay machinery makes this tractable).
2. **Retry‑with‑different‑model** without losing the thread — re‑run the last turn on another
   model/engine, keep the conversation.
3. **Cumulative cost/usage HUD.** The per‑turn token *sparkline* exists; add a **running
   session total** (cost + tokens) in the footer/header — the natural per‑**session** readout
   once Tier 1 lands. Power users want to see the meter.

> **Shipped 2026-06-23 (from the live trust pass), out of tier order:** the AskUserQuestion
> answer path + `/compact` rendering were fixed, and a **display-level response-branching
> ‹N/M› switcher** landed (regenerate → switchable variants; `src/lib/chatBranching.ts`).
> **True context-forking** — pruning the discarded branch from the *model's* context — is
> **deferred to the BYO-key API epic (Tier 4)**: the claude CLI owns its conversation
> context with no fork/rewind API, so forking is only clean once AIOS owns the message array.

---

### Tier 4 — Reach & remaining papercuts *(opportunistic)*

- **Model‑agnostic / BYO‑key** (`PLAN-model-agnostic.md`): live model catalog, OpenRouter key
  onboarding, BYO native API keys with secure storage. Broadens the app past CLI‑subscription
  reach — real for anyone without a claude/codex sub. Also the clean home for **true response-forking**: once AIOS owns the message array, pruning a discarded regenerate branch from the model's context is trivial (deferred here from Tier 3).
  - **Proper conversation branching + true edit-and-resend** (owner decision 2026-06-24, from
    Tier 3 P2): a real conversation tree — edit/regenerate forks a branch at that point, swap
    branches, continue each independently. Needs AIOS to own + replay the active branch's path to
    the model every turn (the CLI's single linear context can't fork honestly). The CLI-era ‹N/M›
    switcher (re-rolls of the last prompt) is the honest subset until then. See `PLAN-chat-power.md`.
- **App‑cast input forwarding** — display ships; click/scroll/keystroke through to the mirrored
  window is the documented phase B.
- **Codex MCP‑skip startup stall (~20s)** (`BACKLOG.md`) — a real per‑turn perf papercut; find
  the flag codex 0.135 actually honors, or strip MCP servers from the config handed to it.
- **Per‑pane top‑right controls** (`BACKLOG.md`, firaz "YUP") — maximize/min/options menu on the
  pane header, not just close.
- **Honest stubs to finish or hide:** Bridges "coming soon" on Windows; any "not installed"
  palette rows that don't explain *why*.

---

## 3. Recommended sequence + the first concrete step

1. **Tier 0 (Trust Pass) — start now.** It's the fastest route to "feels complete," needs no
   new design, and de‑risks everything built on top. Output: a clean tracker + a short list of
   real bugs.
2. **Tier 1 Lite (Work Sessions).** The headline win; ~1 focused session; reuses existing stores.
3. Then pick by appetite: **Tier 2** (most ambitious / most differentiating) or **Tier 3**
   (quickest daily wins).

**First step I'd take:** spin up `tauri dev` and run the Tier‑0 checklist against the
ChatPane‑History `[~]` items — that's where the most built‑but‑unconfirmed surface lives, and
it's the core experience.

---

## 4. Decisions for you (the owner)

1. **Priority:** Trust Pass first (my rec), or jump straight to the Work‑Sessions build?
2. **Work Sessions scope:** Lite (link existing chat+layout+project) or Full (lifecycle +
   switcher + multi‑chat)?
3. **Control plane:** real MCP server, or an in‑process tool bridge to start? And how
   aggressive on auto‑confirm vs. always‑ask?
4. **Anything here you've already decided against** so I don't re‑propose it (the way meteors /
   globe / splash‑cursor are documented as rejected in the Wave‑5 audit)?

---

*Health snapshot at write time: `tsc` 0 · `test:chatpane` 161/161 · working tree has the
in‑progress ChatPane‑History + Workspaces + Neon‑Glass edits uncommitted.*
