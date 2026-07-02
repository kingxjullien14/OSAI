# TRACKER — Build: 02 Framed Turns + Mission Control + Terminal HUD

Live board. Plan: `misc/PLAN-build-02-framed.md`. Started 2026-06-21.

**Gates:** tsc 0 · test:chatpane (145) · build ✓ · cargo check (if Rust).
**Backup:** `misc/backups/ChatPane.<date>.tsx.bak` before Phase A edits.

## EPIC 1 — Chat pane → 02 Framed Turns
- [x] **A · grouping + frame shell** — grouping pass over `blocks`; non-positioned `TurnFrame` wraps each assistant run; `blockElsRef`/find/minimap/`BlurFade` intact. *(gated: tsc 0 / 145 / build ✓)*
- [x] **B · you-card** — `UserBubble` is now the compact accent-glass card w/ mono `YOU · time` strip. *(same gate)*
- [x] **C · aios header strip** — status dot (success/accent) · `AIOS · <model.label>` · `worked Xs · n steps` (live → streaming shimmer). worked/steps from group activity durationMs + tool count. *(same gate)*
- [x] **D · polish** — live activity group now uses the same `CadencedShimmer` as the thinking block while running (unified "shimmer while working"); spacing/edge tuned earlier. *(open Q: model.label is the active model, not per-turn-historical — revisit if mixed-model resumes look wrong.)*

## EPIC 2 — Idle home → Mission Control ✅ *(REBUILT to match mockup after feedback; gated tsc 0 / 145 / build ✓)*
- [x] First "elevate" pass didn't match — **rebuilt** IdleControlCenter to the mockup dashboard: wide `max-w-[1080]` left-aligned, **top strip** (brand diamond + AIOS + live-agents chip), centered **greeting + "what should we work on?" + composer**, **quick-launch glass tile grid** (new chat/terminal/files/browser/history), **two-column cards** (`AgentsCard` live status + `RecentProjects`), **usage card** — all under mono `Eyebrow` headers.
- [x] Dropped `HeroClock` (mockup has none); `QuickActions` list→tile-grid; new `Eyebrow`. Updated the bundle-boundary test.
- [x] **Polish pass (owner feedback):** two columns are now **recent projects** (left) + **mini chat-history** (right, `MiniHistory` — title + snippet + engine badge, accent-tinted by engine, click resumes the session via `{type:"chat",resume}`); **usage = one glass card per provider** (claude/codex), not a shared card; **bottom status/ambient band removed** (+ cleaned StatusFooter/AmbientLine/workspaces/pinned/streak); project rows + meta now **accent-colored** (icon chips, accent kind label) instead of flat grey; **flat-grey ground replaced with a violet→cyan aurora wash** over a void-tinted base (`--color-bg` mixed toward accent; cyan drift blob replaces the amber one). All themeable, no hex (ratchet-safe).

## EPIC 3 — Terminal → HUD ✅ *(reworked after feedback; gated tsc 0 / cargo ✓ / 145 / build ✓)*
- [x] **HUD overlay**: corner brackets + accent inset ring (pointer-events-none, z-10). **Scanline REMOVED** — it shimmered/moiréd over the real xterm canvas (looked broken).
- [x] **Readout strip** above the host: mono stat chips (status dot · shell/kind · cwd · live/exited) — the mockup's HUD readout.
- [x] **xterm retheme → Neon Glass** (`THEME` in TerminalRuntime; was muted "Tomorrow Night orange"): deep-violet ground `#0A0713`, `#C4BEDA` fg, accent cursor (live `--color-cursor`), neon ANSI palette (violet/cyan). File is ratchet-exempt for hex.
- [x] **tmux status bar restyled** (`pty.rs` apply_mux_style + reattach blocks): the olive/green default → `status-style bg=#0A0713,fg=#8A83A3`, accent window name, cyan active marker, faint host/time. (Hex set ops no-op safely if the mux can't parse.)
- [x] **Translucent xterm bg** (`allowTransparency: true`, bg `rgba(8,5,15,0.66)`) over a new **aurora layer** behind the host → the frosted terminal glows like the mockup glass.
- **DECISION:** do NOT build a custom terminal — xterm.js IS the VSCode engine; rebuilding = regression. Design control comes from theming xterm + taming tmux (done above).

## EPIC 4 — Files pane ✅ *(gated tsc 0 / 145 / build ✓)*
- [x] Frosted toolbar + git chip + git-decorated tree rows + selected accent bar — already shipped in P4.
- [x] **NEW inline glass preview panel** (net-new) — `PanelRight` toggle in the header (persisted `aios.files.preview`); selecting a FILE splits the pane: tree left, frosted `FilePreviewPanel` right. Loads `readFilePreview` (text ≤256KB → mono pre + truncation note; image → `fileSrc` img; pdf → iframe; office/video/binary → typed placeholder). Header shows name + size + **open-in-editor** hand-off. New `fmtBytes` helper.

## EPIC 5 — History pane ✅ *(already feature-complete; gated tsc 0 / 145 / build ✓)*
- [x] **Starred group + multi-select + bulk delete/export** were ALREADY built (`setStarred`, `selected` set, `doDelete`, starred filter group). Rich rows + date groups shipped in P3.
- [x] Selection action bar → frosted glass + accent count (parity touch). *(Mockup's "floating" bar = inline strip in reality; left as-is — functionally identical.)*

## EPIC 7 — Pulse neon data-viz ✅ *(gated tsc 0 / 145 / build ✓)*
- [x] Shared `Ring` arc gains a neon glow (drop-shadow in its level color — lifts rings here + on the idle home).
- [x] Streak hero / rate-rings / heatmap wrapped in `surface-card` glass; streak number gets an accent text-glow; mono eyebrow on the heatmap.

## EPIC 6 — Settings sectioned ✅ *(already sectioned; gated tsc 0 / 145 / build ✓)*
- [x] Settings was ALREADY a sectioned glass modal (left nav rail via `NAV` + `SlidingIndicator` + scrollable panel + appearance live-preview). Matches the mockup's structure.
- [x] Active nav indicator tied into the unified language: accent left-bar (inset shadow) + wash + soft glow.
- [ ] *(optional later)* settings search box — the one mockup element not present; low priority.

## EPIC 7 — Pulse neon data-viz  *(approved; mockup `7fb7b53f…`)*
- [ ] Glowing sparklines/bars + gauge rings (reuse NumberTicker/fx).

## EPIC 8 — Chrome redesign (sidebar + the 3 icon surfaces) ✅ *(approved + built; gated tsc 0 / 145 / build ✓)*
Mockup (all 4 surfaces): `claude.ai/code/artifact/d62e0de4-27c5-40e5-82bb-0c6ce56232dd`.
- [x] **Sidebar** — glowing brand **diamond** mark (replaces Home icon; still rests panes to home), **unified HUD action cluster** (palette·panes·voice·bell bracketed in one glass control). *(rows/eyebrows/usage already Neon Glass from P2.)*
- [x] **Command palette** — frosted translucent card (was panel/95), mono-uppercase group eyebrows, active row = accent left-bar + wash + inset glow.
- [x] **Mission Control overview** — pane cards → glass (translucent + blur), active card gets accent ring + glow, frosted chrome strip.
- [x] **Notifications** — frosted header (accent unread count), **glowing level dots** (success/warn/error/info), unread = accent left-bar + wash.

## Live-app fixes + polish (2026-06-21, all gated tsc 0 / 145 / build ✓)
- [x] **Composer → 02 mockup**: signature lit top edge (accent→cyan via new `--aios-accent-2` token), gradient glowing send (+ `press` ClickSpark easter egg), accent-tinted model pill (`CTRL_PILL_MODEL`). cwd-picker CTA gradient too.
- [x] **Dropdown menus redesign**: frosted glass container (translucent + blur + lip); `MenuItem` active = accent left-bar + glow + Check (was a flat dot) — covers model/access/context/effort pickers.
- [x] **Day-separator bug**: jun19→today→jun19 flip-flop + turn-splitting fixed — only user/assistant/result/compaction anchor days (`dayAnchorTime`); mid-turn blocks inherit.
- [x] **RunCinema makeover**: aurora-free frosted backdrop (blur-2xl), frosted header w/ accent clapper + stat chips + lit edge, timeline spine + glowing beat-dots, glowing completed divider, live playhead cursor; transport = restart/step-back/play(gradient)/step-fwd + speed + custom scrubber (color-coded event ticks + glowing fill/thumb); ←/→ · Home/End keys.
- [x] **RunCinema regression fix**: `.aios-stage` on the absolute overlay set `position:relative` + opaque bg → collapsed it out of full-pane, dropping the transport. Reverted to `absolute inset-0`.
- [x] **Activity replay spacing**: the always-present `opacity-0` "▶ replay" block reserved ~20px under every collapsed group → now `absolute` top-right (out of flow).
- [x] **Scrollbar/minimap**: (1) thumb froze on wheel-scroll — `onScroll` swallowed rail updates when `programmaticRef` stuck true; now always syncs the rail, only gates pause-intent. (2) drag felt sluggish — `railScrubTo` centered the point; now tracks the cursor 1:1.

## Mockup-fidelity redo — Files + History (2026-06-21; gated tsc 0 / 145 / build ✓)
- **Files** to mockup: cyan `git` chip; preview = cyan file-icon chip header + **line-numbered code body** + footer (gradient **open-in-editor** + ghost **open-in-browser**); tree → **mono "code-editor" font**, mockup selected wash (13% accent + inset accent bar), brighter selected name. **Click model fixed:** single-click a FILE → preview only (no new pane); **double-click** → open in a new pane; dirs expand on single click. Preview panel now **defaults ON**.
- **History** to mockup: the inline top selection strip → a **floating bottom-center glass pill** (accent border + blur + glow) with **star · export · delete · ✕**; added bulk `doStar`. (Rich rows + date/starred groups already shipped in P3.)
- **Files (round 2):** single-click = preview only / double-click = open pane (was opening a pane on every click) + preview defaults ON; **reveal** button added (footer) → `browser_reveal_in_finder` (Finder/Explorer, platform-aware); **light syntax highlight** in the preview (strings green / numbers cyan / comment lines faint — dependency-free, per-line); git status word in the meta (added/modified…).
- **Chrome fidelity pass:** sidebar (brand diamond + HUD cluster + accent rows/surfaces), palette (frosted + mono eyebrows + accent active row), notifications (glowing level dots + unread accent bar) — done across prior passes. **Mission Control overview** cards → richer **accent app-tiles** (icon chip + kind tag) instead of a faded glyph. *(Mockup's literal live mini-previews aren't feasible — the overlay has no live pane content; app-tiles are the honest equivalent.)*

## App-wide accent-tinted surfaces (2026-06-21, owner request; gated tsc 0 / 145 / build ✓)
- Owner: cards should be a **dark blackish-accent** fill with a **neon-accent outline**, the same everywhere, driven by the Settings accent (no hardcoded color).
- **`--color-panel` / `--color-panel-2` retinted** toward `--color-accent` (8% / 10% `color-mix`, in BOTH the `:root` + `html[data-theme="dark"]` blocks) → every surface that draws from the panels (cards, composer, menus, rows, inputs, `.glass*`, `.surface-*`, `.pane-header`, inline `bg-panel*`) now reads dark-accent, app-wide + themeable.
- New **`--aios-surface-edge` / `--aios-surface-edge-strong`** tokens (26% / 42% accent) → wired as the borders of `.surface-card`, `.glass`, `.glass-strong`, `.surface-pop` (the neon outline). Re-tints with the accent.
- **Idle home ground → `.aios-stage`** (same animated aurora as the chat pane) per owner; dropped the bespoke idle aurora.
- **Card-darkening pass (owner: "make cards darker, not the app bg"):** lowered the panel BASE lightness (panel 0.183→0.158, panel-2 0.205→0.172) while keeping/bumping the accent mix (9/11%) → deeper "blackish-accent" cards. App background (`--color-bg`) + `.aios-stage` blooms reverted to original (the earlier darken was the wrong layer). *(Tunable: base L + mix % + edge alpha are single-token knobs.)*

## Settings — sectioned redesign + audit (2026-06-22; gated tsc 0 / 145 / build ✓)
Built to the owner's `settings-sectioned.html` mockup.
- **Shell:** `.glass-strong` panel ~900×600, rounded-18. Nav **236px** with the signature **gradient right-edge** (accent→accent-2), a **gradient brand diamond** + wordmark, a **search box**, and a **mono build-line footer**.
- **Search:** filters sections by label **+ keyword tags** (e.g. "theme"→appearance, "keys"→shortcuts); hides group headers + the sliding indicator while querying; empty-state line.
- **Section cleanup:** the 12 flat nav items are now grouped under **preferences / workspace / system** headers. Each section's rows are grouped into **labeled Neon-Glass cards** (`Card` = `.surface-card` + eyebrow **inside** the lip + whisper dividers), matching the mockup's `.card`/`.eb`/`.set` structure. Header = 18px title + 12.5px subtitle (per-section `SECTION_BLURB`).
- **Controls restyled:** Toggle (glow when on + `press`), **Segmented → connected control w/ border-l dividers + subtle accent wash** (not solid fill, per mockup), Stepper (glass + accent hover), Slider (**accent→accent-2 gradient fill** + glow thumb), all text inputs → shared `FIELD`/`FIELD_MONO` (glass + `glow-focus`). Shared `GHOST_BTN`.
- **Scrollbars hidden** in the nav, the content pane, and the projects list.
- **Options audit (owner-approved calls):**
  - Removed **dead `accentIntensity`** field (zero consumers) and the whole **memory section** (`graphPhysicsStrength` drove nothing — no pane renders `memoryGraph()`; vault path was a placeholder). Dropped `MEMORY_VAULT_PATH`. *(memory-as-search `@memory` in chat untouched.)*
  - Removed the dead **About github/docs** buttons and the notifications **"next control layer"** stub.
  - **Added "reset preferences"** (About) — resets appearance/behavior/notification prefs to defaults but **preserves** name, engine choice, onboarding (two-step confirm).
  - `defaultAi` left auto-derived (correctly not a manual option).
- Projects + Diagnostics + UpdateCard given a light glass pass so they sit with the new cards.
- Test strings preserved: `rail style`, `native alerts`, `top bar`, `prompt</span>`; no `superapp`. Settings.tsx stays hex-ratchet-exempt.

## Decisions / log
- 2026-06-22: Settings audit — owner chose **remove memory section**, **remove dead About buttons**, **add reset-all**. Principle: don't add settings that don't do anything.
- 2026-06-21: Owner picked **02** (not 04 hybrid, not 01/03). Build starts.
- Open Q: sidebar + top icon strip redesign — owner asked "thoughts?"; awaiting go to mock.

## Parked
- `Ripple` fx — still no home.
- Translucent-transcript over aurora — optional.
