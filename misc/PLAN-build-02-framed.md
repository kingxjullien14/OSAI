# PLAN — Build: Neon Glass, **02 Framed Turns** + Mission Control + Terminal HUD

Locked 2026-06-21. This is the **build** plan (the design exploration is done).
Companion live board: `misc/TRACKER-build-02-framed.md`. Design system:
`misc/DESIGN.md` (Neon Glass). Supersedes the exploratory
`misc/PLAN-redesign-neon-glass.md` for everything still open.

## Locked designs (the specs we build to)
- **Chat pane → `02 · Framed Turns`** — chosen over 01/03/04.
  Mockup: `scratchpad/chat-full-02-framed.html`.
- **Idle home → Mission Control** — `claude.ai/code/artifact/5100b677-e2cc-4efa-a8e0-0a2323b6ba3e`.
- **Terminal → HUD** — `claude.ai/code/artifact/773a4f60-046c-4605-bade-7eb37fbe6b36`.
- **Files pane** — `claude.ai/code/artifact/e9cebc9e-db44-4777-8211-f15226b5a9f0` (frosted toolbar + git chip, tree w/ git decorations + selected accent bar, **NEW inline glass preview panel** — today it's tree-only).
- **History pane** — `claude.ai/code/artifact/3e955ab0-022f-4c65-ac7b-f05dfbe55d6d` (date groups + **starred** group, rich resume-style rows: icon + badge + preview + meta + hover "resume ↵", floating multi-select action bar).
- **Settings — sectioned** — `claude.ai/code/artifact/d7d21e0a-aabf-4ccb-87b8-6f5e1fc80ff4` (left section-nav + searchable glass cards + live previews).
- **Pulse — neon data-viz** — `claude.ai/code/artifact/7fb7b53f-47ba-414f-8825-ff87cc53ab15` (glowing sparklines/bars + gauge rings).
- **Proposed (needs a mock + nod):** Sidebar complete redesign + top icon strip — see TRACKER "Sidebar?".

All six above are **owner-approved to build**. Build order: chat first (in
flight), then Mission Control + Terminal HUD, then the four panes. Files/History
extend the already-shipped Neon Glass on those panes — the big net-new is the
**Files preview panel**; Settings + Pulse are fuller redesigns.

---

## The 02 spec (chat pane)
Every conversational turn becomes a **framed glass card**; sub-parts nest inside.

**You-turn** (`.card2.you`)
- Right-narrowed accent-glass card: `border` accent/30 + soft outer glow, blur 12.
- Header strip (`.strip`): accent dot (glow), `YOU` (mono, 10.5px, tracked), time pushed right (faint).
- Body: 13.5px / 1.5 plain text.

**AIOS-turn** (`.card2`) — **one frame per assistant response**, groups all of:
thinking fold · activity/tool steps · change cards · assistant prose · result footer.
- Hairline card, glass fill (`glass 72%`), blur 12, inset lip.
- Header strip: status dot (green settled / cyan streaming) · `AIOS · <MODEL>` (mono) · right = `worked <Xs> · <n> steps` (from the group's activity duration + step count; streaming → `streaming…`).
- Body keeps the **document typography** already shipped (accent-ruled headings, 13.5px prose, glowing bullets, take block, nested glass change/code/source cards).
- **Left accent edge** kept subtle (the 02 frame already reads as "assistant"); revisit after first look.

**Chrome / rail / composer** — already shipped in the Neon Glass pass; keep. Minimap rail stays the single scroll indicator.

### Architecture: turn grouping (the real work)
Today `blocks` is a flat list rendered 1:1. 02 needs assistant blocks grouped:
1. **Grouping pass** over `blocks`: a `user` block → its own you-frame; the run of
   non-`user` blocks after it → one assistant-frame group. (compaction / day separators
   stay top-level, between frames.)
2. **`TurnFrame`** wrapper component: the card chrome + computed header strip. Children =
   the existing per-block renders, **unchanged**, so all their internals keep working.
3. **Preserve invariants:**
   - `blockElsRef` per-block refs must stay on the inner block wrappers (find-jump +
     minimap geometry read `offsetTop`). The frame is positioned, so measure against the
     scroll container, not `offsetParent` — verify markers still align after wrapping.
   - `BlurFade` entrance: move to the **frame** (settle) so token appends inside a live
     assistant frame don't retrigger; user frame keeps its entrance.
   - `find-current` highlight + `chat-block` class stay on inner wrappers.
4. **Header derivation:** model from the turn's result/assistant meta; `worked Xs` from
   summed activity `durationMs` (or live elapsed); `n steps` from tool count.

### Build phases (chat) — each gated
- **A · grouping + frame shell** — grouping pass + `TurnFrame` (you/aios variants, header strip), refs/find/minimap intact. *Gate.*
- **B · you-card** — compact accent-glass right-narrowed card (retire the old `UserBubble` chrome into the frame). *Gate.*
- **C · aios header strip** — model + worked/steps + status dot; streaming shimmer. *Gate.*
- **D · polish** — left edge tuning, spacing, live shimmer on thinking/activity (the parked item finds its home here). *Gate.*

## Mission Control (idle home) — after chat lands
Compose from existing `--aios-glass/glow` tokens + fx. New `IdleDashboard`:
live agent/oracle status · recent-work resume cards · usage-at-a-glance · quick-launch tiles — glass on the aurora. Mockup is the spec.

## Terminal HUD — after Mission Control
`TerminalRuntime` + `TerminalComposer`: corner brackets, readouts, calmer-than-game HUD. Mockup is the spec.

## Files pane — `e9cebc9e…`
Extends shipped Neon Glass. Build: frosted toolbar + git-branch chip; tree rows
gain git decorations (M/A/?? color dots) alongside the existing selected accent
bar; **new inline glass preview panel** (split: tree left, file preview right —
syntax-lit for code, render for md/img). The preview panel is the real feature.

## History pane — `3e955ab0…`
Mostly polish-parity (rich rows + date groups already shipped). Build the gaps:
a **starred** group (pin/star a conversation), and a **floating multi-select
action bar** (select rows → bulk delete/star/export).

## Settings — sectioned — `d7d21e0a…`
Fuller redesign of the flat form: left section-nav rail + searchable glass cards,
live previews (e.g. accent picker previews on a sample card). Keep all existing
settings + bindings; reorganize into sections.

## Pulse — neon data-viz — `7fb7b53f…`
Data-viz pass: glowing sparklines/bars + gauge rings replacing the plainer
current charts. Reuse `NumberTicker`/fx; keep the data sources.

## Gates (every phase)
`npx tsc --noEmit` · `npm run test:chatpane` · `npm run build` · `cargo check` (only if Rust touched).

## Constraints (carried)
- Don't reintroduce the composer usage strip (sidebar usage canonical).
- Token NAMES frozen; accent stays runtime-themeable (glow refs `var(--color-accent)`).
- Cap stacked blurred layers; ground never blurs.
- Backup before heavy edits (see TRACKER).
