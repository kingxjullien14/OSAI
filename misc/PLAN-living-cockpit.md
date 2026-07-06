# PLAN — The Living Cockpit: pet redo × lock screen × settings clean

Owner directives (2026-07-05):
- **Pet**: full redo, "even more interesting and interactive" — APPROVED mix:
  desk-creature body (2) + tamagotchi soul (1) + companion-agent garnish (3).
- **Settings**: "properly clean it" — the plugins section design doesn't match
  the other sections; the (appearance) preview needs an update; audit that
  EVERY setting actually functions.
- **Pulse**: no memorable way to open it → FIXED same day (root cause: pulse
  was never in the SPAWN catalog — renderable but unreachable; one catalog
  entry gives it ⌘K + sidebar-customize presence).
- **Idle dashboard**: redo as the intended **lock screen** — calmer, more
  glanceable; quick actions + projects presented "nice to the eyes"; the pet
  visibly living on it (moving around / sleeping).

One bundle because the pet is the connective tissue (it lives on the lock
screen AND roams the workspace) and the lock-screen redesign decides where
pulse/quick-actions surface.

## Ground truth (verified in code, 2026-07-05)

- Current pet: `PetPane.tsx` + `PetDashboardCompanion` (IdleControlCenter) —
  seeded code-drawn 8-bit pet, variants (tone/eyes/legs/environment/topper/
  pattern/tail), accent-linked, daily reroll bank, moods from activity.
  **The bundleBoundaries "pet" test pins these internals** — it gets
  REWRITTEN alongside whatever ships (keep: seeded, code-drawn, no <img>).
- Settings: 11 sections; `channels` + `plugins` sections EMBED whole panes
  (`<BridgesPane/>` / `<PluginsPane/>`) inside the modal — that's the design
  mismatch the owner sees. Other sections use the Card/Row/Toggle system.
- IdleControlCenter: Mission-Control layout (eyebrow strip, greeting +
  composer hero, quick-launch tiles, agents/recent columns, usage blocks,
  PetDashboardCompanion) — owner wants it re-cast as a LOCK SCREEN.
- Pulse: `PulsePane` (streak hero, lifetime stats, rate rings, heatmap) —
  now in SPAWN as `{ id: "pulse" }` (not firstClass).

## Workstream P — the pet ("the resident")

- **P0 — engine (pure, tested). SHIPPED 2026-07-05** (309/309, 15 new ·
  build clean): `src/lib/pet/engine.ts` — needs (energy/fullness/spirits)
  with per-hour tuning in an exported TUNING table; tick() absorbs real
  signals (activeMinutes, streakDays, surfaceMinutes→affinity,
  agentFinished/Failed→spirits+totals, isNight→faster sleep recovery),
  bounded-absence decay (72h cap) + self-care floors (neglect saddens,
  never kills); applyCare(feed/play/pet) with cooldown diminishing returns;
  bond MONOTONIC (care + shared hours); derived moodOf (7-mood ladder) /
  stageOf (age AND bond gates) / flavorOf (dominant-surface evolution at
  adept+, 40% share) / suggestActivity (the rig's steering). parseSoul =
  corruption-tolerant revival. `store.ts` = localStorage + subscribe + the
  MIGRATION PROMISE: an existing pet (variant v2/v1 present) gets a soul
  born a week ago with bond 20 — it "remembers you". Engine is clock-free
  (every fn takes `now`) → fully deterministic tests. `src/lib/pet/` state machine: needs
  (energy · mood · hunger) fed by REAL signals — usage pulse (streaks,
  activity heatmap), agent/notification events (finish → happy, error →
  startled), wall clock (night → sleepy). Evolution stages + flavor from the
  owner's dominant surface (terminal-heavy vs chat-heavy vs browser-heavy).
  Identity (seed/tone/accent) MIGRATES from the current pet — nobody's pet
  dies. node:test coverage: decay curves, transitions, evolution rules,
  persistence round-trip.
- **P1 + P2 SHIPPED 2026-07-05** (309/309 · build clean; owner freed the
  design from the old seed — "fresh new design"):
  - P1 `components/pet/PetBody.tsx` — the GLASS SPIRIT: an SVG rig (one
    viewBox, scales 56px→room-size) made of the app's own material —
    translucent accent-gradient blob + glowing accent-2 core + glass rim
    light, big expressive eyes (round/crescent/star/half-lid/X/wide by
    mood+pose), mood mouths, stubby feet, cheeks when delighted, ground
    shadow that fades in flight. Stage toppers: sprout leaf → adept flavor
    emblem (terminal cursor-block w/ blink · chat bubble · browser orbit ·
    files flag · notes quill) → elder halo. Tokens + color-mix ONLY (no
    hex). ~15 keyframe blocks in App.css (breathe/hop/celebrate/startle/
    dangle/spin/land/chomp/core-pulse/blink/steps/zzz/cursor/halo), all
    stilled by the master reduce-motion guard + media query.
  - P2 `components/pet/PetOverlay.tsx` — the DESK CREATURE: roams the
    workspace floor (style-mutating rAF, zero per-frame renders), wander
    beats w/ pauses + direction flips, sleeps via the soul (night/energy),
    GRAB + TOSS physics (pointer capture → dangle; release velocity →
    ballistic arc w/ wall bounces + squash landing), click = pat (care),
    right-click = Feed/Play/Pet/Open-its-room (PaneMenu). Signal adapters:
    5s focus sampling → activeMinutes + per-surface affinity minutes
    (petSurfaceOf(active pane kind)), 60s soul ticks; notifications
    subscription → chat.done/success = celebrate + agentFinished, error =
    startled + agentFailed. Mounted in the windowed workspace next to
    WindowLayer (z-55, under menus). S4: `petRoam` setting (default ON) +
    appearance row. PetPane (the room) still the old pet — replaced in P3.
- **P3 SHIPPED 2026-07-05** (309/309 · tsc 0 · build clean — frontend-only):
  the pet's ROOM. `PetPane.tsx` fully rewritten around the soul + rig —
  the 8-bit pixel pet is retired end-to-end:
  - Room scene: ambient glass card (accent/accent-2 blobs, floor line),
    the spirit at 150px on the floor (click = pat), rename-able name plate
    (name lives OUTSIDE the soul — store.ts loadPetName/savePetName,
    `aios.pet.name.v1`), mood line, stage/flavor + day/night chips, and
    the pet-bus speech bubble (low context / failed run / long clean run).
  - Honest cards: vitals (energy/fullness/spirits bars, semantic tones),
    care (feed/play/pet with LIVE cooldown countdowns + real TUNING
    numbers, "rhythm beats spam" copy), bond & journey (bond meter,
    level names, next-stage gate from TUNING.stages), favorite places
    (affinity share bars + flavor callout), keepsakes (10 milestones
    earned from totals/bond/age — the "wardrobe" in honest form).
  - The room ticks pure metabolism while open (no active minutes — the
    overlay owns focus/affinity sampling, so nothing double-counts).
  - PetDashboardCompanion rewritten as a self-contained mini tile (same
    rig at 86px, name + mood line, "needs you · ask jarvis" chip when
    sick/grumpy/hungry) — `.aios-pet-mini` CSS simplified to width+hover.
    This pulls the companion-replacement half of P5 forward; P5 is now
    lock-screen residency only.
  - PURGED: the entire pixel-pet CSS block (~1,300 lines: .pet-pixel/
    world/canvas/hatch/starter/job/prop/dashboard/meter + 20 keyframes)
    and lib/pet.ts's METERS model usage (pet.ts itself stays — chat/
    terminal still feed its reaction/bubble/confetti buses, which the
    room + P4 ride). bundleBoundaries "pet" test block REWRITTEN to pin
    the new contracts (one rig everywhere, soul wiring, room cards,
    petRoam-gated overlay, pet2 keyframes + reduce-motion, and
    doesNotMatch guards so pixel-pet remnants can't creep back).
  - S4 fix (owner: "the settings toggle is not there"): the petRoam row
    had landed in notifications → sound & motion; moved to a dedicated
    "pet" card in settings → APPEARANCE (P4's bubble/quiet-hour switches
    join that card).
- **P1 — the body.** Rebuild the sprite as a composable animation rig
  (code-drawn, seeded, layered divs/canvas — no images): idle · walk · run ·
  sleep (zzz) · eat · celebrate · startled · dangle (while grabbed) ·
  land-splat. Animation = CSS keyframes driven by a tiny scheduler, so the
  ratchet + reduced-motion rules hold.
- **P2 — the desk creature.** A workspace overlay layer (windowed mode):
  pointer-events ONLY on the pet's own box. It walks the bottom edge, climbs
  onto window title bars (reads WindowLayer rects), naps on the dock strip,
  reacts to live events, and can be GRABBED and tossed (spring physics,
  motion/react — already a dep) with a happy/dizzy landing.
- **P3 — the soul.** Needs loop + interactions: feed / play / pet via click
  + context menu; bond level grows with interaction + real usage; PetPane
  becomes the pet's ROOM (stats, stage, wardrobe earned by streaks, history).
- **P4 SHIPPED 2026-07-05** (314/314 — 5 new voice tests · tsc 0 · build
  clean · frontend-only): the VOICE. `src/lib/pet/voice.ts` = the PURE
  tested decider: a global gap (≥3 min between ANY two lines) + per-kind
  cooldowns (bus 5m · error 8m · done 15m · usage 30m · need 45m) + hard
  silences (notification quiet mode / asleep / carried) that burn no
  anchors, plus honest line composers (usageLine provider+window+pct,
  agentDone/ErrorLine w/ trimmed titles, needLine only for moods care can
  fix — sleepy pets just sleep). PetOverlay wiring, 4 sources: the
  lib/pet.ts bus (low-context / long-clean-run lines), notifications
  (error → "hit trouble — look?", chat.done/success → "finished ✓";
  click = openNotificationTarget deep-link via the new onOpenTarget prop),
  usage pace (claudeRate polled lazily every 5 min — its own disk cache +
  429 backoff make it cheap; usagePaceRisk on 5h+7d, danger wins; first
  check waits an interval so boot is never chatty), and its own needs
  (10-min sampling → "got a snack?", click = its room). The bubble is a
  SOLID glass chip riding the follower box (tracks the roaming pet for
  free; edge-aware alignment; stopPropagation so a bubble click never
  reads as grab/pat; the pet pauses its wander to talk). `petVoice`
  setting (default ON) beside petRoam in the appearance pet card. Bundle
  test pins the decider, the setting gate, the deep-link and the sources.
- ~~**P4 — the garnish.**~~ Speech bubbles with USEFUL one-liners, rate-limited
  (≤1 per few minutes, quiet hours respected): "3 agents running", "usage
  80% — slow down?", "that build failed" — click = jump to the pane. Bubble
  taps the same stores the dashboard uses (no new backend).
- **P5 — residency.** Pet on the lock screen (sleeping at night, wandering
  between modules). ~~PetDashboardCompanion replacement~~ + ~~test rewrite~~
  both landed early with P3.

## Workstream S — settings clean

**S1–S3 SHIPPED 2026-07-05** (294/294 · build clean · frontend-only; the
bundle test's old `prompt</span>` preview pin updated to the new marker):
- S1: plugins + channels are native Card/Row sections now (live summaries —
  skill/group counts + MCP chips; channel rows w/ status dots + uptime/
  activity + "on the way" chips) with "open full pane" buttons via two new
  spawnPane kinds ("plugins" | "bridges"). The full-bleed pane embeds (and
  their lazy imports + Suspense) are gone; Row.label widened to ReactNode.
- S2: AppearancePreview redrawn against the CURRENT anatomy — ambient
  canvas + a floating window (title strip, depth window behind) + chat line
  + mini composer deck (filament gradient, model/plan chips, send orb),
  every color a live token; the mac traffic lights + sidebar-grid mock are
  gone.
- S3 audit (scripted consumer scan of all 33 AppSettings fields, then
  hand-verified): SIX settings were WRITE-ONLY — UI existed, nothing read
  them. All six wired to real consumers:
  - `confirmCloseOraclePane` → requestClose now confirms oracle-pane close
    (honest copy: the session keeps running).
  - `defaultPaneType` → ⌘T/new-pane fallback spawns the configured kind
    (was hardcoded terminal).
  - `notificationNativeMode` + `notificationQuietMode` → NEW
    maybeNativeAlert in lib/notifications: OS toasts via the Notification
    API when the window is unfocused; "important" filters to
    error/warning/high; quiet mode suppresses; permission requested once.
  - `autoRefreshSeconds` → OracleRoster cadence (was hardcoded 5s).
  - `showNonAiosSessions` → gates the roster's "other sessions" block
    (previously always shown).
  - `onboardedAt` = intentional write-only metadata (kept, documented);
    `flashLevel` + `regenerateContextOnChange` verified functional.
S4 (pet/lock-screen keys) lands with those workstreams.

**S5 (owner ask 2026-07-05, SHIPPED same day — 314/314 · build clean): the
GLOW is settable.** "the cyan accents… on the composer, on the pet — i want
an option to set that accent colour… some colours might not fit with cyan."
`--aios-accent-2` was a fixed brand cyan; now lib/theme.ts carries a full
accent-2 family mirroring the primary (ACCENT2_PRESETS cyan/teal/lime/pink/
gold/ice + custom hex + shared recents, get/set/subscribe/applyAccent2,
applied at boot via initTheme). Cyan CLEARS the inline override so fresh
installs sit exactly on the stylesheet default. Settings → appearance →
theme grew a "glow" row (AccentSwatches parameterized with presets/order —
one component, both rows). All 65 var(--aios-accent-2) consumers (composer
lip, send orb, pet core/emblems, viewer chips…) re-tint instantly; the
App.css comment updated (no longer claims "intentionally fixed").

- **S1 — section parity.** `plugins` + `channels` stop embedding raw panes:
  each becomes a native section (Card/Row summaries + the few real settings)
  with an "open full pane" button for the rich view. (Plugins pane itself
  stays a pane — also worth a SPAWN entry like pulse got? decide here.)
- **S2 — preview refresh.** The appearance preview card still previews an
  outdated look — re-draw it against the CURRENT reality (windowed
  workspace, chat deck, Neon Glass tokens) so theme/accent/density changes
  preview truthfully.
- **S3 — function audit.** Walk every Row/Toggle/field in all 11 sections:
  verify each reads loadSettings + writes saveSettings + has a live
  CONSUMER. Fix or delete dead ones; log every finding here as
  `S3: <setting> — <verdict>`.
- **S4 — new keys land clean.** Pet toggles (roam on/off, bubble quiet
  hours) + lock-screen options from Workstream L get properly grouped
  sections, not bolted-on rows.

## Workstream L — the lock screen (idle dashboard redo)

- **L0 DONE 2026-07-05 → owner picked B (2026-07-06).** Sketch round
  published as an artifact (three directions: A monolith · B horizon ·
  C orbit) — owner: "i love B, but the working world, please make it
  dynamic. and the quick actions, maybe just show chat terminal notes…
  busy but nice on the eyes… so please add the stars and all that.
  motions. the schebang."
- **L1–L3 + P5 SHIPPED 2026-07-06** (314/314 · tsc 0 · build clean ·
  frontend-only): IdleControlCenter fully re-cast as the HORIZON lock
  screen — proportional bands (const HORIZON = 63%), nothing scrolls,
  the old fit-scale hack deleted.
  - SKY: aurora blooms (liveness-breathing, kept) + a deterministic
    24-star twinkle field + two slow satellites + a shooting star on a
    lazy 15s cycle (SkyField; aios-lock-* keyframes, all transform/
    opacity, stilled by both reduce-motion guards).
  - CLOCK: date eyebrow → monumental mono clock (clamp 56–148px, accent
    text-glow, tabular-nums) → BlurText greeting, standing lower-left ON
    the line (ClockBlock).
  - STATUS ROW (right, riding the line): agents-live chip (click →
    scheduled agents), claude 5h chip w/ mini bar (useUsageRates — same
    source as the sidebar), streak chip (click → pulse pane), unread chip.
  - THE LINE: accent→glow gradient + a light-pulse traveling it
    (aios-horizon-flow).
  - P5 RESIDENCY: HorizonPet — the glass spirit WALKS the horizon
    (style-mutating rAF stroll w/ pause beats, lazier SPEED 26), sleeps
    on it at night (soul-steered), celebrate/startle via the pet bus,
    "needs you" whisper chip when struggling, click = its room; confetti
    + liveness ripple re-anchored on it. Metabolism-only ticks while the
    lock screen is up (idempotent vs the overlay's). The old corner
    PetDashboardCompanion tile + .aios-pet-mini CSS are DELETED
    (PetPane now exports the room only).
  - GROUND (the dynamic working world): ground wash + two parallax
    ridge glows drifting at different paces (85s/135s reverse, seamless
    50%-repeat loop) + 10 deterministic fireflies rising with sway;
    content = quick-start dock (EXACTLY chat · terminal · notes, owner's
    pick) + the composer-grade CommandLine kept center (intents/vanish/
    palette-morph untouched) + the "continue" shelf right (resume-layout
    card, work sessions w/ hover done/remove, recent projects w/ git
    drift dots + shape chips, "all projects →" overflow).
  - Tests: the "Mission Control" bundle block REWRITTEN as the Horizon
    contract (bands, dock-of-three, status-row sources, shelf, ambience
    keyframes + reduce-motion, Mission-Control-era doesNotMatch); the
    pet block's idle pins now assert HorizonPet residency and the
    companion's absence.
- ~~**L0 — design round FIRST**~~ (composer-deck rhythm: sketches → owner
  picks). Direction to sketch: a true lock screen — huge clock + date +
  greeting, ambient depth (aurora/particles within flash-level rules), ONE
  glanceable status line (agents running · usage · streak), the pet living
  in the scene; quick actions as a floating dock row (not a tile wall);
  projects as a compact "continue where you left off" shelf (recent 3–4 +
  overflow into the projects pane) instead of a grid.
- **L1 — skeleton.** New layout container + clock/greeting/ambient; the
  existing data modules (agents, recent, usage) re-homed into calmer,
  collapsed-by-default surfaces.
- **L2 — quick actions + projects shelf** per the picked sketch.
- **L3 — pet residency** (from P2's layer) + empty-state choreography.
- **L4 round 1 SHIPPED 2026-07-06** (owner live-test screenshot; 314/314 ·
  tsc 0 · build clean):
  - TWO PETS fixed: the workspace PetOverlay (fixed z-55) floated ABOVE
    the home overlay (z-50) — it now unmounts while the home covers the
    workspace (`!homeOverlay && panes.length > 0`); the lock screen's
    HorizonPet is the only resident there.
  - STUCK-ANIMATION + never-sleeping fixed IN THE ENGINE: night rest
    recharges energy, so the old `isNight && energy < 55` sleepy gate
    never fired at midnight → moodOf said ecstatic → suggestActivity
    steered a celebrate LOOP all night. suggestActivity now: night =
    bedtime regardless of energy, and celebrate is never a steady state
    (joy = energetic wander; celebrate stays a transient reaction pose).
    Engine test updated to pin both rules.
  - ONE SCALE FAMILY: new GROUND_PILL const — the command bar's exact
    material (border-strong, panel gradient, radius-2xl, pop shadow) —
    now shared by the dock (px-4 py-3, icons 16) and the continue shelf.
  - SHELF → PILLS: the surface-card box is gone; resume-layout / work
    sessions (hover ✓/×) / projects are each their own pill; "all
    projects →" ghost stays. Visually shorter, same functionality.
  - ACCESS-BASED RECENCY: new src/lib/projectRecents.ts (localStorage
    map, normalized paths, 40-entry cap) — touchProjectAccess() fires in
    App's spawn() for ANY pane kind carrying a cwd (terminal-here,
    chat-here, files) and in openProject() (covers the workspace-picker
    path); the shelf sorts by lastAccessFor(root) (prefix-matches paths
    INSIDE the root) with mtime as the never-opened fallback, and shows
    the opened-at time instead of the lying mtime. Root cause: agents
    editing files bump mtime, so the shelf surfaced subfolders the owner
    never opened. Bundle test pins GROUND_PILL, no-surface-card, the
    recents wiring, and the single-pet mount condition.
- **L4 — density/motion polish + Settings hooks (S4)** — remaining:
  further rounds as the owner keeps live-testing.

## Sequencing

1. ~~Pulse access~~ ✅ shipped with this plan (SPAWN entry).
2. **S1–S3** settings clean (self-contained, high annoyance-relief).
3. **P0–P2** pet foundation → body → desk creature (workspace first).
4. **L0** lock-screen sketch round (owner picks) → **L1–L3** build,
   pulling **P3–P5** in as the pet moves in.
5. Continuous: verify ritual per slice (tsc · tests · build · cargo when
   Rust moves) + board updates here.
