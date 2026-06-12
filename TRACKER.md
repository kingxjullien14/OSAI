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

### Shipped (cont. 2)
- [x] **App-shell batch** (`2a074cd`) — overlay occlusion set complete (FileFinder/GlobalSearch/close-prompt/onboarding/splash); spark launcher → `codexShellCommand()` (no hardcoded model); cast/attach gone from the Windows catalog; appshot gated to macOS + label fixed; "jarvis" → "chat"; drag strip 6px + under-point hit-test; Mission Control empty-space close + accessible card X; collapsed-sidebar floating cluster (palette/sidebar/bell); accent fills on `--color-accent-fg`
- [x] **Chat failure-truth + empty-hero rescue** (`71863d6`) — error text from `ev.result`; stop renders calm (no red card); retry re-spins on startup failure; regenerate uses the visible bubble; defaultAi derived on model pick; chips+ledger bloom on first keystroke; pre-session sends keep the hero (inline status + retry); `.hero-title`/`.helper-line` adopted; anchored hero; `⏎ send · ⇧⏎ newline` cue; dropdowns close on outside-click/Escape with ARIA; action rows reveal on keyboard focus
- [x] **Terminal/editor correctness** (`22f7f23`) — Ctrl+V/Ctrl+Shift+V paste + Ctrl+C-with-selection/Ctrl+Shift+C copy on Windows (Ctrl+C stays SIGINT); exited-Enter scoped to its pane (+ autofocused restart); Ctrl+S saves only the focused editor with an in-flight guard; the text-size slider drives xterm + Monaco live; spawnShell fallback carries cwd
- [x] **Safety batch** (`c4fa535`) — NotesPane two-click delete; Onboarding replay keeps saved engine/model; lush→calm one-time migration; PulsePane + PluginsPane honest states; cast/attach honest Windows fallbacks

### Open (rolls into Wave 2)
- [ ] **Browser-pane occlusion** — address-bar autocomplete + toasts + annotate badge render under the native webview (pane-local fix in BrowserPane)
- [ ] **Palette trust** — disabled commands look identical + silently no-op; danger flag never surfaced; matcher cost cap; "not installed" models could explain why
- [ ] **Whisper endpoint** — hardcoded localhost:9000, fails only AFTER recording; make it a setting + pre-flight check

## Wave 2 — pane polish & UI/UX convergence *(user: "all panes need polishing, UIUX improved by a lot")*

- [x] **CSS substrate fixes** (`~6a7ac8a^`) — transition baseline into `@layer base` (Tailwind transitions work again); `.lift/.press/.btn-glow` carry color easing; new `.overlay-backdrop`/`.toast-in/out`/`.disclose`/`.skeleton`/`.aios-wave-bar` utilities
- [x] **Composer menus un-clipped** (`6a7ac8a`, user-reported) — fixed-position direction-aware dropdowns with internal scroll
- [x] **Windows drag feedback** (`6a7ac8a`, user-reported) — HTML5 draggable mac-only; pointer drag owns the gesture (ghost, live overlays, hover label, instant drop)
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

- [x] **Focus Spotlight** (`d1743a3`) — Ctrl+./Cmd+. dims every pane but the active one (45%, eased); auto-suspends maximized/single-pane
- [x] **Starter deck on the empty hero** (`d1743a3`) — quiet pills prefill the composer, vanish on first keystroke
- [x] **Chat hero redesign** (`235cf69`, user-reported) — time-aware greeting, accent-gradient title word, ambient aurora blobs, starter deck upgraded to four lift-on-hover icon cards, decluttered helper; dropdowns open toward the larger side + cap height (no more clipped selectors)
- [x] **Windows menu strip removed** (`235cf69`, user-reported) — the native "AIOS Edit Pane" menu is macOS-only now; chords still work via the in-app keydown handler. *Caveat: on Windows, chords don't fire while focus is INSIDE a browser child webview (the menu was the workaround) — click into app chrome first. If that bites, we can add a Rust-side accelerator later.*
- [ ] **Workspaces** — save/restore named layouts, morph transition, palette commands
- [ ] **Activity Glow** — chrome breathes while agents run
- [ ] **Resume rail** on the empty chat hero (recent sessions one click away)
- [ ] **Run timeline rail** — live phase spine from runEvents beside the transcript
- [ ] **Living Pet** — pet reacts to terminal/agent activity (build green = celebrate, stack trace = wince)
- [ ] **Repeat-last + action ring** in the palette
- [ ] **Soundscape** (optional, default off)

## Remaining Wave 2 backlog (next session)
- [x] **Usage everywhere** (`90c457d`) — Windows feed fixed (USERPROFILE/curl.exe), sidebar-footer mount, honest claude "no feed" row, codex labeled with its chatgpt-sub provenance; chat strip explains itself
- [x] **Claude statusline hook installed on this machine** — `~/.aios/bin/statusline.ps1` + `statusLine` merged into `~/.claude/settings.json`; writes `~/.aios/state/usage.json` per tick (real 5h/7d light up after the next claude session starts)
- [x] **Transcript de-dup + redundancy** (`9a0d401`) — footer no longer echoes the reply, thinking dedup (+test), single-bucket ledger collapsed, run pill live-only, block arrival motion
- [x] **Run-phase rail** (`904995d`) — think→write→act→done spine on live activity groups
- [x] **Maximize/restore FLIP morph** (`904995d`) — panes expand/shrink instead of teleporting
- [x] **`.pane-header` convergence complete** (`90c457d`+`904995d`) — pulse/plugins/channels/agents/editor/file-viewer/notes all on the shared header spec
- [x] **Usage truth** (`e950b28`+`7cea8bf`) — bogus test snapshot purged; expired windows zero themselves at the source (the "5h 78% resets now" bug); 24h freshness; strip render-guard; honest claude row wording
- [x] **Select-to-attach context snippets** (`7cea8bf`, user-requested) — select reply text → "add as context" chip → snippet pills in the composer, each riding the next send as its own labeled block
- [x] **Design-token ratchet guard** (`ca602bb`) — text-white/text-black/hover-accent/shadow-2xl counts can only go down; new literals fail the suite
- [x] **Dead bento CSS deleted** (`ca602bb`) — .aios-tile/.aios-omni/.aios-idle-glow (~90 lines), the last fully-open P0
- [x] **Shared primitives** (`086f7cc`) — ui.tsx PaneEmpty/Skeleton/CopyButton; adopted in chat, editor (skeleton code-lines), agents, cast fallbacks, bridges
- [x] **BrowserPane occlusion** (`45fc534`) — autocomplete joins the native-hide list; toasts become a reserved strip above the page
- [x] **Interactive surfaces** (`bfcb734`) — xterm/Monaco carets + selection follow the live accent; VoiceButton equalizer; whisperUrl setting; text-size + density tokens finally consumed app-wide; wave keyframe single-sourced
- [x] **Dead code** (`0420a6d`) — hotkeys metadata deleted (reportUsage kept: it feeds Settings diagnostics)
- [x] **Palette trust** (`4cec60d`) — danger markers, dimmed disabled rows, surfaced ok:false failures (toast), matcher cost cap
- [x] **Motion** (`965d27d`) — smooth jump-to-latest, .disclose diff expansion with show-less
- [x] **Activity Glow + repeat-last** (`a1476cf`) — breathing chrome seam on streaming panes; Ctrl+Shift+K re-fires the last command

- [x] **Claude usage live + account-global** (`7e3a953`, user-reported) — OAuth usage endpoint (the /usage panel's own source) replaces the stale statusline file (now fallback); chat strip + sidebar share one global source; verified live (39%/31%)

## Still open (the long tail)
- [ ] per-model 7d windows (the endpoint also returns seven_day_sonnet etc.) in the model picker / sidebar
- [ ] FileFinder/GlobalSearch full ARIA mirror + focus traps across modals
- [ ] grid-reflow transition (needs a not-while-dragging gate in ResizableGrid)
- [ ] Workspaces (saved layouts), resume rail on the hero, living pet wiring, soundscape
- [ ] remaining token ratchet counts → 0 (text-white 6, accent-hover 30, shadow-2xl 16)
- [ ] per-model usage windows in the model picker ("not installed" reasons)
- [ ] BrowserPane local occlusion (suggest dropdown/toasts under webview) + remaining superapp-pane §11 polish (menus onto .surface-pop, poll-swap transitions)
- [ ] xterm/Monaco themes from live tokens; voice waveform + whisper URL setting; editor/terminal skeletons; density+font-scale CSS consumers (the boot plumbing exists, App.css consumers don't)
- [ ] dead-code deletion batch (bento CSS verified unreferenced; hotkeys field; reportUsage loop)
- [ ] palette trust items (disabled/danger styling, matcher cap) + modal focus traps/ARIA mirror in FileFinder/GlobalSearch
- [ ] maximize/restore FLIP morph + grid-reflow transition + smoothed autoscroll + `.disclose` adoption in chat tool cards

## Verification gates (every batch)
`npx tsc --noEmit` · `npm run test:chatpane` · `cargo check` (Rust batches) · `npm run build` (per wave) · manual run at the end

---
*Maintained by the polish session(s). When an item ships, move it to the wave's "Shipped" list with its commit hash.*
