# PLAN — Chat Power (Tier 3 of the go-to-harness review)

> The daily-use papercuts in the chat itself. Source: `misc/REVIEW-2026-06-22-go-to-harness.md`
> §"Tier 3 — Chat power features". Three features; P0 shipped 2026-06-24.

## Scope decisions (locked)

- **No dollars.** The review framed the HUD as "cost + tokens". The owner runs on
  subscriptions where $ is noise (he chose *messages over dollars* for the session HUD,
  and `total_cost_usd` is already intentionally dropped from the result footer —
  `ChatPane.tsx` "cost intentionally omitted"). So the meter is **messages · tokens · age**.
- **Display-level rewind, not model-fork.** Edit-resend (P2) truncates AIOS's transcript +
  durable JSONL view and resends; **pruning the discarded branch from the model's own
  context stays deferred to the BYO-key API epic (Tier 4)** — the claude/codex CLI owns its
  conversation context with no fork/rewind API, so a clean fork is only possible once AIOS
  owns the message array. (Same reasoning that deferred true response-forking.)

## P0 — Cumulative session usage HUD ✅ SHIPPED 2026-06-24

A per-session readout beside the existing per-turn sparkline + live "ctx" indicator
(they share one row above the composer). Pure aggregation, so the math is tested
independent of the live chat.

- `src/lib/sessionUsage.ts` (+ `sessionUsage.test.ts`, 4 tests): `sessionUsage(turns)` →
  `{ messages, responses, tokens, lastTokens, startedAt }` (messages = user turns; tokens =
  Σ per-turn `result.tokens`; startedAt = earliest `createdAt`, which `replayHistoryToTurns`
  fills from the JSONL ts so **age is honest on resumed sessions**). Plus `formatTokens`
  (980 → "980", 12.3K, 125K, 4.5M) + `formatAge` ("just now" / "5m" / "1h 20m" / "2d 4h").
- ChatPane: a `usage` memo + a center span in the readout row — `12 msgs · 248K · 8m`
  (tooltip spells it out). Row now shows whenever `messages > 0` (not just when ctx/sparkline
  exist). Age reads `Date.now()` at render — advances as you interact; no idle timer (v1).
- Gates: tsc 0 / 197 tests / build ✓.

## P1 — Retry-with-different-model ✅ SHIPPED 2026-06-24

Re-run the last turn on another model/engine, keep the thread.

- **Open question — RESOLVED:** there is **no per-send model**. The session-start effect
  keys on `model.id` (`ChatPane.tsx` ~2103), so the engine/model is fixed when the session
  spawns; changing it restarts the session. Also found: `resumeId` is **not** synced to the
  live session today, so a plain model switch loses backend context (the transcript stays,
  implying a continuity the backend doesn't have).
- **Implementation:** `retryWithModel(m, text)` — same model → plain `regenerate`; different
  model → capture the live `claudeSessionIdRef`, `setResumeId(it)` so the restart **resumes**
  the conversation under the new model, `setModel(m)` (both setState batch → one restart),
  and stash the text in `pendingRetryRef`. A `[started, claudeReady, streaming]` effect fires
  `regenerate(text)` once the resumed session is live, so the new answer lands as a ‹N/M›
  variant. The restart preserves `turns` (it only resets started/claudeReady/ctx), so the
  transcript survives.
- **UX:** a `ChevronDown` "retry with ▾" menu beside the last user turn's regenerate button
  (opens upward; lists enabled `CHAT_MODELS`, marks "current"; outside-click/Esc closes).
- **CAVEAT (owner live-verify):** full context-fidelity across the swap rides on the CLI
  honoring `--resume` **together with** a new `--model`. If claude/codex pins the original
  model on resume, the retry would silently reuse it — the *display* always rewinds cleanly
  regardless. The retry path also doesn't change the global default model (a one-off).
- Gates: tsc 0 / build ✓ (wiring + UI; reuses the already-tested regenerate path).

## P2 — Edit-and-resend + proper branching → DEFERRED to BYO-key (Tier 4) [decision 2026-06-24]

The owner clarified what "branching" should mean: not the current re-roll switcher (alternate
answers to the **same last prompt**, appended below), but a **proper conversation tree** —
edit/regenerate **forks** a branch at that point, you **swap** branches, and continuing a
message lands on **that branch only** (each branch keeps its own continuation). ChatGPT/Claude.ai
style.

**Why it can't be done honestly in the CLI era:** the claude/codex CLI owns the conversation
context as a single linear thread. To continue branch B independently, the model must answer
with *branch B's* context — but AIOS can't fork the CLI's memory at a point or hold two
independent contexts. The only honest way is for **AIOS to own the message array and replay the
active branch's path to the model each turn** — which is exactly the model-agnostic / BYO-key
epic (Tier 4; `PLAN-model-agnostic.md`). A display-only branch/rewind (UI rewinds, model doesn't)
is the precise "screen says X, model does Y" mismatch the owner objected to, so we do **not** ship
that half-measure.

**Decision (owner, 2026-06-24):** build proper branching — AND true edit-and-resend rewind, which
needs the same context-ownership — **as part of the BYO-key epic.** Both become honest there:
AIOS holds the tree, replays the active branch to the API on each turn, edit forks a sibling
branch, swap is free.

**Shipped now (the honest interim):** the ‹N/M› switcher's tooltip was relabeled so it reads as
"alternate answer N of M to this message — regenerate re-rolls the same prompt (not a separate,
continuable branch)", so it's no longer mistaken for branching. `editMessage` stays as the honest
refill-composer-and-append (no false rewind).

**Tier 4 design notes (for when BYO-key lands):**
- Turn store gains parent pointers (a tree); the visible transcript = the active root→leaf path.
- Branch points: regenerate → a user turn gains multiple assistant-subtree children; edit → the
  parent gains multiple user-subtree children (original + edited).
- A ‹N/M› switcher at each branch point swaps the active child; continuing appends to the active
  leaf. On each send, AIOS replays the active path to the model (now possible — AIOS owns context).
- The pure helpers (segment tree, active-path, truncate-at-turn) get extracted + unit-tested,
  same discipline as `chatBranching`.

---

### Status
- **P0 HUD** — ✅ shipped + gated 2026-06-24.
- **P1 retry-with-model** — ✅ shipped + gated 2026-06-24 (CLI resume+model fidelity = owner live-verify).
- **P2 edit-resend + proper branching** — → **DEFERRED to BYO-key (Tier 4)** per owner decision
  2026-06-24 (needs AIOS to own/replay context to be honest). Interim: ‹N/M› switcher relabeled as
  re-rolls, not branches. **Tier 3's CLI-era papercuts (P0+P1) are done.**
