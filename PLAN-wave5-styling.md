# AIOS Superapp — Wave 5 Plan: Signature Styling

> Drafted 2026-06-13. Scope: restyle the app's surfaces using **Framer Motion** (`motion`), **Magic UI**, **Aceternity UI**, and **ReactBits** — curated and token-adapted, not pasted. [TRACKER.md](TRACKER.md) stays the live board.

## Intent

Waves 1–4 built the bones: a token-driven design system, honest states, a complete vanilla-CSS motion layer, and the signature features. Wave 5 is the **skin upgrade**: the moments where a hand-rolled CSS keyframe reads as "fine" get replaced by the components these libraries have already perfected — spring physics, shared-element morphs, mouse-aware glows, animated borders, typographic entrances. The goal is not "make it look like a landing page"; it's to make the calm cockpit feel *expensive*.

**What these libraries actually are** (this shapes everything below):
- **Framer Motion** → the `motion` npm package (v12, React 19-ready). The only runtime dependency. Springs, `AnimatePresence` (interruption-safe exits), `layout`/`layoutId` (shared-element FLIP), variants/stagger orchestration.
- **Magic UI / Aceternity / ReactBits** → **copy-paste TSX** (no npm packages). Components get **vendored into `src/components/fx/`**, adapted to our tokens, and attributed in a header comment. Most assume Tailwind config keyframes — we're on **Tailwind v4 (CSS-first)**, so their keyframes land in `App.css` next to ours instead of a config file.

## Ground rules — the adaptation contract (non-negotiable)

Every vendored component passes this checklist before it ships:

1. **Tokenized.** These libraries hardcode `#0ea5e9`-style hex, `shadow-2xl`, `text-white` everywhere. All of it maps to our vars (`--color-accent`, `--color-highlight`, `--color-border`, `--aios-shadow-pop`, `--color-accent-fg`) before commit — **the bundleBoundaries ratchet (hex=0, text-white=0, shadow-2xl=3) stays green and is the enforcement mechanism**. No exemptions added for fx/.
2. **Reduce-motion is sacred.** The master guard (`[data-reduce-motion]` + media query) already kills CSS animation. JS-driven motion needs its own gate: a global `<MotionConfig reducedMotion>` bridged from our setting, and every rAF/canvas effect (vanish-input, click-spark, confetti) checks `prefersReducedMotion()` and renders its static fallback.
3. **Accent discipline (DESIGN.md §6) survives the gradient temptation.** These libraries love rainbow gradients. Ours map to a *single family*: `accent → color-mix(accent, highlight)`. One glowing primary per surface. Spotlight/glare effects run at whisper alpha (≤8%) on neutral surfaces and only earn accent on active/primary elements.
4. **The no-fly zones.** `TerminalComposer.tsx` (locked, firaz), the xterm interior, Monaco's interior, and anything underneath a native webview (browser/cast pane bodies — native layers composite OVER the DOM; fx there is invisible *and* wasted GPU). Fx lives on: idle home, chat surfaces, overlays, sidebar/chrome, settings, onboarding, pet.
5. **Performance budget.** `motion` is ~32kb gz (LazyMotion + `domAnimation` keeps it ~18kb where possible); canvas/heavy fx (vanish input, dot grids, confetti) are `React.lazy` + idle-surface-only. No infinite `box-shadow`/`filter` loops on large surfaces; beams/glows are `transform`-driven masks. Hard cap for the whole wave: **+60kb gz**; measured per session via the existing build output.
6. **One clock.** `fx/motionTokens.ts` reads `--aios-dur-*`/`--aios-ease-*` off `:root` once so JS springs and CSS transitions stay in the same timing family. Springs use stiffness/damping tuned to *feel* like `--aios-ease-out` (≈ `{ type: "spring", stiffness: 380, damping: 32 }` default).
7. **Two motion systems, one owner each.** CSS keeps micro-transitions (hover color/border, pills, focus rings — the global baseline). `motion` owns *choreography*: overlay enter/exit, list orchestration, shared-element morphs, drag physics. A surface never mixes both on the same property.

## Foundation (W5-1)

- `npm i motion clsx tailwind-merge` → `fx/cn.ts` (the `cn()` every vendored component expects), `fx/motionTokens.ts`, `fx/reducedMotion.ts` (one source: our setting OR the OS query).
- App-level `<MotionConfig reducedMotion={...}>` wired to the settings subscription.
- **`AnimatePresence` migration** of the seven overlays (palette, finder, search, Settings, Mission Control, pin-site, save-workspace): replaces the hand-rolled `useExitState`/`ExitGate`/`data-closing` machinery with interruption-safe presence (a reopened palette mid-exit reverses smoothly instead of restarting). The CSS `.modal-in`/`aios-modal-out` keyframes retire on these surfaces; `useExitState` stays exported until the last consumer is gone, then dies.
- **Pane exit** moves from the `closingKeys` + `setTimeout(170)` dance to `AnimatePresence` around the grid children (`popLayout` mode) — same look, interruption-safe, and deletes state. Grid *reflow* stays CSS (`grid-template` interpolation — proven, and `motion` can't animate grid tracks).
- Toasts: `AnimatePresence` + spring replaces `.toast-in/out` classes; the flash timer-race plumbing simplifies.

## The component map — what goes where

### Idle home (W5-2) — the showcase; zero native views, safest surface
| Component (source) | Where | Adaptation notes |
|---|---|---|
| **Placeholders-and-vanish input** (Aceternity) | The CommandLine | The headline change. Keep OUR chrome (composer-grade glass, focus sheen, intent chips, ↑ recall, `$`/`/` routing); adopt the rotating placeholder carousel ("ask anything…" / "$ run a command…" / "open a project…" / "switch workspace…") + the canvas vanish-on-submit. Vanish is lazy-loaded; reduce-motion = instant clear. |
| **Spotlight** (Aceternity) | Hero backdrop, one-shot on arrival | Single sweep, accent at 6% alpha, then settles; pairs with the existing liveness-driven drift blobs (which stay). Static radial under reduce-motion. |
| **DotPattern, radial-masked** (Magic UI) | Behind the hero stack | `--color-border` dots at ~35% alpha, masked to the center; replaces flat emptiness without competing with the blobs. Pure SVG, no animation = no gate needed. |
| **BlurText per-word** (ReactBits) | Greeting line | Entrance only, once per mount; the accent name word keeps its gradient and additionally gets **AnimatedGradientText**'s slow shimmer (accent→highlight mix, 8s, breath-quiet). |
| **NumberTicker** (Magic UI) | Usage glance percentages, streak count | Springs to the new value on poll change; `tabular-nums` so nothing shifts. Also reused in the chat ctx readout + Run Cinema token stat. |
| **Spotlight Card** (Aceternity/ReactBits — same pattern) | Workspace chips + recent-project rows + quick actions | Mouse-follow radial at 5% `--color-text` (NOT accent — these are neutral rows); accent stays reserved for the primary. |

### Chat surfaces (W5-3)
| Component | Where | Adaptation notes |
|---|---|---|
| **SplitText** (ReactBits) | Empty-hero title | Per-word spring rise on mount (replaces the plain fade); fires once, never on re-render (keyed by session). |
| **CardSpotlight + tilt** (Aceternity) | The four starter-deck cards | Glare follows the mouse at low alpha; tilt capped at ±4° (the 3D-card effect at 10% intensity — full strength is landing-page energy, not cockpit energy). |
| **ShimmerButton treatment** (Magic UI) + **Magnet** (ReactBits) | The send button | Shimmer sweep on hover only (not idle — idle shimmer violates calm); 4px magnetic attraction radius. Keeps `.press`. The ONE accent CTA per §6. |
| **BorderBeam** (Magic UI) | **Busy-pane chrome** — the Activity Glow upgrade | An accent light circulating the pane border while a run streams (replaces the breathing seam); also on the Conductor listening pill. Reduce-motion → the static seam returns. This is the single most "alive" upgrade in the wave. |
| **BlurFade** (Magic UI / motion) | Transcript block entrances | Replaces `fade-in-up` on user/approval/result blocks — same 10px rise + a 4px blur that resolves; streaming surfaces stay unwrapped (the W4 rule holds). |
| **AnimatedList** (Magic UI) | Notifications panel | New items spring in at the top and the stack settles via `layout` — replaces the capped CSS stagger there. |

### Shell, overlays, settings (W5-4)
| Component | Where | Adaptation notes |
|---|---|---|
| **Dock magnify** (Magic UI Dock / Aceternity Floating Dock — one implementation, ours) | **Icons-only sidebar rail** | Cursor-proximity magnification (1.0→1.35, spring) for app icons + open-pane dots. The full-width sidebar keeps its list. This makes collapsed mode feel deliberate instead of cramped. |
| **layoutId sliding indicator** (Aceternity Tabs pattern) | Settings nav rail + palette selection bar | The active-row highlight GLIDES between rows (one shared element) instead of repainting per row — the old §8 "selection accent bar" wish, finally cheap. |
| **Variants stagger** (motion) | Mission Control cards, palette groups on open | Replaces `.stagger`'s nth-child caps with orchestrated `staggerChildren: 0.028` — same cadence, no cap cliff, plays nice with AnimatePresence. |
| **CardSpotlight** (Aceternity) | Mission Control cards | Same low-alpha glare as the starter deck — Exposé cards that respond to the cursor. |
| **Onboarding step transitions** (motion) | Onboarding.tsx | Horizontal slide+fade between steps (`AnimatePresence mode="popLayout"`), progress pips spring their width. |
| **HoverBorderGradient** (Aceternity) | Onboarding's "enter aios" + the workspace-save primary | Accent→highlight rotating border on the surface's ONE primary CTA. Never on neutral controls. |

### Personality layer (W5-5, small + optional toggles)
| Component | Where | Adaptation notes |
|---|---|---|
| **ClickSpark** (ReactBits) | Global on `.press` elements | 4 accent ticks, 300ms, canvas-pooled; behind a new `funFx` setting (default ON, lives next to soundscape) AND reduce-motion. |
| **Confetti burst** (Magic UI confetti, canvas) | Pet celebrate on a long clean run | One 1.2s burst from the pet tile, ≤80 particles, accent+highlight only; rides the same `funFx` + bubble rate-limits — the pet earns it, the app never spams it. |
| **Ripple** (Magic UI) | Behind the idle pet companion when liveness is high | Whisper-faint (3% alpha rings); ties the liveness backdrop to the companion. |
| **Meteors / Shooting Stars / Globe / Marquee / Splash Cursor** | **Rejected** | Pure landing-page energy; fights DESIGN.md §1 calm. Documented so nobody re-litigates. |

## Sequencing

| Session | Contents | Exit gate |
|---|---|---|
| **W5-1 Foundation** | motion + cn + tokens bridge + MotionConfig; AnimatePresence across 7 overlays + pane exit + toasts; delete retired CSS/state | gates green; bundle delta measured & logged |
| **W5-2 Idle showcase** | vanish input, spotlight, dot pattern, blur greeting, number tickers, spotlight rows | light+dark screenshots; reduce-motion sweep |
| **W5-3 Chat** | SplitText hero, starter-deck glare/tilt, shimmer+magnet send, **BorderBeam busy chrome**, BlurFade blocks, AnimatedList notifications | streaming perf spot-check (no fx on token path) |
| **W5-4 Shell** | dock magnify, layoutId indicators (settings + palette), variants staggers, Mission Control glare, onboarding steps | keyboard nav unaffected; traps/ARIA intact |
| **W5-5 Personality + budget** | ClickSpark, pet confetti, ripple, `funFx` setting; full audit: bundle ≤ +60kb gz, ratchet green, light theme, reduce-motion, 60fps with a busy chat + browser pane open | TRACKER verdicts + the wave's measured numbers |

## Verification gates (every session)
`npx tsc --noEmit` · `npm run test:chatpane` (ratchet enforces tokenization of vendored code) · `npm run build` (log the gz delta vs the wave-start baseline) · manual run from the terminal — each fx checked in **both themes** and with **reduce-motion on**, with a browser pane open (native-layer coexistence).

## Risks, called now
- **Two motion systems drifting** → rule 7 + the tokens bridge; W5-1 deletes the CSS it replaces so there's never two owners.
- **Vendored code rot** → every fx file carries `// adapted from <lib> <url> (<date>)` + what changed; they're OURS after adaptation (these libs are MIT, designed for copy-paste).
- **GPU contention with native webviews** → BorderBeam/glare only on chrome strips, never under native layers; the W5-5 60fps check runs WITH a browser pane casting.
- **React 19 compat** → `motion` v12 supports it; Magic UI/Aceternity components occasionally use `forwardRef` patterns React 19 deprecates — adapt during vendoring (ref-as-prop).
