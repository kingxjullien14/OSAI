# PLAN — App-wide redesign: **Neon Glass**

Owner-driven aggressive restyle of the whole AIOS app. Direction chosen
2026-06-19: **Neon Glass** (frosted translucent surfaces + restrained accent
glow; dark, futuristic, polished). Design system: `misc/DESIGN.md` (rewritten —
the old "calm/restrained" spec was Firaz's and is discarded). Accent stays
runtime-themeable (owner runs violet/purple).

**Backup:** `misc/backups/ChatPane.2026-06-19.tsx.bak` (pre-restyle ChatPane).

## Principles (the bar for every surface)
- Frosted glass fills (`.glass` / `.glass-strong`) over the `bg` ground, not flat panels.
- Glow = the accent material: focus / active / primary / alive. Never decoration.
- Hairlines + a top edge-highlight (the "glass lip"). Depth from blur + light.
- Calm type hierarchy; mono for the machine's voice. Leave breathing room.

## Gates each batch
`npx tsc --noEmit` · `npm run test:chatpane` · `npm run build` · `cargo check` (only if Rust touched).

---

## P0 — Foundation ✅ *(gated: tsc 0 / 145 tests / build ✓)*
- [x] Neon Glass tokens + utilities in `App.css`: `--aios-glass-{bg,bg-strong,blur,edge}`, `--aios-glow-{accent,soft,live}`; `.glass`, `.glass-strong`, `.glow-accent`, `.glow-focus`, `.glow-live`, `.edge-grad`. Glow refs `var(--color-accent)` → re-tints with theme.
- [x] Glassy scrollbar: slim padding-box thumb, lights to accent on hover.
- [x] Fallbacks: `@supports not (backdrop-filter)` → near-solid glass; `prefers-reduced-motion` → `.glow-live` static.
- [x] **`.aios-stage` ambient ground** — accent-tinted radial blooms behind the app shell (themeable; mixed from `var(--color-accent)`). This is the atmosphere the glass chrome refracts — applied to the App shell wrapper. *(What was missing earlier: glass over a flat ground reads subtle; glass over blooms reads "Neon Glass".)* Shows through the glass sidebar/header/composer + pane gutters; opaque transcript still covers it (translucent-transcript = optional next step).

## P1 — Chat pane *(in progress)*
- [x] Composer → `.glass-strong` + `.glow-focus`; live `.glow-live` while streaming. (Tighter 14px body + compact padding already shipped.)
- [x] **Composer layout = "01 · Zoned"** (mockup-approved): gradient lit divider between the input hero and the control bar; control bar at `pt-2`.
- [x] **Unified attachment tray** (inside composer top): images + quoted snippets + attached-memories in one row; moved snippets/memories OUT of the summary-chips row.
- [x] **Image preview dialog** (`ImagePreview`, portaled): click a thumbnail → full-size confirm/remove before sending (Esc / backdrop closes). Thumbnails enlarged (16×16) + glow on hover.
- [x] User bubble → accent-soft wash + accent edge + soft glow.
- [x] Jump-to-latest + scrubber bubble → `.glass`.
- [x] Accent is user-choosable in **Settings → Appearance** (presets incl. violet `#924ff7` + recents + custom hex/native picker; live re-tint). Confirmed already built — no change needed.
- [x] **Model pill moved to the right zone** (next to send) — matches mockup 01. (Done as two small div-boundary edits, no Dropdown-body move.)
- [x] **Control pills → glass** (CTRL_PILL/OPEN consts): translucent + blur; active = accent wash + edge + soft glow.
- [x] Transcript cards (first pass): **ChangeCard** + **CompactionCard** detail → `.glass`.
- [x] **Translucent transcript ground** — `.aios-stage` applied to the chat-pane root: the ambient blooms now glow behind the chat body (transcript is transparent over it). `.aios-stage` refactored to an **animated aurora** (blooms on a `::before` that drifts on a 24s loop; reduce-motion → static; isolation:isolate so content stays above).
- [x] **Scrollbar redesign** — native bar hidden on the transcript; the minimap rail is now the single indicator: a content-space **thumb** (window of height clientHeight/scrollHeight) + markers in the SAME content space, so markers slide *inside* the thumb and never sit "below the bar" (the reported bug). Click-to-scroll centers the point; rail shows whenever scrollable (thumb even with <9 blocks).
- [x] **Eye candy (fx lib — `motion@12` + adapted Aceternity/Magic-UI/ReactBits in `src/components/fx/`):** `BorderBeam` laps the composer edge (faster while streaming; static ring on reduce-motion); `spotlightMove` + `.aios-spotlight` cursor-follow glow on glass change-cards.
- [x] **Transcript cards → glass:** CodeBlock (`.glass`), ApprovalCard (main = accent glass + glow; resolved chip = glass), ResultFooter error (danger glass + glow), FileCard (translucent + blur). *(ActivityStep left as the minimal border-left list — not a card.)*
- [x] **fx wired:** `TiltCard` (3D tilt + glare on image thumbs), `HoverBorderGradient` (rotating ring on the send CTA), `DotPattern` (quiet dot-grid texture on the chat ground), `NumberTicker` (animated est-tok count). `BorderBeam` (composer) + `spotlightMove` (change-cards) from the prior pass.
- [ ] Thinking + activity groups: faint live shimmer while running.
- [ ] `Ripple` — it's an ambient concentric-rings effect (not a click-ripple); find a fitting home (e.g. behind the idle hero) or add a true Material click-ripple. Deferred.
- [ ] More fx still available in `src/components/fx/`: Spotlight, Confetti, BlurText, SlidingIndicator, Ripple. Deps free to add (motion/clsx/tailwind-merge present).
- [ ] `.edge-grad` signature edge on the composer (optional flourish).

**Mockups (reference):** full shell `claude.ai/code/artifact/6c823f3d-b75e-405a-b6e1-31884de8d1df` · composer layouts `claude.ai/code/artifact/acceeb31-dbde-4330-876c-5466c89429e1` (chose 01).

## P2 — Sidebar *(in progress)*
- [x] `<aside>` → frosted translucent panel + `backdrop-blur-xl`.
- [x] OpenPanesList active row: wash + soft glow + accent edge; hover = hairline edge-lift.
- [x] **Lit gradient seam** on the aside's right edge (accent→transparent vertical glow — the Neon Glass signature edge).
- [x] **SidebarRow launcher rows** (new chat/terminal/files/browser/history): border edge-lift on hover, accent wash + soft glow on drag-over — matches the OpenPanesList row language.
- [x] **SpaceHeader eyebrows** (OPEN/TOOLS/PINNED/AGENTS): mono uppercase, wide `0.18em` tracking — console voice.
- [x] **Usage meters** (`UsageGlance`, shared sidebar+home): bar fill keeps its semantic level color but gains a matching glow.
- [x] OracleRoster agent rows + ScheduledAgents template chips (glass + accent-glow hover) + AccountMenu chip (glass) — same row/glass language. **P2 sidebar COMPLETE.**

## P3 — History pane ✅ *(gated tsc 0 / 145 tests / build ✓)*
- [x] Rows → the shared row language: selected = accent wash + soft glow + accent edge; hover = hairline edge-lift. Trash rows too.
- [x] Group/starred/result headers → mono uppercase `0.18em` tracking (console eyebrows, matches sidebar).
- [x] Search bar → accent border on focus-within.
- [x] **History rows enriched to match the chat-pane resume card** (user: "history looked plain"): engine-colored `RotateCcw` icon, engine badge, always-on preview (`snippet` when searching, else `last_user`), icon'd meta line (folder · time · model), and a hover "resume ↵" affordance.
- [x] **Resume picker unified with History's logic**: regrouped by DATE (today/yesterday/this week/this month/older) via the shared `groupByDate` (was grouped by project), sorted recent-first, with console-mono group eyebrows. So the two "history" surfaces now share both look (rich card) and grouping/sort.
- [ ] *(optional later)* glass on the action bar / cleanup popover / selected-count pill.

## P4 — Files pane ✅ *(gated tsc 0 / 145 tests / build ✓)*
- [x] Tree rows: selected = accent wash + **inset left accent bar** (no layout shift on the dense 22px rows); hover = panel lift.
- [x] Toolbar header → frosted glass (`bg-panel/40 backdrop-blur`).
- [x] Filter bar → accent border on focus-within.
- [ ] *(optional later)* project-picker popover + breadcrumb chip polish (rolls into P5 popover pass).

## P5 — Pane chrome + shell ✅ *(gated tsc 0 / 145 tests / build ✓)*
- [x] **Shared utility upgrade (frames the whole app at once):** `.surface-pop` → full Neon Glass (translucent + blur + lip + shadow) so EVERY popover/dropdown/menu using it is glass; `.surface-card` → translucent + lip (no blur, perf-safe for lists); `.pane-header` (36px in-pane toolbars: Memory/Automations/Bridges/Plugins/Browser…) → frosted (`panel/45` + blur).
- [x] `PaneCard` 28px chrome strip → frosted (`panel/55` + blur). Window top-bar already used `glass`. Command palette already glass.
- [x] **Inline popovers converted to glass:** SidebarRow row-menu + SpaceHeader menu (shared substring → glass-strong bg + blur + pop shadow), ResumePicker container, and the App.tsx confirm modal. The two named modals (PinSite/SaveWorkspace) + overview overlay already used `glass`.
- [ ] *(optional)* pane grid gutters / maximize-restore polish.

## P6 — The rest (sweep) ✅ *(largely auto-completed by the P5 shared-utility upgrade; gated tsc 0 / 145 / build ✓)*
- [x] **Covered for free** by `.pane-header`/`.surface-card`/`.surface-pop` → glass (P5): the 14 panes that consume them — Settings, Notes/Memory, Bridges, Plugins, Browser, Pulse, Editor, FileViewer, AppCast, ScheduledAgents, Onboarding, + the already-done Chat/Files/History. Their toolbars are frosted, cards translucent+lip, popovers glass.
- [x] Modals/overlays glass (PinSite, SaveWorkspace, overview, confirm modal).
- [ ] *(optional polish)* per-pane audit for any INLINE `bg-[var(--color-panel-2)]` surfaces that bypass the utilities (spot-fix if noticed); toasts; terminal interior; accent-misuse pass.

## Cleanup + audit (2026-06-19)
- [x] **Consolidated `.glass`** — removed the duplicate bare backdrop-filter rule; the one full Neon Glass `.glass` (fill + blur + lip) in the utility section is now canonical.
- [x] **Per-pane audit + spot-fix:** swept 250 inline `bg-panel(-2)` occurrences across 32 files; most are intentional fills/hover/rows. Real *bypasses* found + fixed = **inline header bars** not using `.pane-header`: BrowserPane (×3), AppCastPane (×1) → now frosted (panel/45 + blur). FilesPane header done earlier.
- [ ] *Heaviest inline files to eyeball later (likely fine — rows/fills, not chrome):* Settings (36), TerminalComposer (14), OracleRoster (13), MirrorViewer (11), BrowserPane (remaining). No obvious card/header bypasses spotted beyond the headers above.

## Complete-redesign candidates *(for owner feedback — these want a makeover, not a retouch)*
Ranked by impact. I'd mock these up (like the composer lab) before building.
1. **Idle / home dashboard** ("good evening … what should we work on?") — TOP PICK. It's the first screen and currently minimal (hero + composer + resume rail). Reimagine as a Neon Glass **mission control**: live agent/oracle status, recent work + resume cards, usage-at-a-glance, quick-launch tiles — all glass on the aurora. Biggest first-impression win.
2. **Terminal pane** — chrome + composer. The "operator console" voice invites a fuller **HUD** treatment here specifically (corner brackets, readouts, scanline) where it fits the content; the rest of the app stays calmer glass.
3. **Settings** — likely a long flat form (36 inline surfaces). Redesign into a modern **sectioned settings**: left section-nav + searchable glass cards, live previews.
4. **Pulse / stats dashboards** — neon **data-viz** pass (glowing sparklines/bars, gauge rings) — currently plainer than the rest.
5. *(stretch)* multi-pane grid framing / gutters — higher risk; only if the above land well.

**Mockups (all 4 built):**
- ✅ **APPROVED to build:** Mission-control home `claude.ai/code/artifact/5100b677-e2cc-4efa-a8e0-0a2323b6ba3e` · Terminal HUD `claude.ai/code/artifact/773a4f60-046c-4605-bade-7eb37fbe6b36`.
- Awaiting verdict: Settings sectioned `claude.ai/code/artifact/d7d21e0a-aabf-4ccb-87b8-6f5e1fc80ff4` · Pulse neon data-viz `claude.ai/code/artifact/7fb7b53f-47ba-414f-8825-ff87cc53ab15`.
- **Mockup-fidelity visions of already-shipped panes (owner asked to see them elevated):** Chat pane `claude.ai/code/artifact/f21f51a8-f2cc-44d6-b91e-6789c88bd237` (thinking + activity + glass change-card w/ 2-tone diff + prose + user bubble + zoned composer + minimap) · Files pane `claude.ai/code/artifact/e9cebc9e-db44-4777-8211-f15226b5a9f0` (tree + **NEW inline glass preview panel**) · History pane `claude.ai/code/artifact/3e955ab0-022f-4c65-ac7b-f05dfbe55d6d` (date groups + starred + rich rows + multi-select action bar). These extend the *already-shipped* Neon Glass on those panes — gaps vs reality: Files **preview panel** is new; the rest is mostly polish parity.

**Build queue (real app), once confirmed:** (1) Idle home → Mission Control (IdleDashboard/IdleControlCenter), (2) Terminal HUD (TerminalRuntime + TerminalComposer). Reuse existing `--aios-glass/glow` tokens + fx; mostly composition.

## Parked (chat-pane polish, revisit)
- [ ] Thinking + activity groups: faint live shimmer while running.
- [ ] `Ripple`: find a home or build a true click-ripple.
- [ ] Consolidate the two `.glass` rules in App.css.

## Notes / decisions
- Keep token NAMES frozen (theme.ts + ThemeSwitcher bind to them); add only the additive `--aios-glass-*` / `--aios-glow-*`.
- `backdrop-filter` cost: cap the number of *stacked* blurred layers; the ground itself never blurs.
- Don't reintroduce the composer usage strip (sidebar usage is canonical — see memory).
