# AIOS Superapp — Wave 4 Plan: deep polish, QoL, wiring truth & the fun tier

> Drafted 2026-06-12 after a full verification pass of [PLAN-superapp-uiux.md](PLAN-superapp-uiux.md) against the live tree.
> Verdict: **the original plan is ~95% shipped** (P0–P2 complete; tracker checkboxes now reconciled). This plan covers what remains, plus the next layer of polish, quality-of-life, and signature features. [TRACKER.md](TRACKER.md) stays the live status board — check things off there as they land.

## Verification summary (what grounds this plan)

Verified on 2026-06-12: `npx tsc --noEmit` clean · `npm run test:chatpane` 91/91 green · token ratchets pinned (`text-white` 0, `shadow-2xl` 3 = locked TerminalComposer, accent-hover 10 = true primaries) · `platform.ts`/`providerDetect.ts`/`Onboarding.tsx`/`ui.tsx`/`workspaces.ts`/`sessionLabel.ts` all exist and are wired · identity literals remaining are comments, migration guards, and one deliberate routing ID · remaining `⌘` glyphs are in comments only · palette has MRU, danger markers, repeat-last · FilesPane git colors are status tokens.

**Genuinely open from the old plan** (item-by-item pass, 2026-06-12 — each confirmed against the code):

| Old-plan item | Evidence | Carried to |
|---|---|---|
| Find-in-chat (Ctrl+F) | zero `findOpen`/find-bar hits in ChatPane.tsx | C1 |
| Settings cheat-sheet shows 6 of ~18 chords | `SHORTCUTS` at [Settings.tsx:625](src/components/Settings.tsx#L625) — platform-correct via `MOD` but still the same 6 hardcoded rows; ⌘P/⌘⇧F/⌘N/⌘F/⌘M/⌘1-9/⌘`/Ctrl+./Ctrl+Shift+K/F5/Esc all unlisted | C6 |
| Modal/overlay EXIT motion | palette/finder/search close by hard unmount (no `modal-out`/closing state); enters are animated | B10 |
| Pane close (exit) animation | mount has `fade-in-up` ([App.tsx:4333](src/App.tsx#L4333)); no exit path | B1 |
| Resolved approval card erases the command | decided `ApprovalCard` renders toolName + verdict only — no args echo (the *pending* card is fixed: full args + copy) | E (approval echo) |
| Gutter double-click-to-equalize | no `onDoubleClick` in ResizableGrid.tsx | B11 |
| Sidebar home/brand anchor | wordmark exists only in the splash; no sidebar home affordance | B12 |
| Whisper pre-flight | `whisperUrl` setting exists, no probe before recording | A1 |
| Bridges/Oracle/Monitor Windows gating | no `isApple` gating in BridgesPane/OracleRoster; launchd/tmux assumptions | A2 |
| FilesPane "scanning…" forever | bare string at [FilesPane.tsx:351](src/components/FilesPane.tsx#L351) | A9 |
| `PRIMARY_ORACLE_IDENTITY = "firaz"` | [OracleRoster.tsx:51](src/components/OracleRoster.tsx#L51) (deliberate, but should be a setting) | A3 |
| 1Hz clock soft tick · drift-backdrop liveness | not implemented | B2 / D4 |
| `#22c55e` success-green fallbacks | ChatPane ×3, EditorPane ×1 | A10 |
| PaletteShell extraction (3 drifting overlay shells) | CommandPalette/FileFinder/GlobalSearch still separate scaffolds (ARIA/traps converged, chrome not) | B13 |
| Fuzzy-matcher DP rewrite | greedy matcher kept; cost cap shipped instead (acceptable — revisit only if mis-ranking is felt) | B13 note |
| Entire P3 signature tier | Run Cinema, Conductor, scheduled agents, palette preview/verb-mode, minimap, smart starter deck, snap zones, pulse backdrop, pet bubbles, Windows capture | §C/§D |

Everything else in §4–§13 of the old plan was verified shipped (notably: approval-card full-command + copy, boot-time `applyAppearance()` at [App.tsx:730](src/App.tsx#L730), palette ask-aios/deep-search on zero-match, focused-pane accent edge, Mission Control disabled at 0 panes, splash gating + fade exit, claude→codex downgrade migration deleted, engine-aware budget copy, hero/starter/resume rail, timestamps + day separators).

## Guardrails (unchanged, still load-bearing)

1. Four first-class panes only (chat · terminal · files · browser); everything else stays behind the palette.
2. **`TerminalComposer.tsx` is untouchable.** Port patterns from it, never edit it.
3. No per-turn context injection into the model — smart features route through the pane/command bus.
4. Engine parity: claude = codex = opencode for every chat affordance.
5. ChatPane ↑-history recall stays as is.
6. Build & verify from the terminal, never inside the app's own chat pane.
7. **No multi-agent fan-out** during implementation (quota); single-threaded batches, one commit per batch.
8. Reduce-motion gates every new animation; accent discipline (DESIGN.md §6) holds — the ratchet enforces it.

---

## §A. Wiring & truth audit — "whatever is connected must be properly connected"

One focused session that walks every signal path end-to-end and fixes what's dangling. Each row is a concrete check with a pass/fail outcome, not a vibe.

| # | Path to verify | Known state / suspected gap | Fix if broken | Eff |
|---|---|---|---|---|
| A1 | **Whisper dictation** | `whisperUrl` setting exists ([voice.ts:21](src/lib/voice.ts#L21)) but there is **no pre-flight** — a dead endpoint fails only *after* you finish recording | HEAD/`/health` probe when recording starts; on failure show an inline "whisper not reachable at {url} — check Settings" before any audio is captured; mic button shows a cold `.status-dot` when last probe failed | S |
| A2 | **Bridges / Oracle / Monitor on Windows** | `bridges.ts` assumes launchd labels, `monitor.ts`/`pty.ts` assume tmux sessions — **no platform gating found** in BridgesPane/OracleRoster; on Windows these surfaces can render affordances that can never work | Gate mac/tmux-only affordances behind `isApple` with the same honest-fallback pattern Cast/Attach got (`c4fa535`); keep WhatsApp-bridge rows visible but state "requires the macOS bridge host" | M |
| A3 | **Primary oracle identity** | `PRIMARY_ORACLE_IDENTITY = "firaz"` ([OracleRoster.tsx:51](src/components/OracleRoster.tsx#L51)) — deliberate (WhatsApp routes to `aios-firaz`) but it's the last hardcoded stranger | Make it a setting (`primaryOracleId`, default read from existing tmux session if present); keep the literal as migration fallback so routing never breaks | S |
| A4 | **Notification deep-links** | `pushNotification` carries `{type, sessionId}` targets — verify every notification type actually lands somewhere when clicked (chat targets, agent results, workspace-detached chats from `f83998c`) | Walk each `pushNotification` call site; any target without a registered opener gets one or loses its link affordance | S |
| A5 | **Pet signal bus completeness** | Chat reactions shipped (`53a0b87`); terminal wiring (ctx%, pty-exit, composer send → pet) was specced in §12 but **not confirmed shipped** | If absent: `onPetUsage`/`onPetError`/`onPetUserMessage` calls from TerminalRuntime's existing parsers, throttled 2s | M |
| A6 | **Usage feeds** | OAuth live usage shipped (`7e3a953`), statusline fallback exists — verify the fallback chain actually degrades gracefully when offline (no spinner-forever, no stale "78% resets now" regression) | Add a "last updated Xm ago" stamp on stale data; zero-state copy when both sources are dead | S |
| A7 | **Workspace restore edge cases** | Restore reattaches terminals by key + browser last-url — verify restore with: a terminal whose pty died, a browser pane on a since-deleted profile, a chat mid-run (should detach + notify, not kill) | Fix any path that silently drops a pane; restore should always produce *something* per saved slot, worst case an honest placeholder | M |
| A8 | **Settings close-X stacking** | Old report: close-X fights with overlay stacking — never verified | Reproduce; fix z-order or remove the item from the books | XS |
| A9 | **FilesPane "scanning…"** | Bare string at [FilesPane.tsx:351](src/components/FilesPane.tsx#L351) can sit forever on a huge/failed scan | Timeout → honest error + retry pill; shimmer while genuinely working (Skeleton primitive already exists) | S |
| A10 | **Hex stragglers audit** | 38 hex literals left in components: TerminalRuntime 20 (ANSI palette — legit), Settings 14 (theme swatch definitions — likely legit), ChatPane 3 + EditorPane 1 (**audit these 4**) | Tokenize or annotate-as-exempt the ChatPane/EditorPane hits; add the exemption rationale next to the ratchet in bundleBoundaries.test.ts | XS |

**Exit criteria:** every row has a commit or a written "verified fine" note in TRACKER.

---

## §B. Polish — the remaining 5% that reads as 50%

The app is structurally converged; what's left is the last layer of choreography and edge-state honesty.

| # | Item | Detail | Sev | Eff |
|---|---|---|---|---|
| B1 | **Pane exit motion** | Mount has `fade-in-up` ([App.tsx:4332](src/App.tsx#L4332)); close still hard-unmounts. Drive a 160ms `scale(0.97)+fade` exit via a `closing` flag + `onAnimationEnd` before removal; survivors already glide (grid reflow `75a4b5f`) | high | S |
| B2 | **1Hz clock soft tick** | HeroClock digits still hard-swap each second; 150ms opacity ease on the changing glyph (keyed span), reduce-motion gated | low | S |
| B3 | **List stagger sweep** | Apply the capped `.stagger` (first ~5 children) to: notifications panel, palette result groups on first open, FilesPane initial listing, Mission Control cards. One-shot on mount only — never on refilter | med | S |
| B4 | **Light-theme full pass** | Every surface got token discipline, but nobody has *looked* at light theme end-to-end since. One manual sweep: all panes, all modals, hero, idle home, terminal seam. File and fix what's broken (likely: scrims, chrome strip, shimmer contrast) | high | M |
| B5 | **Empty-state adoption sweep** | `PaneEmpty` exists (`086f7cc`) but adoption was opportunistic. Sweep every pane for bare "no X yet" strings; each empty state gets icon + one actionable first-move pill (Files → open project, Notes → new note, Plugins → how to add an MCP) | med | M |
| B6 | **Toast unification** | `.toast-in/out` utilities exist; verify every toast call site uses them (BrowserPane reserved strip, cast, palette failure toasts, workspace saves) and that exits animate — no blink-out toasts anywhere | low | S |
| B7 | **Maximized-pane exit hint** | "esc to restore" helper-line, auto-fades after 2s, on maximize (old §7 item, unverified — check first) | low | XS |
| B8 | **Scroll position restore** | Chat panes: returning to a backgrounded/detached chat should restore your scroll offset, not snap to bottom (respect the existing sticky-pause model) | med | S |
| B9 | **Danger-action consistency** | Two-click delete shipped for Notes + agents; sweep for any remaining one-click destructive action (workspace delete, session delete, bookmark remove) and converge on the same two-click pattern | med | S |
| B10 | **Overlay/modal exit motion** | Palette, FileFinder, GlobalSearch, Settings, Mission Control all hard-unmount on close while their entrances animate. Shared pattern: a `closing` state plays the reversed `modal-in` (~160ms, ease-in) + backdrop fade-out before unmount | med | S |
| B11 | **Grid gutter affordance** | Resting gutters invisible until hover; add a faint resting pip (`opacity-30`) and `onDoubleClick` → equalize the two tracks + persist via `saveGridTracks` | low | S |
| B12 | **Sidebar home anchor** | Small mono `aios` wordmark header above the open-panes list (home glyph when collapsed) that hides all panes back to the idle home — currently the only way back is hiding panes one by one | med | S |
| B13 | **PaletteShell extraction** | CommandPalette/FileFinder/GlobalSearch share ARIA + traps but still triplicate the modal scaffold (drifting offsets/padding). Extract `<PaletteShell>` (backdrop + card + search row + footer slot); B10's exit motion lands once, here. *Matcher DP rewrite stays parked unless mis-ranking is actually felt.* | med | M |

---

## §C. Quality of life — fewer clicks, more flow

| # | Item | Detail | Eff |
|---|---|---|---|
| C1 | **Find-in-chat (Ctrl+F)** | Confirmed missing (0 hits). `.surface-pop` find bar top-right of the pane; highlight washes with `--color-highlight`; force-expand collapsed thinking/activity groups containing a hit (`forceOpen` prop); Enter/Shift+Enter next/prev; Esc closes. The single biggest daily-use gap | L |
| C2 | **Snap-to-zone pane dragging** | Pointer drag-swap exists (`bb94759`); add real zones: while dragging, edge/quadrant overlays light up (neutral fill, accent edge on hovered target only); drop calls a new `placePane(key, zone)` that rewrites order/span. Arrow buttons stay as keyboard fallback | L |
| C3 | **Palette preview rail** | Raycast-style right column on the palette for the selected row: resume-session rows show last 2 messages + engine + age; project rows show path + git state; workspace rows show a mini grid sketch of the layout. Reuses data the commands already carry | M |
| C4 | **Palette action mode** | A leading `>` scopes the palette to verbs with arguments: `>theme nord` (live-preview via theme.ts), `>workspace ship`, `>split right terminal`. Parser sits atop the existing matcher; active verb renders as a pinned `.pill` chip | L |
| C5 | **Conversation minimap** | 4px rail inside the chat scroll container; ticks per block colored by kind (user/approval/error/activity); click → smooth-scroll. Pairs with C1; trivial data (blocks array already exists) | M |
| C6 | **Shortcut HUD (Mod+?)** | One overlay listing every live binding as platform-correct keycaps, generated from the keydown handler's single source — replaces hunting through Settings. Pressing a chord while open flashes its keycap | M |
| C7 | **Type-ahead intent chips on the idle command line** | As you type: fuzzy-match recent projects, leading `$` → terminal, `/` → palette; 2–3 `.pill` chips below the input, Enter takes the top one. Routes through the already-threaded `onSeedChat`/`onSpawn`/`onOpenProject` | M |
| C8 | **"Pick up where you left off"** | One quiet pill between clock and command line: reopen last workspace/layout + focused chat in one keystroke. Workspaces (`f83998c`) + resume rail (`6525b41`) supply all the parts; this is the one-click composition of them | M |
| C9 | **Per-turn cost/usage sparkline** | Result turns carry tokens/duration; accumulate a bounded ring buffer; 24px SVG sparkline beside the usage strip, latest point accented. Engine-parity safe (renders whatever the engine reports) | S |
| C10 | **Smart starter deck** | The hero's four starter cards become cwd-aware: `package.json` → "explain this codebase", git repo → "summarize recent changes", empty dir → "plan a feature". Detection reuses the @-mention file list already fetched | M |

---

## §D. New features — the fun tier (sequenced, each independently shippable)

### D1. Run Cinema — replay any agent turn *(L · the best effort-to-wow ratio left)*
The full ordered run-event log is already persisted per session (`runEvents.ts` → localStorage). Add a "replay" action on finished activity groups: an overlay re-streams reasoning/tool-cards/diffs at adjustable pace with a scrubber; header strip shows tokens · duration. Pure client-side; zero backend. The run-phase rail (`904995d`) already proved the data pipeline.

### D2. Scheduled agents *(L)*
The schema is half-built (`schedule` field, `loadMoneyAgentLastScheduledRun`). Add a frontend scheduler tick (the app is long-running): when an agent is due, fire its run command through `paneSubmitters` into a background chat, then `pushNotification` with a deep-link target. The "agents work while you sleep" promise, landed. Depends on A4 (deep-links verified).

### D3. Pet companion bubbles *(M)*
Reactions shipped (`53a0b87`); next: an occasional speech bubble driven by real state — ctx <15% → "context running low — want me to /handoff?" (button routes through paneBus), clean run → "nice, all green." Bubble enters with `modal-in`, auto-dismisses 6s, reduce-motion safe, strictly rate-limited (max ~1/10min) so it stays charming, never Clippy.

### D4. Live pulse backdrop *(M)*
Derive one `--liveness` score in IdleControlCenter from data already in scope (activeAgents, dirtyProjects, unread, usage pct); drive the two drift blobs' accent `color-mix` through it with a 2s transition. The idle home breathes when the system is busy, settles when calm. Reduce-motion already freezes the blobs.

### D5. Command-line → palette morph *(M)*
When Ctrl+K fires from the idle home, FLIP the command-line container into the palette rect instead of mounting the palette over it — one continuous surface instead of two stacked ones. Read both rects once, transform-only tween, 220ms spring.

### D6. Conductor — push-to-talk workspace orchestration *(XL · flagship, last)*
Hold a global chord, speak: "split right with a browser on the docs and ask claude to wire it up." Pipeline: existing `dictateStart/Stop` → intent parser in a new `conductor.ts` → sequence of existing primitives (`spawnPane`, command registry actions, `paneSubmitters.get(key)(text)`). Ambiguous intents fall back to the palette pre-filtered with the transcript. **Depends on A1** (whisper pre-flight — Conductor on a dead endpoint is a trap). Spawned panes cascade in 40ms apart. No model-context injection — pure bus orchestration (guardrail 3).

### D7. Windows capture backend *(XL · the platform unlock — separate effort)*
A `windows-rs` / `Windows.Graphics.Capture` backend exposing the same `appcast_*` command surface; AppCastPane needs no rewrite, only the platform gate flips. Enumerate HWNDs in the picker. Phase A mirror-only; input forwarding later. This unlocks Mirror Wall, cast-to-chat, and PiP on the daily OS — none of those before this.

---

## §E. UI/UX micro-refinements (batched alongside whatever's nearby)

- **Approval-card echo**: after a decision, keep a ~60-char mid-ellipsized echo of the approved command on the verdict line (full text on hover + copy) — auditability without bulk.
- **Copy-affordance sweep**: tool stdout/stderr, `$ command` pres, write previews, DiffBlock — each gets the shared `CopyButton` on group-hover (verify which shipped with `086f7cc`, fill gaps).
- **Inline diff actions**: "open file" on edit tool cards via `openEditorFileInPane` + copy-as-unified-diff. The transcript becomes an actionable changelog.
- **Browser pane**: address-bar hit highlight on Ctrl+L; download-complete toast deep-links the file (platform-correct "Show in Explorer").
- **Mission Control**: richer cards — chat cards show last assistant line, terminal cards show last scrollback line (text only, no thumbnails — cheap and useful).
- **Sidebar collapsed mode**: open-pane rows show a 10px truncated label under the status dot, not dot-only.
- **Picker row affordance**: cast/window picker rows lead with window title; raw `#window_id` demoted to tooltip (macOS-gated, do with D7).

---

## Roadmap — suggested sequencing

| Session | Contents | Why this order |
|---|---|---|
| **W4-1: Truth** | All of §A (wiring audit) + B7/B9 quickies | Everything later builds on verified plumbing; A1 gates D6, A4 gates D2 |
| **W4-2: Feel** | B1–B3, B6, B8 (motion crumbs) + B4 light-theme pass + B5 empty states | Closes out the original plan's polish tier completely |
| **W4-3: Flow** | C1 find-in-chat + C5 minimap + C9 sparkline | The chat-pane QoL block — one surface, one session |
| **W4-4: Reach** | C2 snap zones + C8 pick-up-where-you-left-off + C7 intent chips | The "pro window manager" block |
| **W4-5: Palette** | C3 preview rail + C4 action mode + C6 shortcut HUD | The discoverability block |
| **W4-6: Fun** | D1 Run Cinema + D3 pet bubbles + D4 pulse backdrop + D5 morph | The delight drop |
| **W4-7: Autonomy** | D2 scheduled agents + C10 smart starter deck | Agents earn their keep |
| **W4-8+: Flagships** | D6 Conductor, then D7 Windows capture | Each is its own arc |

## Verification gates (every batch — unchanged)
`npx tsc --noEmit` · `npm run test:chatpane` · `cargo check` (Rust batches) · `npm run build` (per wave) · manual run from the terminal at the end. New features ship with at least one unit test where a pure-logic seam exists (intent parser, scheduler due-math, find-match indexing, liveness score).
