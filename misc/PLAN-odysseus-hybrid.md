# Odysseus × AIOS — study + hybrid plan (2026-07-03)

Owner request: studied PewDiePie's Odysseus (`C:\FHE-Work\odysseus`), figure out what to
bring in — or whether to start a combined project. End goal: "Odysseus-quality workspace
features, but as a native desktop app," with the existing AIOS pillars (projects/workspaces,
history, files, terminals) polished to the same level.

## Verdict (short)

**Do not merge codebases, and do not start a third project.** Keep AIOS as the body —
it already *is* the native desktop app Odysseus can't be — and adopt Odysseus's best
ideas as clean-room reimplementations. The two stacks share zero code surface
(Python/FastAPI + vanilla-JS web app vs Rust/Tauri + React/TS), and Odysseus is
**AGPL-3.0**: copying its code into AIOS would legally convert AIOS to AGPL (source-release
obligation on any distribution). Ideas, UX patterns, and API shapes are not copyrightable —
those we can take freely.

## What Odysseus actually is

- **Stack**: Python FastAPI monolith (`app.py` + ~80 route modules + ~90 `src/` service
  modules), vanilla-JS frontend (160 JS files, ~109k lines; `style.css` alone is 39.7k
  lines — their own roadmap calls it "Calypso's island"). Docker-first, self-hosted web
  app on port 7000. No framework, no build step.
- **Feature set**: chat + agents (local & API models, tools, MCP, skills, memory),
  **Cookbook** (hardware-aware local-model recommend/download/serve — llama.cpp/SGLang),
  Deep Research, **Compare** (blind multi-model A/B with voting/scoreboard), Documents
  editor, Email (IMAP/SMTP triage), Notes/Tasks/Calendar (CalDAV), gallery + full image
  editor (layers/masks/inpaint), themes, auth/2FA.
- **Agent integrations**: ships a **Claude Code skill bundle** (`integrations/claude/`) —
  any claude session with `ODYSSEUS_URL`/`ODYSSEUS_API_TOKEN` can drive an Odysseus
  instance through scoped `/api/codex/*` endpoints.
- **Maturity**: fast-moving, self-admittedly rough ("I don't know what I'm doing, help" —
  ROADMAP.md). Strong ideas, uneven engineering. The chat pane owner loves is a 5.2k-line
  `chat.js` + 2.7k-line `chatRenderer.js` — the *code* is not the prize; the *UX* is.

## Where AIOS is already ahead

Native shell (Tauri 2), multi-pane tiling, persistent Windows terminals (psmux), real
workspaces model, claude-CLI agent runtime with sub-agent FleetView / plan cards /
mid-turn steering, durable chat history epic, Neon Glass design system, OS-keychain BYOK
foundation. Odysseus has none of that.

## Where Odysseus is ahead (the import list)

| # | Odysseus thing | What we take (clean-room) | Effort |
|---|---|---|---|
| 1 | Local models as first-class (Ollama / llama.cpp / any OpenAI-compat endpoint) | Add **local/OpenAI-compatible endpoint** as a 5th provider in the Tier-4 BYOK epic (`providers.ts` + `chat_api.rs`). This is Odysseus's core superpower and slots directly into work already underway. | S–M |
| 2 | Chat-pane UX details | Per-model accent colors + model-route labels ("asked X, answered Y"), session cost meter, attachment cards + lightbox, sources/findings collapsible boxes, stream-done toast when tab unfocused, composer arrow-up recall. Cherry-pick into ChatPane restyle. | M |
| 3 | **Compare** mode | Side-by-side blind N-model runs with vote/synthesis. Natural once #1 lands (we'll have N providers). New pane, reuses chat runtime. | M |
| 4 | **Cookbook** (hardware-aware model mgmt) | Later flagship: detect GPU/RAM → recommend GGUF quant → download → serve via managed llama.cpp sidecar. Rust is a *better* home for this than their Python. | L |
| 5 | Deep Research | We get this via claude CLI already; a BYOK-native research loop is optional later. | L (defer) |
| 6 | Email / Notes+Calendar / Documents / image editor | **Do not rebuild.** If wanted, run Odysseus itself in Docker and integrate (see below). | — |

## The integration shortcut (get Odysseus features without rebuilding them)

Odysseus is a *server*. AIOS has a BrowserPane and a claude runtime. So:

- **Embed**: run Odysseus via `docker compose up -d`, point a BrowserPane preset at
  `http://localhost:7000`. Email, calendar, notes, docs, gallery — all usable inside AIOS
  today, zero code.
- **Agent bridge**: install their claude skill bundle (`~/.claude/skills/odysseus`) and set
  the two env vars — every AIOS claude session can then read/act on Odysseus email, notes,
  calendar, documents. AIOS becomes the cockpit; Odysseus becomes a service it drives.

This is AGPL-safe (network use, no code copying) and reversible.

## Phasing

- **P0 — licensing stance** ✅ decided by this doc: ideas only, never copy Odysseus code.
- **P1 — local models in BYOK** ✅ SHIPPED (2026-07-04): new `local` provider =
  any OpenAI-compatible server on a user-set base URL (Settings → api keys →
  "local endpoint"; default LM Studio's `http://localhost:1234/v1`). Models are
  100% live-discovered (`GET {endpoint}/models` in the launch sweep, 2s fail-fast,
  last-good cache); chats POST `{endpoint}/chat/completions` (SSE, usage chunk);
  keyless but honors an optional stored "local" key as a Bearer (LiteLLM/vLLM
  gateways). Ollama (native protocol) was already in. Save in Settings pushes the
  endpoint to Rust + re-sweeps so models appear immediately. Needs a live smoke
  test against LM Studio/llama.cpp.
- **P2 — the Odysseus FEEL** — expanded into its own epic after the owner ran Odysseus
  and fell for the windowed UX: see **`PLAN-odysseus-feel.md`** (windowed workspace
  revamp + context menus + chat stream anatomy + density). The chat cherry-picks
  originally listed here live there as W4.
- **P3 — polish sprint on the four pillars** (owner's explicit pain): projects/workspaces,
  history, files, terminals. Audit each against "daily-driver" bar; separate tracker.
- **P4 — Compare pane** ~~(needs P1)~~ — DROPPED 2026-07-04: owner won't use it.
- **P5 — Odysseus-as-service integration**: docker preset + BrowserPane bookmark + claude
  skill install flow in Settings → Integrations.
- **P6 — Cookbook-lite** (stretch): hardware scan + model download + llama.cpp serve
  managed from Rust.

## Status

- [x] P1 local-endpoint provider — shipped 2026-07-04 (needs live smoke vs LM Studio)
- [ ] P2 chat UX cherry-picks
- [ ] P3 pillar polish tracker
- [x] P4 Compare — dropped (owner decision, 2026-07-04)
- [x] P5 Odysseus service integration — DROPPED (owner, 2026-07-04). Checked
  their claude skill bundle first (`integrations/claude`): it contains exactly
  ONE skill (`odysseus`) whose every tool calls a RUNNING Odysseus server via
  ODYSSEUS_URL + a scope-gated token — without the Docker server there is
  nothing to pull. If email/notes/calendar ever matter, this whole item
  revives as a unit (server + skill).
- [x] P6 Cookbook-lite — DROPPED (owner, 2026-07-04).
