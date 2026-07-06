# PLAN — the Odysseus feel (windowed workspace + chat stream anatomy)

Owner: after running Odysseus locally, the verdict is "I want AIOS to *feel* like this" —
resizable floating windows, context menus, the way chat streams, the whole UX. This plan
decomposes that feel into buildable ingredients and revamps the pane basics to match.
Supersedes/absorbs P2 of `PLAN-odysseus-hybrid.md` (chat UX cherry-picks) and adds the
windowing revamp. **AGPL guard: study their files for behavior only — never copy code.**

## What the feel actually is (from their source)

Studied modules (reference only): `static/js/modalManager.js` (1.5k), `tileManager.js`,
`modalSnap.js` (1.1k), `escMenuStack.js`, `toolWindowZOrder.js`, `chatRenderer.js` (2.7k),
`chatStream.js`.

1. **Floating windows over a canvas.** Chat is the base surface; every tool (Tasks,
   Library, Gallery, …) is a draggable, resizable window above it. Windows have
   minimize (**state preserved**, rail icon gets a badge) vs close (teardown), and a
   monotonic z-order — click brings to front.
2. **Snap zones with ghost preview.** Dragging a window header near an edge shows a
   translucent ghost; release snaps with a springy animation. Top strip → maximize,
   left/right/bottom edges → halves. Pre-snap geometry is remembered; dragging away
   restores it.
3. **Edge docking.** Drag hard to the left/right edge → window becomes a side *panel*:
   the workspace underneath reserves room (`--right-dock-w` on body), width is
   resizable and remembered per-window in localStorage, and if the remaining chat
   width would drop under ~380px the sidebar auto-collapses to an icon rail.
4. **Esc stack.** One global stack: Esc dismisses the topmost popup → menu → window in
   order. Everything transient participates.
5. **Chat stream anatomy** (the part the owner screenshotted):
   - Reply header: `provider → model-name` route label + timestamp, model-colored.
   - Collapsible **thinking card** with live duration + token count (`1.3s · 195 tok`),
     inner scrollbar, blockquotes styled inside.
   - Footer bar per reply: `110.73 tok/s` · copy · delete · ⋯ menu · **ctx %** chip whose
     hover popover shows Context Window (used / total, model, usage %).
   - Session header: title · msg count · running **$cost** dropdown.
   - User message = compact floating bubble, hover reveals edit/✕/⋯.
6. **Density + typography.** Monospace everywhere, compact paddings, thin scrollbars,
   glow accents, subtle animated background art behind the canvas.

## Where AIOS is today

- Workspace = uniform N×M CSS grid ([ResizableGrid.tsx](../src/components/ResizableGrid.tsx)),
  gutter drags resize whole tracks. No floating, no minimize-with-state, no snap
  gestures, no z-order, no edge dock. Pane list lives in [App.tsx](../src/App.tsx) (~5.7k lines).
- Chat already has thinking blocks, plan cards, FleetView, steering — but not the
  route header / tok/s / ctx% / cost anatomy (those largely want the BYOK runtime).
- Context menus: only PaneMenu; no shared primitive.

## Architecture decision

Build a real **window manager layer** and migrate panes onto it, keeping the grid as a
fallback until parity. Key choices:

- **Pure engine first** (`src/lib/windowing.ts`): rects, z-order, snap hit-testing,
  dock math, minimize/restore, (de)serialization — no DOM, fully unit-tested, same
  pattern as chatScroll/chatPaneState.
- **Chrome second** (`src/components/WindowLayer.tsx` + `FloatingWindow.tsx`): header
  drag, 8 resize handles, traffic buttons (minimize / maximize / close), ghost preview
  element, docked-panel mode.
- **Beta toggle**: Settings → "Windowed workspace (beta)" swaps the workspace renderer
  between grid and WindowLayer. Same `Pane[]` model underneath — a window is a pane
  with geometry. Flip to default once daily-driver parity is confirmed; then retire
  the grid.
- Sidebar rail = Odysseus-style toggle: click opens / restores / minimizes; badge dot
  when minimized.

## Waves

- **W0 — window engine (pure lib + tests)**: `src/lib/windowing.ts` +
  `windowing.test.ts`. Snap-zone hit-test, zone→rect, z-order (bring-to-front with
  renormalization), resize-from-any-edge clamping, dock width clamp, minimize/restore,
  layout serialize/hydrate with viewport re-clamping.
- **W1 — chrome**: FloatingWindow + WindowLayer components; panes render inside
  windows behind the beta toggle; persistence of window geometry per workspace.
- **W2 — gestures**: drag ghost + snap zones, edge dock with workspace reservation +
  remembered widths, Esc stack, sidebar rail integration (open/restore/minimize +
  badges), reduced-motion respected.
- **W3 — context menus**: one shared `ContextMenu` primitive (portal, esc-stack aware,
  submenu support); wire surfaces: pane/window header, chat message, session row in
  history, file row, terminal.
- **W4 — chat stream anatomy** (pairs with BYOK P1 in `PLAN-odysseus-hybrid.md`):
  provider→model route header, thinking card duration+token live stats, reply footer
  (tok/s, copy, ⋯, ctx% chip + Context Window popover), session cost in header, user
  bubble hover actions. Claude-CLI sessions get the same anatomy where the stream
  provides data (duration/tokens exist; tok/s computable).
- **W5 — density + canvas**: compact-mono theme variant ("Terminal" density in Neon
  Glass), animated background art layer behind the window canvas, thin scrollbars,
  then flip windowed mode to default.

## Status

- [x] W0 engine + tests (2026-07-03)
- [~] W1 chrome + beta toggle (2026-07-03) — implemented, tsc 0 / 256 tests / vite build
  clean; **needs a live smoke test** (toggle Settings → appearance → "windowed
  workspace (beta)", then drag headers / resize edges / minimize / restart-persist).
- [~] W1.5 chat canvas (2026-07-03, owner-requested same day) — in windowed mode the
  chat panes stop floating and become ONE rearmost full-bleed canvas under the tool
  windows (the Odysseus model). New `ChatTabStrip.tsx`: top-center pill strip with a
  pill per open conversation (busy dot, close ✕), new-chat, and home. The idle
  dashboard is now a lock-screen-style overlay — auto-shown when nothing is open,
  summoned via the strip's house button, dismissed by Esc/✕/opening anything.
  Newest conversation auto-takes the canvas. tsc 0 / 256 / build clean; needs the
  same live smoke test. Tab labels use the recorded session title when available
  (falls back to pane label; ref-based so may lag one render).
- [x] W1.5a fixes from owner's first live test (2026-07-03 evening):
  - **Canvas dead-input bug**: WindowLayer's full-workspace container swallowed all
    pointer events over the chat canvas (couldn't type/click/context-menu; floating
    windows worked). Fix: `pointer-events-none` on the layer, `pointer-events-auto`
    on each FloatingWindow.
  - **Lock-screen home**: idleDash hoisted to component scope; the overlay now
    covers the WHOLE app (sidebar included, `fixed inset-0 z-50`) and slides down/
    up (framer AnimatePresence, reduce-motion → instant). Dismiss = Esc / "enter
    workspace" pill (bottom-center) / opening anything. Auto-shown when no panes.
    Sidebar brand button in windowed mode summons the lock screen instead of
    hiding panes.
  - **Sidebar collapse control**: visible fold button at the sidebar top
    (full ↔ icon rail, persists via sidebarMode; ⌘B still hides fully).
- [~] W1.5b canvas-model feedback batch (2026-07-03, owner's second live test):
  - **Chats can't hide anymore** (windowed): hiding orphaned them from the strip.
    `onToggleHide: undefined` for canvas chats; the strip is their only toggle.
  - **Floats minimize, not hide**: menu item reads "Minimize window"; minimized
    tools collect in a **tray** (pills, bottom-right of canvas) — click restores
    + raises. New `hideLabel` prop on PaneCard.
  - **Strip context menu**: right-click a pill → rename (inline edit; double-click
    also works) / close. Renamed pane labels win over session titles.
  - **Frameless canvas chat**: new `frameless` prop on PaneCard — the rearmost
    chat renders with NO shell (no header strip/border/rounding, full-bleed
    inset-0); right-click menu, error boundary, drop routing all kept.
  - **OPEN list retired in windowed mode** (strip + tray replace it).
  - **Lock-screen lag fix**: overlay is now ALWAYS MOUNTED and slides via pure
    CSS transform (`inert` when up) — the jank was the dashboard re-mounting
    mid-animation. Also removed the "continue working" section from the home
    surface per owner (workSessions={[]}; still resumable via palette).
  - **Sidebar restyle (shell pass)**: fixed header row = brand (home) + fold
    toggle, always visible; cleaner scroll column (gap-3); footer unchanged.
- [~] W1.5c strip polish + archive (2026-07-03, owner's third live pass):
  - strip pills scroll WITHOUT a scrollbar (hidden on both engines); rename
    input sizes to its content instead of a fixed width.
  - **Archive**: right-click a pill → "Archive conversation" — it leaves the
    strip into a box-icon dropdown (count badge) on the strip's right; picking
    one restores it to the strip + canvas. Backed by the existing hiddenKeys
    (archived chat = hidden pane; state keeps streaming, busy dot shows in the
    dropdown).
  - **Squished-composer root cause fixed in ChatPane**: the composer autosize
    read `scrollHeight` while the pane was display:none (toggled-away canvas
    tab or restored hidden layout) and never re-measured → 0-height textarea
    when revealed. A ResizeObserver on the textarea now re-fits the moment it
    gains real layout.
  - Owner's remaining visual notes deferred to the design pass (W1.6/W5) by
    their request.
- [~] W1.6 sidebar redesign, first full pass (2026-07-03 night, owner: "make it THE
  sidebar, shadcn-inset style"):
  - **Inset shell**: sidebar is borderless/panel-less on the app canvas; the
    workspace floats beside it as a rounded-xl, bordered, elevated INSET CARD
    (`<main>` gets my-2/mr-2 + rounded + shadow; compact/mobile exempt).
  - **Item rows redone**: icon CHIPS (rounded squares that warm to accent on
    hover), hover translate-x nudge, softer hover wash instead of border boxes,
    tighter type (12.5px). Section hairlines now gradient (no hard borders).
  - **Usage → dialog**: pinned usage block replaced by a calm "usage" trigger in
    the footer; opens a centered glass dialog (Gauge icon, backdrop blur,
    Esc/✕/click-out) holding UsageGlance.
  - **Header**: brand + fold, borderless.
  - **Window minimize QoL** (owner ask): floating windows now have a dedicated
    "—" header button → straight to the tray, no ⋯ menu digging (`onMinimize`
    prop on PaneCard).
  - NOT yet touched: OracleRoster / ScheduledAgentsSection internals, icon-rail
    density pass, more eye candy — iterate on owner feedback.
- [~] W1.6b sidebar round 2 (owner: liked the design; fix collapsed rail, usage as
  flyout, redesign remaining sections, remove scrollbar):
  - **Scrollbar hidden** on the sidebar scroll column.
  - **Usage → anchored POPOVER**: flies out beside the trigger (fixed at the
    button's rect, no backdrop, no focus theft); Esc / click-away / ✕ close.
  - **Collapsed rail cleaned up**: space headers shrink to slim hairlines (still
    clickable to fold — accent-tinted when folded); actions cluster loses its
    pill chrome (plain column); pin-a-site / new-space icons sized up to match.
  - **Sections harmonized to the chip language**: AGENTS/hidden/reattach/other
    headers now the same font-mono 0.18em section style; spawn-an-oracle row
    rebuilt as icon-chip row (hover nudge + accent chip); OracleRoster +
    ScheduledAgentsSection icon-rail blocks use soft hairlines (no border-t);
    templates card = soft tinted panel (no dashed border); new-space row gets
    the hover wash.
  - Still open for round 3: OracleRow/TmuxRow/AgentRow internals, create-form
    fields, notification list styling.
  - **Row internals DONE (2026-07-04)**: OracleRow/TmuxRow/AgentRow rebuilt in
    the chip language — 8×8 icon chip (status/health dot or Terminal icon
    INSIDE the chip, warms to accent-soft on hover), 12.5px title + 10px mono
    faint subtitle, hover nudge (`translate-x-0.5` + panel wash), actions =
    hover-revealed h-6 ghost cluster. AgentRow's stray right-side cadence
    metric folded into the subtitle (`daily · <job>`); state pill went
    rounded-full glass. Rename modes = accent-chip (Pencil) + inline input.
    Both create forms (oracle + scheduled agent) = glass cards
    (rounded-xl, accent/35 border, blur; inputs on bg-70% with accent
    focus ring; `press` accent submit). Behavior untouched. Notification
    list styling still open.
- [~] W1.6c round 3 fixes (owner's screenshots):
  - **Icon rail root cause**: SidebarRow's drag grip + ⋯ menu button rendered in
    icons mode (the ⋯ absolutely positioned over the icon) — both are now
    full-mode only. Row/space menus switched from translucent glass to solid
    `--color-panel` (text bled through the blur).
  - **AGENTS header aligned** with TOOLS/PINNED: same pl-1.5 inset on the
    section header and all subheaders (hidden/reattach/other sessions).
  - **Double "USAGE" fixed**: UsageGlance got a `bare` prop (no inner heading /
    border) — the popover header is now the only title.
  - **Chat hero slimmed** (owner: "remove this from the chat"): starter deck
    (explore/plan/fix/discover) + "pick up where you left off" resume rail
    removed from ChatPane's empty state — the home lock screen owns discovery;
    the hero is greeting + composer only. (STARTER_DECK + deck-hints code
    removed; MapIcon kept for plan-mode tool icons.)
- [~] W1.6d round 4 (owner's screenshots + asks):
  - **Icon sizes standardized**: rail secondary icons (fold, gauge, agents,
    actions cluster, scheduled) all 18 (spawn/terminal 16 in their 8×8 wells);
    tool icons stay 23 (owner liked them). Expanded chips uniform at 14.
  - **Header rename retired** (spaces are fold-toggles; menu = delete, custom
    spaces only). **Tool rows carry NO controls** — no grip, not draggable, no
    ⋯ menu; pinned links keep their menu (unpin/rename/icon/move) + drag.
    (Reorder/hide for tools still possible via Settings → sidebar.)
  - **Idle home usage cards removed** — the sidebar usage popover is the one
    usage surface.
  - **Lock-screen scroll-up dismiss**: firm wheel-up at the top slides the home
    away (mirrors the slide-down entrance).
- [ ] W-PHYSICS (owner wishlist, LATER): a small shared physics/motion engine
  (springs/inertia/drag momentum) reusable across surfaces — lock screen,
  window drags/snaps, strip, fx. Owner explicitly wants it as a general
  capability, not a one-off; design it standalone when it comes up.
- [~] W1.6e round 5 (owner):
  - **Idle home = ONE viewport**: the content column scale-transforms down to
    fit whenever its natural height exceeds the viewport (ResizeObserver
    re-fits live; overflow hidden while scaled, scrollable again at 1:1).
  - **Lock screen drag-to-open**: grab any empty spot, drag up past ~110px and
    release — the sheet follows the pointer live and the CSS transition
    finishes the slide from the dragged position; short drags spring back.
  - **Expanded sidebar scaled to the rail**: rows now use 8×8 icon chips with
    18px icons (matching the rail's secondary size), 13px labels; pin-a-site /
    new-space got chips too.
  - **"new chat" rail item hidden in windowed mode** (`hideAppIds` on
    SidebarRail) — the tab strip + home own new-chat.
- [~] W2 snap + dock gestures (2026-07-03 late; needs live smoke test):
  - **Snap zones with ghost preview**: while a header drag is armed, the layer
    hit-tests the pointer (engine `hitTestSnapZone`) and paints a translucent
    accent ghost where the window will land; zones = top strip → maximize,
    top band → top half, bottom edge → bottom half.
  - **Side edges DOCK**: left/right release turns the window into a
    full-height side panel that RESERVES canvas room — the chat canvas, the
    sidebar toggle, and the minimized tray all inset (animated) via
    `dockReservations` → `onDockChange` → App insets. Docked panels expose
    only their inner edge, which resizes the dock width (remembered per
    window, `dockW`).
  - **Un-parking**: dragging a snapped/docked window pulls it back out at its
    remembered floating size, centered under the pointer (Windows-style).
  - Snap/dock state persists (already in the W0 serializer).
  - Deliberately NOT done: the global Esc stack (menus/overlays each handle
    Esc today; revisit if stacking bugs appear) and rail minimize-badges (the
    canvas tray fills that role).
  - Also this round (owner): sidebar fold/open control moved OFF the sidebar
    onto the canvas top-left (stable position, rail-scale 8×8/18px; reopens a
    ⌘B-hidden sidebar too) and the brand/home chip upsized to match.
- [~] W2b window-chaos pass (owner: strip under windows, toggle felt detached,
  "windows on each side looks weird — you decide"):
  - **Stacking fixed at the root**: WindowLayer root is `isolate` — window
    z-counters (which grow with every raise) can no longer climb past canvas
    chrome; strip/handle/tray always win.
  - **Drawer handle**: the sidebar toggle is now a slim vertically-centered
    tab hugging the sidebar seam (rides a left-dock edge); reads as part of
    the sidebar, never strays.
  - **One-click ARRANGE** (top-right, shows with ≥2 visible windows): tiles
    all visible windows into an even grid (engine `gridArrange`, +2 tests),
    topmost window → top-left; un-parks snaps/docks.
  - **Glide transitions**: window geometry animates (300ms spring-ish curve)
    on every committed change — snap, dock, un-park, arrange, viewport
    re-clamp — while live drags stay 1:1 (transition suppressed mid-gesture).
    The interim "physics feel" until W-PHYSICS.
  - Canvas chrome (strip / handle / tray / arrange) hides while a pane is
    maximized (fixed z-40 escapes the isolated layer; immersive anyway).
- [ ] W3.5 per-pane tailored passes (owner queue, one pass per pane):
  - FilesPane top bar enhancement
  - ChatPane robustness/smoothness pass + **Odysseus-style thinking steps**
    (collapsible thinking card with live duration + token count — pairs with W4
    chat anatomy)
  - others (browser, editor, terminal) as flagged
- [~] W3 context menus — per-surface, use-case-specific (owner: "right-click on
  the shell ≠ right-click on a file"). Progress:
  - [x] **Drawer handle re-pinned** (owner: it floated with dock edges): now
    lives at SHELL level glued to the sidebar's own seam (position = sidebar
    width only), z-50 above everything, both workspace modes.
  - [x] **Pane ⋯ menu de-duplicated** (owner: header already has the buttons):
    Maximize/Close removed from the menu everywhere; Minimize/Hide item only
    remains in grid mode (no header minimize there). Per-type actions +
    Duplicate stay.
  - [x] **FilesPane per-entry menu** (the flagship): right-click a FILE →
    Open / Open in chat (routes path into the chat composer) / Open in
    terminal (cd to its folder) / Open in browser / Reveal in Finder~Explorer /
    Copy path. Right-click a FOLDER → Open terminal here / Send to chat / Set
    as workspace root / Open in new files pane / Reveal / Copy path. Rows
    stopPropagation so the generic pane menu doesn't double-fire.
  - [x] **Reveal-highlight fixed (Rust)**: Explorer only honours `/select,`
    with backslash paths — forward slashes silently degraded to folder-open.
    Now normalized + `raw_arg` quoting (spaces-safe); macOS `open -R` already
    selected. VSCode-style highlight works.
  - [x] **PaneMenu inline submenus** (`children` on actions): parent row
    expands indented child rows (chevron, Enter toggles, re-clamps position).
  - [x] **"Open in chat" picker**: with >1 open conversation the files menu
    expands a submenu of chat titles; picking one routes the path into THAT
    chat's composer and surfaces it on the canvas (`routeToChatTarget`;
    single chat routes straight in).
  - [x] **Terminal surface menu** (TerminalRuntime owns it; PaneCard already
    leaves .xterm alone): Copy selection (disabled without one) / Paste
    (image-aware, bracketed) / Select all / Compose message / Clear terminal.
  - [x] **Chat message menus**: user bubble right-click → Copy message / Edit
    & resend (rewinds) / Regenerate (last turn) / Retry with another model
    (submenu of the live model list, current marked). Assistant right-click →
    Copy response (source markdown) / Pin~Unpin. Both skip when text is
    selected (native copy wins) and while streaming; fences take precedence.
  - [x] **Code-fence menu**: Copy code / Run in terminal (shell fences; multi-
    line = copied + terminal opens, same contract as the header button).
  - [x] **History row menu**: Open conversation / Star~Unstar / Export
    markdown / Move to trash — the row hover actions at the pointer.
  - [x] PaneMenu hardening for the above: tall menus scroll (`max-h-[70vh]`).
  - [ ] Editor tab/body (Monaco has its own — only ADD app-level items:
    reveal, open in terminal), browser pane (back/reload/copy URL/open
    externally), notes rows. Low-stakes leftovers for a polish pass.
- [~] W4 chat pass, first slice (owner batch):
  - **Odysseus thinking card shipped**: framed collapsible card, Brain +
    shimmer while live, header stats `duration · ~N tok` (live 1s tick while
    streaming, final duration after), scroll-capped thought well. Replaces the
    plain "thought for Xs" row.
  - **Transcript = 80% of the pane** (owner ask): `.chat-col` fixed-rem column
    → 80%.
  - **Composer sleekness pass**: control pills tightened (11px, ghost-quiet at
    rest, border only on hover), control bar = ONE silent-scrolling row (no
    more bulky wrapping), input tightened to 13.5px. Full from-scratch
    composer redesign still open if this pass isn't enough.
  - **Agent swarm polish**: FleetView got a swarm header (`agent swarm ·
    N running · N done · N failed`), live cards glow + run an indeterminate
    accent sweep along their top edge, finished cards recede, staggered
    arrival.
  - **Split slice 2 DONE (2026-07-04)**: the whole markdown chain
    (`splitFences`, `Markdown`, `CodeBlock` incl. run-in-terminal + fence menu,
    `MarkdownBlocks`, interactive `Checklist`, `Inline`) moved verbatim to
    `chat/Markdown.tsx` (581 lines), and the render contexts
    (ChatCwd/ChatSubmit/ChatFileOpen + hooks) to `chat/context.ts`. ChatPane:
    10,162 → 9,569 lines, provides the contexts, imports `Markdown`. Only
    `Markdown` is exported — the chain is module-private. Next slices:
    Bubbles (User/Assistant — now unblocked, Markdown moved), then Composer,
    then overlays.
  - **Split slice 3 DONE (2026-07-04)**: the transcript bubble family moved
    verbatim to `chat/Bubbles.tsx` — `TurnFrame` (framed assistant turn card),
    `UserBubble` (hover actions, retry-model portal menu, attachments +
    lightbox, W3 context menu), `AssistantBubble` (`[[btn:]]` pills, pin, W3
    menu), plus the furniture: `WorkingLine`, `ResultFooter`, `DaySeparator`
    (private helpers `dayLabel`/`turnClock`/`parseButtons` ride along).
    `fmtClock` promoted to `chat/format.ts` (ActivityGroup, which stays,
    also uses it). ChatPane: 9,569 → 8,931 lines; PaneMenu import dropped
    (no direct use left). tsc 0 · 260/260 · build clean. Next: Composer
    (the big one; move CTRL_PILL* with it), then overlays.
  - **COMPOSER REDESIGN BUILT (2026-07-04, sketch board rev 4 — needs live
    smoke)**: the deck shipped in place (ChatPane) + new chrome modules
    `chat/composer/deck.tsx` (Filament / SendOrb / EffortTicks / ArmedStrip /
    engineDotColor) and `chat/composer/ModelMenu.tsx`. What changed:
    (A) context FILAMENT on the deck's top edge = the ctx meter (fills, warms
    past 80%, sweeps while streaming; hover = the Context Window card) — the
    stats-row ctx chip REMOVED; (B) effort pill retired → 5 tick bars inside
    the model pill + a segmented control at the top of the model menu (ultra
    = gradient ticks); (C) access + context-budget pills merged behind a
    SHIELD icon menu (check=bypass · half=accept-edits · outline=ask ·
    cyan=plan; budget = segmented row, ultracode keeps the effort coupling);
    (D) "● working · 0:42" chip in the rail while a run is live (new
    workClock state); send/stop/steer cluster → morphing SEND ORB
    (hollow/lit/breathing-stop; steer/queue = quiet accent chip while
    running); plan-first + goal = icon toggles whose receipts are ARMED
    STRIPS inside the deck (summary-chip row deleted); fresh hero = BARE rail
    (cwd·model·orb) blooming on first keystroke; streaming under-row carries
    the steer contract. MODEL MENU (M1+M3): short-by-default (recents via new
    settings.recentModels + one default per engine + "all models" drill-in),
    boxless TYPE-TO-DIG over the whole catalog (trace chip, ⏎ top match,
    ↑↓ nav), MANAGE mode w/ eye toggles → settings.hiddenModels (also filters
    retry menus). Keyframes aios-fil-sheen/aios-orb-breathe in App.css.
    Magnet/HoverBorderGradient wrappers + CTRL_PILL_ULTRA dropped. /RESUME =
    the RAIL LEDGER (chat/overlays.tsx rebuilt): gradient time rail + engine
    dots, one-line resting rows, active row blooms into the card w/ preview +
    resume chip, kbd foot. ⌘K = CONSOLE OMNIBAR (CommandPalette.tsx): pill
    bar w/ mono ❯ prompt, SCOPE TABS (all·open·resume·workspaces·run — tab
    cycles, scope filters before ranking), detached results card, ask-AIOS
    HERO row pinned top, numbered rows + ⌥1–9 jump-run, filament bottom edge;
    fuzzy/MRU/verb-mode/live-preview/preview-strip/morph all preserved.
    tsc 0 · 260/260 · build clean. Known follow-ups: Settings→models
    visibility card (menu manage-mode is the only surface for now), est-tok
    ledger row kept (owner may nix), Escape in the model menu closes rather
    than clear-filter-first (Dropdown owns document-level Escape).
  - **Deck live-smoke fixes (2026-07-04, owner screenshots)**: BorderBeam
    REMOVED from the deck (its beam path was a rectangle ignoring the rounded
    corners — the filament is the living edge now); ImagePreview lightbox
    mounted in the HERO branch too (attach-preview clicks were dead there —
    only the docked branch mounted it); wrench tools menu REMOVED
    (attach/dictate are rail chips, /resume owns resume); /resume hover no
    longer expands rows (jumpy — hover washes, arrows expand, click resumes);
    ResumePicker gained document-level outside-click + Escape close (the old
    Esc only worked with the search focused); hero container overflow-hidden
    (owner rule: ONLY content bubbles scroll) — an open overlay shifts the
    hero up 16vh, morphs the title to "what should we resume?", hides the
    kbd-hint row, and the picker body caps at min(20rem,42vh) so everything
    fits one viewport.
  - **Split slice 4 DONE (2026-07-04) — overlays + interaction cards** (the
    Composer itself was RE-SCOPED: it's a ~930-line useMemo closing over 55
    ChatPane state values — extracting it is a rewrite with a 50-prop bag,
    not a verbatim move; deferred until/unless the ground-up composer
    redesign happens, where a real component boundary can be designed in).
    Moved verbatim instead: `chat/InteractionCards.tsx` (AskQuestionCard +
    PlanProposalCard + ApprovalCard + the parsers parseAskQuestions/
    parsePlanProposal + AskQuestion/PlanProposal types — ChatPane's
    is-interactive-tool guards import the parsers back) and
    `chat/overlays.tsx` (Dropdown, MenuItem, OverlayPanel, OverlayRow,
    SlashCommand type, ResumePicker + ResumeRow + engineColorVar +
    fmtRelativeTime, ResumedNote, CwdPicker + parentDir, GoalEditorOverlay,
    ImagePreview + ImageChip type — ChatPane imports the types).
    `baseName`/`ellipsizeMid` promoted to `chat/format.ts` (toolTarget/
    artifact code in ChatPane shares them). ChatPane: 8,931 → 7,536 lines
    (10,162 at split start). tsc 0 · 260/260 · build clean. Remaining
    monolith: composer memo + transcript render loop + handlers — all
    genuinely stateful; further slicing needs design, not moves.
  - **ChatPane componentization STARTED** (owner ask — 10k-line file):
    `chat/format.ts` (fmtDuration/estTokens) + `chat/ThinkingBlock.tsx`
    (ThinkingBlock + CadencedShimmer) extracted; ChatPane imports them. Next
    slices, in dependency order: chat/Markdown.tsx (Markdown, CodeBlock,
    MarkdownBlocks, Checklist, splitFences — mind useChatCwd context),
    chat/Bubbles.tsx (UserBubble, AssistantBubble — needs Markdown moved
    first), chat/Composer.tsx (the big one; move CTRL_PILL* with it),
    chat/overlays (resume/history/goal). One slice per session, tsc+tests
    between each.
  - Still open for W4 round 2: provider→model route header on replies, tok/s
    + ctx% reply footer with Context Window popover (best with BYOK P1 usage
    data), session cost in strip.
- [~] W4 slice 3 (round 2 anatomy + lip merge):
  - **Lip merged into the sidebar** (owner: stuck out like a sore thumb): the
    fold handle is now a quiet gutter PIP — same visual language as the grid
    gutters — a slim bar that warms/grows on hover with the chevron fading in
    over it; hidden-sidebar opener matches at the screen edge.
  - **tok/s in the reply footer** (Odysseus signature): appended to the
    `duration · N tok` line when the turn ran >400ms.
  - **Context Window popover**: hovering the `NNK · NN% ctx` chip opens the
    Odysseus-style card — used/total gradient bar, model id, per-turn 5h burn.
  - **Session cost in the status row** — API-tier engines only ($ stays off
    claude/codex/opencode subs per the long-standing decision; BYOK/openrouter
    money is real).
  - W4 remaining: provider→model route header (reply header already shows
    AIOS · MODEL; upgrade when BYOK routing lands), session cost in the tab
    strip, composer ground-up redesign (owner-open).
- [~] W4 slice 2 (owner's live-test batch):
  - **SUB-AGENT LEAK FIXED (real bug)**: fan-outs rendered the Task prompt as
    giant "YOU" bubbles and sub-agent prose as main-transcript replies —
    `parent_tool_use_id` events now stay in the sub-agent on all three paths
    (live assistant text/thinking, live user echo, replay user echo); only
    nested tool turns + the Task's own result surface. Regression test added
    (259 total). The fleet strip + Agent rows are now the only fan-out UI, as
    designed.
  - **Handle animation sync**: the fold handle now lives INSIDE the aside on
    its right edge, so it physically rides the width transition (owner: the
    lip lagged the sidebar). Hidden-sidebar opener stays at the screen edge.
  - **Composer overflow fixed**: the pills row scrolls on the LEFT only; the
    model+tools+send cluster sits outside the scroller (long model ids like
    `nvidia/nemotron…:free` were plowing over send); model label truncates at
    150px.
  - **Empty hero centered** (owner: "so high up, feels empty"): vertically
    centered, max-w-3xl. Full composer-from-scratch redesign still owner-open.
  - **Steps → card family**: activity groups ("N steps / Worked for Xs") are
    now framed cards matching the thinking card — icon header, stats + chevron
    right-aligned, children in a bordered well, live accent border; replay
    button rides the header.
  - **Thinking in new chats** (owner question): not a bug — thinking cards
    render live whenever the model emits thinking; claude-code decides based
    on `--effort` (the composer's effort pill, wired through chat.rs). medium
    often skips thinking on trivial prompts; set high/max to see the card.
- [x] W5 density + canvas + default flip (2026-07-04):
  - **Thin scrollbars**: the glassy webkit thumb went 10px → 8px app-wide.
  - **Terminal density**: a third density level (comfortable · compact ·
    terminal) — compact's spacing PLUS the whole UI set in the mono stack
    (`html[data-density="terminal"]` re-points --font-sans at --font-mono;
    code surfaces unchanged). appearance.ts owns the type + boot apply.
  - **Ambient canvas art**: the hero's aurora drift blobs now also live on
    the docked transcript ground (whisper-faint, -z-10, drift dies under
    reduce-motion) — the "background art layer" reinterpreted for the
    chat-as-canvas world, where the canvas is never bare.
  - **Windowed workspace = DEFAULT** (beta tag dropped): settings default
    flipped true; the grid remains the OFF state of the same toggle.
  - Also: the composer-flash Settings copy updated for the redesigned levels
    (the old text still promised the retired rotating rim).

- [x] W6 — windowed is THE workspace (2026-07-04): the Settings toggle +
  `settings.windowedWorkspace` are GONE; on desktop `windowedWorkspace` is now
  derived (`!compactWebLayout`) so the floating-window canvas is structural,
  not a preference. Compact/mobile web remains the only surface running the
  stacked-grid path (ResizableGrid / OpenPanesList / IdleDashboard live on for
  it); the desktop grid is unreachable. Further discards (deleting grid-only
  affordances outright) happen opportunistically as the per-pane pass touches
  each file.

## W7 — the per-pane pass (owner: "start from the top to bottom")

Order = the sidebar's tools, top to bottom, then the window-only panes. One
pane per session; each gets the deck treatment: Neon Glass chrome, chip
language, context menus verified, density-aware, no dead affordances.

- [x] 1. TerminalPane (2026-07-04, six rounds, owner-closed):
  - COMPOSER → the deck language: one glass box + input stage + single rail.
    Left rail = repo/cwd chip (the old footer line, promoted) · live SHIELD
    (claude's parsed permission mode; click = Shift+Tab cycle; icon form
    matches the chat deck) · plan toggle (lit when claude reports plan mode).
    Right rail = attach chip (the "+" menu retired — direct file pick) · mic ·
    interrupt (^C, icon chip) · model pill (live parsed model, /model picker) ·
    close · the morphing SendOrb. claude's parsed "context used" runs the
    FILAMENT on the deck's top edge; <=15% left shows a red mono warning.
  - HUD chip strip (shell/cwd/status row) DELETED — window title carries
    identity, the rail carries cwd, exited has its overlay. More rows for
    the actual terminal.
  - CONTEXT MENU: "Clear terminal" actually clears now (owner-reported dead:
    term.clear() alone got repainted by the shell/tmux) — sends ^L (the real
    clear keystroke PSReadLine/readline/tmux honor) then drops xterm's
    scrollback; an "Interrupt (^C)" entry rides along.
  - ADDON refactors: shellQuotePath promoted to lib/platform (the composer's
    local copy was POSIX-only and mis-quoted every Windows path — real bug);
    OverlayPanel/OverlayRow deduped (imported from chat/overlays); the local
    waveform keyframe dropped for the global aios-wave.
  - ROUND 6 — live cwd, the robust way (owner: "open files here" wrong +
    stale): oh-my-posh broke the "PS C:\..>" prompt parse (restyled AND
    abbreviated path). Fix: the OMP theme now sets `"pwd": "osc99"` → the
    shell emits OSC 9;9;<full-path> invisibly at every prompt; the runtime
    parses that from the RAW stream (OSC 7 file:// handled too; the plain PS
    prompt stays as the no-OMP fallback). Existing OMP shells pick the theme
    change up at their next prompt (config is read per-render). CAVEAT: if
    psmux swallows inner OSC 9;9 instead of passing it through, the cwd
    won't update — quick live check; fallback would be psmux passthrough.
  - ROUND 7 — live cwd, PROBED + FIXED for real: headless psmux probes
    proved BOTH prior theories dead — psmux swallows the inner shell's OSC
    9;9 (repaints its own screen), and its #{pane_current_path} is FROZEN at
    the spawn cwd. Working mechanism = the AIOS CWD BEACON: psmux injects
    PSMUX_SESSION into inner shells; the PowerShell profile wraps the prompt
    to write $PWD to ~/.aios/state/cwd/<PSMUX_SESSION>.txt every prompt;
    TerminalRuntime polls it every 2.5s (shell = aios-term-<key-slug>,
    oracle = aios-<identity>, tmux = the session name). Verified end-to-end
    headlessly: cd in a probe session → beacon file shows the new path.
  - W7.1 CLOSED (owner: "should be okay for now").
- [x] 2. NotesPane — promoted to its own epic and CLOSED 2026-07-04 (owner:
  "please finish up on the notes"). The pane is now a NATIVE client of Stone
  & Chisel (the owner's Next.js+Neon notes app; PAT auth via "Connected
  apps"): three-zone mini app w/ write/split/read viewer (chat's Markdown
  renderer), diff3 conflict merge, offline outbox w/ local drafts, control
  `notes.*` verbs + chat/terminal capture, ~/.aios/notes retired. Full
  record: `misc/PLAN-notes-stone-chisel.md`. Next pane on this board: 3.
  FilesPane (top bar queued).
  - ROUND 5 — right-click = paste (owner; frontend-only):
    - the in-pane right-click now PASTES (Windows-terminal convention) via
      our image-aware pasteClipboard — a copied screenshot lands as a
      vision-ready temp path. The capture shield still starves xterm/psmux
      of the right button, so nothing double-pastes.
    - the terminal's OWN context menu deleted; its actions (copy selection /
      paste / select all / open files here / interrupt / clear) moved to the
      window shell's ⋯ menu via the NEW `paneBus.paneMenuExtras` registry —
      any pane content can now contribute entries to its shell menu (getter
      form, so disabled-ness is live at menu-open). App.tsx buildMenuItems
      merges them ahead of "Duplicate pane".
  - ROUND 4 — oh-my-posh (owner: "install ohmyposh then use that"; xterm.js
    stays — it IS VS Code's terminal component, there's no webview
    alternative; OMP is a PROMPT engine, integrated at the shell level):
    - ctx-menu "Clear terminal" now AUTO-RUNS `clear` (^C → clear
 → xterm
      scrollback drop). Control-byte tricks were the dead end: the owner's
      PSReadLine renders unbound control bytes as literal ^X text
      (screenshot-verified with ^U).
    - MACHINE SETUP (done on the owner's box): oh-my-posh 29.18 via winget
      (MSIX → WindowsApps alias; no POSH_THEMES_PATH), CaskaydiaCove Nerd
      Font (36 faces, user-level), PowerShell profile CREATED (OneDrive
      Documents\WindowsPowerShell) with a guarded init pinned to
      ~/.aios/omp/catppuccin_mocha.omp.json — fresh-shell verified.
    - xterm FONT_FAMILY leads with the Nerd Font names (glyphs render).
    - psmux: winget install from June 16, no upgrade published — current.
    - CAVEATS: persistent psmux sessions keep their already-running shells —
      only NEW terminals show the OMP prompt (`. $PROFILE` refreshes an old
      one); restart the app so WebView2 picks up the freshly installed font.
  - ROUND 3 (owner live feedback — Rust rebuild needed again):
    - MOUSE back ON: copy-mode IS tmux/psmux's scrollback — `mouse off`
      killed the wheel outright (owner-verified). The [copy mode] badge is
      the honest price of scrolling; kept.
    - RIGHT-CLICK PASTE actually killed: it persisted with mouse off, so it
      was never (just) mouse reporting. Fix: a capture-phase shield on the
      host stops every right-button mousedown/mouseup/pointerdown/pointerup
      + contextmenu before xterm sees them — xterm can't report to psmux,
      can't word-select, can't relocate its textarea. Right-click = our menu,
      nothing else. rightClickSelectsWord off for honesty.
    - BOTTOM GAP root cause take 2: .xterm only spans the FITTED GRID, not
      the pane — painting the frost there left a lighter band under the last
      row (gap = pane height % cell height → "changes when I resize"). The
      frost now paints on the HOST div (full pane); .xterm keeps only the
      fit-visible padding.
    - COMPOSER REMOVED COMPLETELY (owner): TerminalComposer.tsx deleted,
      context-menu entry gone, composer plumbing stripped (append-ref,
      register, sendEscape, claude-status STATE — the ref-based parse stays
      for the pet-usage signal). paneSubmitters/composerSend survive: notes
      "send to AI" still pastes+runs into the terminal.
  - ROUND 2 (owner live feedback, same day — needs Rust rebuild + live look):
    - MOUSE OFF flipped everywhere (apply_mux_style + all three Unix attach
      strings): kills copy-mode-on-scroll AND right-click-pastes-into-psmux
      (both were mouse-reporting side effects; right-click now only opens our
      menu). VERIFY LIVE: wheel scrolling in psmux panes must still feel
      right via xterm's buffer — if broken, revert `mouse off` → `on`.
    - YELLOW-STRIP bug fixed two ways: the Windows styling `set`s raced the
      psmux server warm-up and failed quietly (first pane after boot showed
      the default olive bar) → apply_mux_style now re-applies after 900ms;
      and the two Unix attach paths only set PARTIAL styling (no colors) →
      full Neon Glass status style everywhere.
    - COMPOSER default-CLOSED for every pane kind (owner: no need day-to-day;
      right-click → "Compose message" opens it for long prompts).
    - LIVE CWD: the shell's real folder parsed from the last PowerShell
      prompt in the stream ("PS C:\...>") → context menu "Open files here"
      + composer repo chip track cd, not the frozen spawn cwd.
    - Floating files/compose buttons DELETED (overlapped the first shell
      lines) — the context menu owns both. HUD corner brackets + inset ring
      DELETED (window chrome frames the pane already).
    - BOTTOM GAP fixed: padding moved to .xterm (the one place FitAddon
      subtracts it — the old .xterm-screen padding was invisible to fit) and
      the frost color moved from the xterm THEME bg onto the .xterm element,
      so padding + grid + sub-row remainder are one uniform surface to the
      pane's bottom edge at every size.
- [x] 2. NotesPane (CLOSED 2026-07-04 — the Stone & Chisel epic; see the
  detailed entry above + misc/PLAN-notes-stone-chisel.md)
- [x] 3. FilesPane (2026-07-05, owner: "the top bar, the file preview all
  those… then also more QOL things"; verified 294/294 · tsc 0 · build ·
  cargo 0; needs a RUST restart — new fs commands + `trash` crate):
  - TOP BAR rebuilt: back/forward root HISTORY (Alt+←/→; project picker,
    breadcrumbs, home, drops all go through navigateTo) · BREADCRUMBS with
    every ancestor one click away (long paths keep the last 3 segments, the
    head collapses into a "…" PaneMenu) · git chip rides the crumbs · right
    cluster slimmed to terminal / projects / refresh / ⋯ overflow (root
    new-file/new-folder, dotfiles + heavy-dirs + preview toggles, open
    selected in browser, collapse all, reveal root, copy root path). The
    old 8-icon soup and the click-name-to-go-up oddity are gone.
  - FILE OPS (the pane finally has them): Rust `fs_create_file` /
    `fs_create_dir` / `fs_rename` (all refuse to overwrite) / `fs_trash`
    (NEW `trash` crate — Recycle Bin/Trash, recoverable, dirs included);
    `write_text_file` now create_dir_all's parents. Inline VS Code-style
    name editor row (Enter commits, Esc cancels, blur commits non-empty;
    rename pre-selects the stem); context menus grew New file/folder inside
    (dirs) + Rename (F2) + Delete; op errors surface in a dismissable strip.
  - KEYBOARD: tree is focusable — ↑/↓ walk visible rows (scroll-into-view
    via data-path), → expands / ← collapses-or-jumps-to-parent, Enter
    opens, F2 renames, Delete trashes, Alt+←/→ history.
  - PREVIEW upgrades: markdown renders via the chat Markdown renderer
    (rendered ↔ raw header toggle) · video plays inline (asset protocol) ·
    office docs get a convert-&-preview button (LibreOffice → pdf iframe) ·
    copy-contents button for text · existing image/pdf/code paths kept.
  - QOL: window-focus auto-refresh (5s throttle) so external file changes
    show up without touching the refresh button.
  - PARKED: in-tree drag-to-move (drop a row onto a folder = fs_rename) —
    needs a drop-target protocol on rows; revisit with the windowing drag
    work.
  - ROUND 2 (owner screenshots; frontend-only): PROJECT PICKER rebuilt as a
    solid PaneMenu (the old surface-pop absolute dropdown GHOSTED transparent
    over the preview — it predated the solid-menu rule; items render from
    live state so the list fills in as the scan lands; "unknown" kind hints
    hidden). PREVIEW DISMISS is now PER FILE (owner): the X hides this
    preview only, the next file click previews again — the persistent
    panel-off toggle stays in ⋯ (the old X wrote PREVIEW_KEY=off, killing
    previews forever). NEW top-bar CHAT button (MessageSquareText): sends
    focusDir to the active chat, multi-chat → PaneMenu target picker —
    parity with "open terminal here". FILTER RAIL refreshed to deck
    language: inset rounded search field w/ clear-X + "junk" pill toggle
    (accent-lit when heavy dirs shown). PREVIEW redesigned per the owner's
    blue mockup: inset rounded glass card (p-2 gutter, tree drops its
    border-r, 45/55 split), header = icon chip · name · kind/size/git · copy
    · X, code view NO LONGER SOFT-WRAPS (horizontal scroll, sticky
    line-number gutter — CSV columns stay columns), footer tightened. Top
    bar buttons unified on one 6×6 hover style (TOP_BTN).
  - ROUND 3 (owner screenshot): the sticky line-number gutter's opaque
    backdrop read as a black strip against the glass panel — gutter is now
    transparent like the body with a hairline border-r divider (sticky
    dropped; it only existed to hide text sliding under the numbers).
- [x] 4. BrowserPane — CLOSED 2026-07-05 (owner: "yea, its okay now" after
  round 2). ROUND 1 SHIPPED 2026-07-05 (chrome-only; frontend
  reload): ALL SIX toolbar dropdowns unified on one SOLID panel style
  (module const DROP — rounded-xl, border-strong, panel-2, shadow-pop, NO
  backdrop-filter): url autocomplete + bookmarks + downloads still ran the
  surface-pop glass class (the same WebView2 square-blur family as the
  files ghost dropdown), send-to-chat/profile/options were ad-hoc
  rounded-md+shadow-lg. Bookmarks trigger icon Globe→Bookmark (Globe read
  as "web", aliased BookmarkIcon — `Bookmark` type name collision with
  lib/browser). URL bar + find bar inputs moved to the house inset style
  (rounded-lg, bg/70, accent focus, transition). NavBtn/MenuItem were
  already on-language.
  ROUND 2 (owner: ghosting while moving + dropdowns open but unclickable +
  visible gaps; verified 294/294 · build clean; frontend-only):
  - DEAD DROPDOWNS root-caused: the toolbar row has backdrop-filter (a
    stacking context) but was NOT positioned → the whole context, z-[70]
    menus included, painted in the IN-FLOW layer BELOW the positioned slot
    content that follows in the DOM. Menus showed through the transparent
    slot but every click hit the slot. Fix = `relative z-20` on the toolbar
    row (load-bearing comment left in place). Pre-dated round 1 — likely
    broken since the toolbar got its Neon Glass blur.
  - GHOSTING/GAPS: the webview's only position-tracking was a 300ms poll
    (ResizeObserver sees size, not position — floating-window drags mutate
    style directly). Fixes: (a) NEW paneBus setWindowGesture/onWindowGesture
    — FloatingWindow broadcasts while a move gesture is armed; BrowserPane
    hides the webview for the drag (same trick as the path-drag hide) and
    re-shows 340ms after release so the 300ms snap glide finishes first —
    the page pops back once, in place; (b) the 300ms poll replaced with a
    CHANGE-DETECTED rAF follow loop (idle frames = one getBoundingClientRect,
    zero IPC) so dock-reserve/arrange/glide animations track per-frame; 1s
    interval kept as a throttled-rAF backstop. NOTE: AppCastPane likely
    wants the same onWindowGesture treatment — check at its slice (11).
  NEXT ROUNDS: owner re-test (drag + every dropdown); candidates = toolbar
  density/grouping, suggestion-row polish, error/empty states, device-mode
  bar, per-pane zoom chip.
- [x] 5. HistoryPane (2026-07-05; light pass — the pane was already
  on-language from the ChatPane-history epic; 294/294 · build clean;
  frontend-only): "Clean up ▾" converted from the LAST in-pane surface-pop
  dropdown to a solid PaneMenu ("Older than N months" entries + disabled
  "starred are kept" footer; the old fixed-backdrop + stacking-trap dance
  deleted); search row moved to the house inset field (rounded-lg, bg/70,
  icon inside, clear-X, honest placeholder "search titles + message
  content"). Remaining surface-pop dropdown-under-content case app-wide =
  AppCastPane only (its slice, 11). Candidates if the owner wants a round
  2: trash-row context menu, keyboard walk (↑/↓/⏎), per-group collapse.
- [x] 6. ProjectsPane (2026-07-05; AUDITED, no changes needed): the pane is a
  thin shell over Settings' ProjectsSection/WorkspaceCard — all built fresh
  in the Workspaces epic on the Settings design system (Card/Row/Toggle/
  MetaChip/ICON_BTN/FIELD). No surface-pop, no stacking traps, no dead
  affordances found. Deliberately untouched — churn for its own sake is how
  regressions happen.
- [x] 7. EditorPane (2026-07-05; 294/294 · build clean; frontend-only): the
  internals were already excellent (URI-keyed shared models, LSP pill,
  mtime conflict guard w/ keep-mine/take-disk/diff overlay, external-change
  auto-revert watcher, skeleton load, drop-to-open) — the pass added the W7
  chrome language it was missing:
  - ⋯-MENU contributions via paneMenuExtras (parity with terminal/notes):
    Save (⌘S hint, disabled when clean — getter form) · Format document
    (Monaco's built-in action) · word-wrap toggle · minimap toggle · sep ·
    Copy path · Reveal in Finder/Explorer · Open terminal here (cd to the
    file's folder).
  - HEADER: live Ln:Col caret readout (tabular-nums) + a language chip
    (languageForPath) ahead of the LSP pill.
- [x] 8. FileViewerPane (2026-07-05; 294/294 · build clean; frontend-only):
  - MARKDOWN now renders through the HOUSE renderer (chat/Markdown — the
    third consumer after notes reader + files preview): the pane's private
    MarkdownDoc/InlineDoc duplicate (~85 lines, no bold/fences/tables)
    DELETED. Its one superpower kept: relative `[x](./other.md)` links
    resolve against the DOC's folder via a ChatFileOpenContext provider
    (the renderer's default resolves against cwd).
  - HEADER: kind · size meta chip beside the external-open button.
  - ⋯-MENU contributions (parity): Copy path · Reveal · Open terminal here
    · Open externally.
  ROUND 2 (owner screenshots: "# labels not rendered", viewer/editor
  confusion, files "open in editor" opens the viewer; 294/294 · build clean;
  frontend-only):
  - CRLF BUG root-caused with a node repro against the real README bytes:
    JS `.` and `$` both EXCLUDE \r, so on a CRLF file every `(.*)$`-anchored
    block match in chat/Markdown (headings/lists/quotes) fails while inline
    bold/code (no `$`) works — literal "#" in every file-sourced preview.
    Fix: `text.replace(/\r\n?/g, "\n")` at the Markdown entry (load-bearing
    comment) — heals chat/notes/files-preview/viewer in one place.
  - ROUTING: FilesPane's preview "open in editor" called the AUTO router,
    and md/pdf/… are VIEWER_EXT → it opened the viewer. Now forces
    openEditorFileInPane (falls back to auto if unregistered).
  - MODE IDENTITY: pane headers carry an unmissable chip — cyan "viewer"
    (read-only) vs accent "editor" (⌘S saves) — plus CROSS-JUMPS only (the
    owner's anti-confusion rule): viewer header PenLine → open in editor +
    ⋯ "Open in editor · source"; editor gets ⋯ "Open in viewer" (+ an Eye
    header button on md files → rendered preview). Neither menu names the
    mode you're already in.
  Remaining on the pane list: 9 ScheduledAgents (fresh from its own
  Phase 1–3 work — likely audit-only) · 10 Plugins+Pulse · 11 Appcast
  (carries the LAST surface-pop dropdown + needs onWindowGesture).
- [x] 9. ScheduledAgentsPane (2026-07-05; AUDITED, no changes — fresh from
  its own Phase 1–3 rework, fully on-language: PaneEmpty, token health
  colors, steer-all composer).
- [x] 10. PluginsPane · PulsePane (2026-07-05; AUDITED, no changes — both
  token-styled with real error/empty states; Pulse reuses the IdleDashboard
  Ring/heatmap primitives).
- [x] 11. AppCastPane (2026-07-05; 294/294 · build clean; frontend-only) —
  the full BrowserPane treatment: picker dropdown surface-pop → SOLID panel
  (last menu-under-content ghost in the app, gone); toolbar row `relative
  z-20` (same load-bearing stacking fix as the browser — the picker would
  render but never take clicks over the mirror slot); onWindowGesture hide
  (340ms re-show past the snap glide) + CHANGE-DETECTED rAF follow loop
  replacing the 300ms poll (1s backstop) — no more mirror ghosting on drag.

**W7 PANE PASS COMPLETE (1–11).** Same-day extras (owner):
- NOTIFICATIONS pane: dead dashed empty box → a real empty state (bell
  badge, "all quiet", what-lands-here hint).
- MISSION CONTROL overview: cards gained a paneCardMeta line — WHAT each
  pane is on (browser url, files root, editor filename, chat model/resume
  title, tmux session, oracle identity, cwd fallback) instead of glyph-only.
- SETTINGS: pending owner specifics (recently reworked by several epics —
  needs their eye on WHAT feels off before a pass).
- PETS: full redo requested ("even more interesting and interactive") —
  concept directions offered to the owner before building (composer-deck
  rhythm); NOTE the bundleBoundaries pet test pins the current pet's
  internals and will need rewriting with whatever ships.

(Chat is the canvas and already had its pass — W4.)

### W1 implementation notes

- New: [FloatingWindow.tsx](../src/components/FloatingWindow.tsx) (chrome; gestures
  mutate style directly, commit on release — no pane re-render mid-drag),
  [WindowLayer.tsx](../src/components/WindowLayer.tsx) (WinState list, ResizeObserver
  viewport, persistence under `aios.windows.layout`, raise-on-focus).
- App.tsx: the grid's PaneCard prop bag extracted into `renderPaneCard(pane, over)`
  shared by both modes; windowed branch renders WindowLayer; PaneCard's header-drag
  (`onPaneDragStart`) becomes the window-move handle; `hiddenKeys` = minimize
  (state-preserving, restored from the existing dock bar); pane-maximize (fixed
  inset-0) works unchanged.
- Settings: `windowedWorkspace` (default OFF); compact/mobile always keeps the grid.

W1 known gaps (accepted for beta):
- Native-webview panes (browser/appcast) paint above HTML windows when overlapping —
  same limitation as pane-maximize; W2 should deactivate non-front webviews.
- No snap ghost / edge dock yet (W2). No per-named-workspace window layouts.
- Pane header tooltip still says "drag to rearrange" in windowed mode.
- Closing a pane in windowed mode skips the popLayout exit animation.
