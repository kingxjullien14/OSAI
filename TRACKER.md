# AIOS Polish Tracker — live status board

> **The single source of truth for this polish/enhancement effort.** Check items off here as they land (one commit per batch). Ground truth comes from the 2026-06-11 multi-agent audit ([audit-synthesis.json](audit-synthesis.json), 43 verified defects + roadmap scoreboard); design intent lives in [PLAN-superapp-uiux.md](PLAN-superapp-uiux.md) — its roadmap checkboxes are stale, trust THIS file.

Legend: `[x]` shipped (commit referenced) · `[~]` in progress · `[ ]` open

---

## Wave 1 — correctness & safety (broken things first)

### Shipped
- [x] **Git safety net** — repo re-initialized, baseline snapshot + audit artifact committed (`8dc2cfd`, `73c461e^`)
- [x] **Windows path correctness sweep** (`73c461e`) — new `src/lib/paths.ts` (separator-agnostic basename/dirname/join/normalize/toFileUrl + tests); fixed revealFile/finderRoot rooting at `/`, FileFinder basename-ranking + dir column + recents, FilesPane go-up/root-label/focusDir/git-decoration keys, BrowserPane file-drop URLs + download open/folder, App.tsx pane labels, drive-letter/UNC/space-containing paths now recognized as file targets
- [x] **Money-agents platform rebase + identity scrub** (`2c41346`) — runtime `home_dir` (no more `/Users/firazfhansurie`), paths derived at load + self-heal migration for legacy stored agents, logs under `~/.aios/logs`, forced-green `firaz` branch deleted, all persona seed/run copy neutralized, mirror rooms `firaz-*` → `aios-*`, two-click agent removal (no native `confirm()`), MoneyAgentsPane empty state, `--dangerously-skip-permissions` disclosed in OracleRoster
- [x] **Rust backend correctness** — Windows pty honors `cwd` ("open terminal here" actually opens there), `resolve_bin`/`opencode_bin` read `USERPROFILE` + scoop/npm/.exe/.cmd probes, ripgrep found on Windows (scoop/cargo/choco/PATH), every synthesized engine failure now carries `is_error:true` + the engine's message (codex `turn/failed`, non-retryable `error`, app-server death, opencode crash-vs-clean-exit via exit code)

### Shipped (cont.)
- [x] **Pane drag & drop fixes** (`bb94759`) — no more text selection during pane drags (suppressed + pointer captured); targets hit-tested via `elementFromPoint` so browser panes acquire; `pointercancel` ends stuck drags; swap targets show "release to swap panes" instead of the misleading path-drop overlay
- [x] **Files → terminal / chat drag-drop** (`bb94759`) — FilesPane rows start a pointer-based drag (HTML5 dnd is dead inside the Windows webview): folder → `cd` in terminal / re-root files pane, file → quoted path insert / chat context; cursor ghost chip, Escape cancels; terminal quoting now PowerShell-correct

### Open
- [ ] **Native-webview occlusion pass** — FileFinder/GlobalSearch/close-prompt/onboarding must hide native webviews (extend `overlayOpen`, App.tsx:632); BrowserPane address-bar autocomplete + toasts + annotate badge render under the webview; AppCast mirroring badge same
- [ ] **Chat failure-truth (frontend half)** — render `is_error` results as a danger card with the engine's message + working retry (not a faint success footer); claude error text read from the right field; retry/regenerate dead after startup failure + on resumed transcripts; user-stop must render as calm "stopped", not a red failure card
- [ ] **Empty-hero rescue** — gate telemetry chips + token ledger behind first keystroke (bloom in); Enter-during-startup must not tear the hero into a transcript; inline startup status/error line; anchor the hero (no re-center jumps); adopt `.hero-title`/`.helper-line`; platform-correct `⏎ send · ⇧⏎ newline` cue
- [ ] **Terminal correctness** — Ctrl+V paste / Ctrl+Shift+C copy on Windows (Ctrl+C stays SIGINT); exited-pane Enter-restart only when pane focused (today it hijacks Enter app-wide); Ctrl+S saves only the focused editor (today every editor pane saves); honor `terminalFontSize` in xterm + Monaco (the Settings slider is currently a no-op); pass cwd in the spawnShell fallback
- [ ] **Pane drag & drop fixes** *(user-reported)* — dragging a pane must not select text underneath (suppress `user-select` during drag); drag-to-swap degrades over browser panes (webviews eat pointer events) and paints the misleading "drop file" highlight for pane swaps; drags can get stuck without pointerup
- [ ] **Files → terminal / chat drag-drop** *(user-requested feature)* — drag a file/folder from FilesPane onto a terminal: folder → `cd` there, file → insert the (platform-correctly quoted) path at the prompt; drop onto chat composer → @-mention the path as context; make the drop affordances say what will happen
- [ ] **Cast/Attach Windows gating** — hide from pickers/palette on Windows (backends are macOS-only); honest "not available on windows yet" empty state instead of raw Rust errors; mirroring badge pulses (trust signal)
- [ ] **Safety batch** — NotesPane two-click delete confirm (today one un-confirmed click deletes from disk, no trash); Onboarding replay must not clobber a veteran's saved engine / wipe chatModel; one-time `flashLevel: lush → calm` migration for existing installs; PulsePane blank-state + PluginsPane error-vs-no-match states; NotesPane Ctrl+N hint lies (chord is globally new-terminal)
- [ ] **App-shell batch** — hardcoded `codex --model gpt-5.3-codex-spark --dangerously-bypass-approvals-and-sandbox` launcher → user's base model (App.tsx:1389 + apps.ts:68); seeded chat still titled "jarvis"; appshot dead chord on Windows (gate + fix "CtrlCtrl" label); hidden 20px window-drag strip eats first-row pane buttons; Mission Control backdrop-click close + real close button; collapsed sidebar leaves zero chrome (no palette/bell); `text-white` on accent fills → `--color-accent-fg`
- [ ] **Composer dropdowns** — Wrench/model menus need outside-click + Escape close, labeled trigger; defaultAi drifts from chatProvider when picking a model
- [ ] **Palette trust** — disabled commands look identical + silently no-op; danger flag never surfaced; matcher needs the cost cap; "not installed" models in picker should be visually distinct + explain why (see screenshot)
- [ ] **Whisper endpoint** — hardcoded localhost:9000, fails only AFTER recording; make it a setting + pre-flight check

## Wave 2 — pane polish & UI/UX convergence *(user: "all panes need polishing, UIUX improved by a lot")*

- [ ] **CSS substrate fixes first** — the un-layered global transition baseline silently kills Tailwind transition utilities app-wide (move into `@layer base`); `.press/.lift/.btn-glow` shorthand cancels the color easing (longhand transitions)
- [ ] **Design-system convergence, pane by pane** (adopt `.pane-header`, `.surface-pop`, `.pill`, `.status-dot`, tokens; kill hex/`text-white`/`shadow-2xl`/accent-as-decoration):
  - [ ] FilesPane (hex git colors → status tokens, accent folder glyphs → muted, project-picker `shadow-2xl`, "scanning…" forever state)
  - [ ] NotesPane (accent hovers, bespoke focus borders)
  - [ ] PluginsPane (accent MCP chips → `.pill` + status dots)
  - [ ] BridgesPane (accent header glyphs, `shadow-lg` toast, mac/tmux affordances gated)
  - [ ] MoneyAgentsPane (dual accent CTAs → one primary)
  - [ ] FileViewerPane + EditorPane (loading skeletons, header convergence)
  - [ ] PulsePane (real states)
  - [ ] BrowserPane + Cast/Attach/Mirror panes (menus onto `.surface-pop`, accent hover discipline, poll-refresh transitions)
- [ ] **Shared primitives** — `PaneEmpty`, `Skeleton`, `CopyButton`, toast; + a lint test banning `text-white`/`bg-black`/hex literals in components so it can't regress
- [ ] **Motion choreography** — pane mount/unmount + grid-reflow motion, maximize/restore FLIP, overlay backdrop fades + modal exits, toast in/out, `.disclose` height animation for tool cards/diffs, palette entrance/exit, list staggers, smoothed autoscroll, 1Hz clock soft tick
- [ ] **Homescreen completion** — command line onto `.surface-pop` + provider hint + focus-on-mount; usage glance consumes its skeleton (no pop-in); day-aware greeting clause; collapsed-sidebar entry points
- [ ] **Settings cleanup** — wire or remove the four dead controls (density/font-scale become real), close-X stacking fix, focus traps + dialog semantics across all modals, FileFinder/GlobalSearch ARIA
- [ ] **Terminal/editor/voice theming** — xterm + Monaco themes derived from the live tokens/accent (terminals stay dark by design but follow accent); VoiceButton real waveform; charming pet status copy; `aios-wave` keyframe de-duplicated

## Wave 3 — signature features (the fun part)

- [ ] **Workspaces** — save/restore named layouts, morph transition, palette commands
- [ ] **Focus Spotlight** — dim everything but the focused pane (chord-toggled)
- [ ] **Activity Glow** — chrome breathes while agents run
- [ ] **Smart starter chips + resume rail** on the empty chat hero
- [ ] **Run timeline rail** — live phase spine from runEvents beside the transcript
- [ ] **Living Pet** — pet reacts to terminal/agent activity (build green = celebrate, stack trace = wince)
- [ ] **Repeat-last + action ring** in the palette
- [ ] **Soundscape** (optional, default off)

## Verification gates (every batch)
`npx tsc --noEmit` · `npm run test:chatpane` · `cargo check` (Rust batches) · `npm run build` (per wave) · manual run at the end

---
*Maintained by the polish session(s). When an item ships, move it to the wave's "Shipped" list with its commit hash.*
