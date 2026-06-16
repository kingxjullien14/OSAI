# AIOS — UI/UX Polish & Onboarding Plan

> A prioritized plan to close the gap between how AIOS is *built* (genuinely strong) and how
> it *feels* (a little unfinished). Derived from a full surface-by-surface audit of the
> current source, cross-checked against [DESIGN.md](DESIGN.md). Every item cites `file:line`.
>
> Scope: (1) the **new-chat page** (top priority), (2) a **first-run onboarding** flow,
> (3) the **homescreen**, (4) the **app shell**, (5) **discoverability**, (6) the **chat
> transcript**, (7) **design-system convergence** across panes, plus a set of cross-cutting
> bugs. A prioritized P0/P1/P2 roadmap is at the end.

---

## Executive summary — why it "feels unpolished"

Six themes explain almost every rough edge. They're in priority order; the roadmap maps to them.

1. **The design system is documented but not adopted.** `App.css` ships canonical utility
   classes — `.hero-title`, `.surface-pop`, `.surface-card`, `.focus-accent`, `.helper-line`,
   `.pill`/`.pill--active`, `.pane-header` — and [DESIGN.md](DESIGN.md) says to build on them.
   Yet they're used in **only ChatPane and MotionPane**; even the "gold-standard" chat
   *reimplements* every one of them inline ([ChatPane.tsx:3151](src/components/ChatPane.tsx#L3151),
   [2708](src/components/ChatPane.tsx#L2708), [3160](src/components/ChatPane.tsx#L3160)). Every
   other pane hand-rolls the chat's patterns and drifts in the details (header heights, radii,
   shadows, title casing). **This is the root cause of the diffuse "a bit off" feeling.**

2. **There is no onboarding, and the app ships a stranger's identity.** `userName` defaults to
   `"faeez"` ([settings.ts:76](src/lib/settings.ts#L76)); the live homescreen never reads it and
   the *dead* greeting hardcodes a *different* literal, `firaz`
   ([IdleDashboard.tsx:575](src/components/IdleDashboard.tsx#L575)); the account row and Jarvis
   copy hardcode `firaz` too. A first run drops you into a cold pane with no name, no CLI choice,
   no MCP review. The provider/detection model is fully designed in
   [providers.ts](src/lib/providers.ts) but **nothing implements or surfaces it.**

3. **The new-chat page leaks complexity instead of being calm.** Before you type a character the
   empty hero stacks a 30px headline, six read-only context chips, a mono token-ledger row, the
   composer, and a helper line — five dense layers, most of them machine telemetry. The default
   placeholder just says `"do anything"`. This is the opposite of the restraint DESIGN.md §1
   prescribes.

4. **Accent discipline is violated almost everywhere.** DESIGN.md §6 reserves orange for
   *primary action / active-selected / focus only*. Today accent leaks onto resting chips, folder
   icons, generic hovers, drop-zone "armed" states, markdown bullets, and ~12 simultaneous buttons
   on the homescreen. When everything is orange, nothing is.

5. **Cross-platform breakage the user hits personally (Windows).** Every shortcut label shows the
   macOS `⌘` glyph though the keys are actually `Ctrl` ([App.tsx:897](src/App.tsx#L897)); MCP
   detection reads `$HOME`, which is empty on Windows; the money-agents seed uses a hardcoded
   `/Users/firazfhansurie` path. These make the daily experience feel broken on the user's own OS.

6. **Empty states, focus states, and affordances are uneven.** The chat has a beautiful empty
   state; most panes inherit none of it. The focused pane has *no* visual indicator. Several
   settings toggles are wired to nothing. Discoverability of core actions (Mission Control,
   permission mode, find-in-chat) is thin.

**The good news:** the architecture is clean (one pane = one component + one lib + one backend
module), the chat's interaction model is excellent, and the design system already exists. Most of
this plan is *convergence and restraint*, not new architecture — a large share are ≤1-day fixes.

---

## 1. New chat page — empty state + composer (TOP PRIORITY)

The chat is the soul of the app and the empty state is the first thing a new chat shows. It's
close, but it fails its own system in specific, fixable ways. Work the four groups below in order.

### 1a. Calm the empty hero (restraint — DESIGN.md §1)

The empty state renders the **same** composer `useMemo` used in the docked state, so a brand-new
chat shows title → 6 context chips → mono "est tok · budget" ledger → input → helper. Three of
those five layers are telemetry that means nothing before the first keystroke.

| Item | Problem | Fix | Sev | Eff |
|---|---|---|---|---|
| Telemetry in the hero | The context-chip row ([ChatPane.tsx:2368](src/components/ChatPane.tsx#L2368)) and est-token ledger ([2433–2448](src/components/ChatPane.tsx#L2433)) render in the empty hero; the ledger always shows ≥`budget:120` so it's never empty. | Gate both rows behind `!empty` (keep them in the docked state where they're useful). The hero becomes **title → composer → helper line** — the assembled pattern from DESIGN.md §5. | **critical** | S |
| Placeholder is empty calories | `"do anything"` ([2804](src/components/ChatPane.tsx#L2804)) answers nothing; only the plan/steer placeholders are actually helpful. | `"ask, or describe a task — / for commands, @ for files"`. Keep the calm lowercase voice. | medium | S |
| No starter actions | The hero asks "what should we work on?" then offers an empty box — no examples, no resume entry where the eye lands. | Add one quiet row of 3–4 `.pill` starter chips (empty state only) that prefill the composer: *explain this codebase · plan a feature · resume a session · run a command*. | medium | M |
| Hero jumps around | `items-center justify-center` ([3149](src/components/ChatPane.tsx#L3149)) re-centers the whole block whenever chips/ledger/ResumedNote/thumbnails toggle, so the title visibly jumps. | Anchor the title+composer pair (e.g. ~40% from top) and let supplementary rows grow downward. Fixing the telemetry rows above mostly resolves this. | low | S |

### 1b. Adopt the canonical classes (stop hand-rolling the signature surface)

The one surface every other pane is told to imitate doesn't use the classes those panes are told
to copy — so drift is guaranteed at the source.

| Item | Problem | Fix | Sev | Eff |
|---|---|---|---|---|
| Hero headline | [3151](src/components/ChatPane.tsx#L3151) hardcodes `text-3xl font-medium tracking-tight text-[var(--color-text)]` — the exact values frozen into `.hero-title`. | `className="hero-title mb-7 text-center"`. Zero visual change; locks it to the token. | medium | S |
| Composer surface | [2708](src/components/ChatPane.tsx#L2708) hardcodes `rounded-2xl … shadow-2xl shadow-black/40` + a bespoke `focus-within` edge — a hand-rolled `.surface-pop` + `.focus-accent`, but with the **wrong** shadow (not the single `--aios-shadow-pop` token) and a `/70` opacity the spec doesn't have. | `className="flash-composer surface-pop focus-accent relative"`; layer `backdrop-blur` on top. Removes ~6 drifted values. | medium | S |
| Helper line | [3160](src/components/ChatPane.tsx#L3160) hand-builds the mono "claude · ready · commands · files" row. | Wrap in `.helper-line` — literally the class's reason to exist (DESIGN.md §5). | low | S |
| Composer pills | model/effort/permission triggers use bespoke `rounded-full` buttons instead of `.pill`/`.pill--active`. `TerminalComposer.tsx` re-invents the same shape ~13×. | Converge all composer chips onto `.pill` + `.pill--active`. One source of truth for resting/active. | medium | M |

> **Net:** this is the single highest-leverage change in the whole plan. The chat stops being a
> one-off and becomes the literal embodiment of the system; every pane that copies it inherits
> correctness for free.

### 1c. Spend accent like the system demands (§6)

Today the litmus test fails — remove all accent and *more than* "primary/active/focus" goes
ambiguous.

- **Resting chips are accent-tinted.** The `cwd`/`attachments`/`queue`/`plan`/`goal` icons
  ([2381–2391](src/components/ChatPane.tsx#L2381)) and the run/memory pills
  ([2418–2428](src/components/ChatPane.tsx#L2418)) wear accent at rest. These are *informational*,
  not active. Demote resting chip icons to `--color-muted`; reserve the `accent-soft` wash for the
  genuinely toggled-on `plan`/`goal`. — *medium · S*
- **Result:** the **send button** ([3010–3019](src/components/ChatPane.tsx#L3010), correctly
  accent-filled) and the **focus edge** become the only orange on the surface — exactly the intent.
- **Replace the hardcoded hex.** [2907](src/components/ChatPane.tsx#L2907)/[2927](src/components/ChatPane.tsx#L2927)
  use literal `text-[#a855f7]` for the ultracode sparkle — DESIGN.md §2 forbids a hex in a
  component. Add a `--color-spark` token (or reuse a semantic one). — *low · S*
- **Single accent button at a time.** During a run the steer/queue accent pill and the danger
  `stop` button can both be filled ([2982–3020](src/components/ChatPane.tsx#L2982)). When a run is
  active, demote steer/queue to a neutral pill so only `stop` (danger) is filled. — *low · S*

### 1d. Affordances & feedback worth polishing

| Item | Problem | Fix | Sev | Eff |
|---|---|---|---|---|
| Dead-looking chips vs hidden controls | The 6 context chips *look* like interactive `.pill`s but have no `onClick`; the real permission/effort/budget toggles hide inside one unlabeled `Wrench` icon ([2827](src/components/ChatPane.tsx#L2827)). Users click "permission:…" and nothing happens. | Pick one model: make the chips the controls (clickable `.pill`s opening their menus) **or** demote them to plain mono text so they don't read as buttons. Give the wrench a label ("options") or split model·effort·access into discrete labeled pills. | high | M |
| Wrong engine label | Empty state hardcodes `"claude · ready"` / `"starting claude…"` ([3161](src/components/ChatPane.tsx#L3161)) — but the **default provider is `codex-cli`** ([settings.ts:97](src/lib/settings.ts#L97)). A Codex user is told "starting claude…" on the very first screen. | Derive from `model.engine ?? "claude"` (or reuse `usageLabel`, which the docked strip already uses). | medium | S |
| No submit hint | The helper lists `/ commands` and `@ files` but never says how to send. | Add `⏎ send · ⇧⏎ newline` to the helper line (the app already uses the `⏎` glyph elsewhere, [App.tsx:2807](src/App.tsx#L2807)); show `⏎ queue` while streaming. | medium | S |
| Helper vanishes after first message | The reassuring affordance line exists **only** in the empty branch; the docked footer ([3250–3298](src/components/ChatPane.tsx#L3250)) has none, so empty vs docked feel like two products. | Render one shared `.helper-line` under the composer in both states (compact when docked). | medium | S |
| Off-brand `/goal` prompt | `/goal` calls native `window.prompt()` ([1995–1999](src/components/ChatPane.tsx#L1995)) — a bright OS modal in a themed near-black app. | Inline editor reusing the queued-edit input pattern ([2626–2643](src/components/ChatPane.tsx#L2626)); click the goal chip to edit. | medium | S |
| No real startup state | While `started === false` the textarea looks fully active (accent caret, focus edge) but `Enter` silently no-ops; failures only surface as a transcript line *after* a send ([1129–1142](src/components/ChatPane.tsx#L1129)). | Show a `Loader2` spinner in the send button + a `.status-dot--idle` by the helper while starting; on a startup **error**, show an inline calm "claude not found — choose a CLI" line linking to onboarding/settings. | high | M |
| Buried attach/dictate | Mic/attach/resume sit in the wrench overflow ([2851–2870](src/components/ChatPane.tsx#L2851)) even on the empty state where discovery matters most. | Surface attach + dictate as inline ghost icon buttons (muted → hover text, §7.2). | low | S |
| Stale-render risk | The composer `useMemo` deps ([3028–3079](src/components/ChatPane.tsx#L3028)) omit `memoryPanelOpen`, `recording`, `runEventCount`/`runPhase` though the body reads them — opening the memory panel can fail to re-render. | Add the missing deps, or drop the memo entirely (it recreates on nearly every keystroke via `input` already). | low | S |

---

## 2. Onboarding — first-run flow (full build spec)

There is **no onboarding** today (`grep onboard|firstRun|welcome` → only the PetPane "hatch"
intro). The infrastructure for a clean one already exists and is unused: [providers.ts](src/lib/providers.ts)
declares a `detect_providers` Rust command + `ProviderStatus` shape "used by onboarding + the
picker" **that was never built**; the MCP reader ([plugins.rs](src-tauri/src/plugins.rs) →
[plugins.ts](src/lib/plugins.ts)) already surfaces `~/.claude.json` servers; and Settings already
has every reusable control (name input, `ThemePicker`, `AccentSwatches`, `Segmented`, `Toggle`).

Design goal: a **calm, skippable, 5-step single-window** flow that feels indistinguishable from
the chat surface — built entirely from existing tokens/utilities.

### 2.1 Settings + flag

Add to `AppSettings` / `DEFAULT_SETTINGS` ([settings.ts:13](src/lib/settings.ts#L13)):

```ts
onboardingComplete: boolean;   // default false → gates the flow
onboardedAt: number | null;    // optional, for analytics
// change userName default "faeez" → "" so a skipped/un-onboarded user never sees a stranger
```

**Veteran migration (important):** `loadSettings()` merges over defaults
([settings.ts:133](src/lib/settings.ts#L133)), so without a guard every existing install would
re-onboard once. In `loadSettings()`, if a persisted blob exists (`raw !== null`) but lacks
`onboardingComplete`, set it `true` — only genuinely empty `localStorage` triggers the flow.

### 2.2 Trigger & mount

In `App()` add state next to `settingsOpen` ([App.tsx:308](src/App.tsx#L308)):
`const [onboardingOpen, setOnboardingOpen] = useState(() => !loadSettings().onboardingComplete)`.
Render a sibling overlay right after the Splash line ([App.tsx:1577](src/App.tsx#L1577)), gated on
`!splash` so the mascot plays first, then onboarding fades in (respecting
`data-reduce-motion`). On finish/skip: `saveSettings({ onboardingComplete: true, onboardedAt: … })`
and `setOnboardingOpen(false)`. Esc/backdrop = skip-and-persist (mirror Settings'
[838–847](src/components/Settings.tsx#L838)). Re-openable via a "replay setup" Row in Settings →
general (near the name field, [Settings.tsx:914](src/components/Settings.tsx#L914)).

### 2.3 The five steps

Each step is a centered `.surface-pop` card (max-w ~420px) on the `bg` ground with a backdrop blur
(reuse Settings' backdrop pattern, [Settings.tsx:855](src/components/Settings.tsx#L855)). Shared
`<StepShell>` chrome: 5 status-dot progress pips, a `.hero-title` slot, a body slot, and a footer
(skip text-button left, **one** accent "continue" button right). Copy is lowercase/calm.

| # | Step | What it sets | Implementation | Backend |
|---|---|---|---|---|
| 0 | **welcome** | — | `.hero-title` "welcome to aios" + one `text-2` line + accent "get started" + faint "skip setup". Mascot at `h-16 w-16` (as in Settings about, [Settings.tsx:1278](src/components/Settings.tsx#L1278)). | none |
| 1 | **your name** | `userName` | A large composer-style input (`--aios-text-lg`, `.focus-accent`), **not** the tiny 160px Settings field — this is the hero field. Helper "shown in your homescreen greeting". Prefill from OS user if available; skip → greeting falls back to "there", never "faeez". | optional: reuse `files::home_dir` ([files.rs:593](src-tauri/src/files.rs#L593)) for a default |
| 2 | **choose your engine** | `chatProvider`, `chatModel`, `defaultAi` | Vertical `.surface-card` list, one per tier-1 CLI from `PROVIDERS` ([providers.ts:92](src/lib/providers.ts#L92)): label + `note` + a status dot — `.status-dot--active` "installed" / `.status-dot--cold` "not found". Selected card → `.pill--active`. Auto-select the first **detected** provider so the happy path is one click. A quiet "or use an API key / free model" disclosure for tier-2/3. Derive `defaultAi` (`claude-cli`→`claude-code`, `codex-cli`→`codex-code`, else `chat`). | **new `detect_providers`** (see 2.4) |
| 3 | **connect MCPs** | — (review) | Reuse PluginsPane's connected-MCP chip block ([PluginsPane.tsx:79–95](src/components/PluginsPane.tsx#L79)). If servers exist: "aios found N connected servers" + chips with green dots. If none: a calm `.surface-card` empty state — `Plug` icon, "no MCP servers yet", a faint mono hint with the literal path `~/.claude.json` and `claude mcp add <name> …`. Ghost "open plugins" deep-link + a "recheck" button that re-invokes `listPlugins()`. Never blocks. | reuse `plugins::list_plugins` ([plugins.rs:107](src-tauri/src/plugins.rs#L107)) — **fix the Windows `HOME` bug first (2.4)** |
| 4 | **make it yours** | `theme`, `accent` | Drop in the **existing** `ThemePicker` ([Settings.tsx:314](src/components/Settings.tsx#L314)), `AccentSwatches` ([419](src/components/Settings.tsx#L419)), and `AppearancePreview` ([534](src/components/Settings.tsx#L534)) so changes are felt live. Summary line "chatting with {provider} · greeting {name}". Primary button → "enter aios". | none — `setTheme`/`setAccent` apply live |

**Component:** new `src/components/Onboarding.tsx` exporting `<Onboarding onClose={…}/>`, mirroring
Settings' overlay structure. Local draft `{userName, chatProvider, defaultAi, theme, accent}`;
each step's "continue" commits via the existing stores. **Export (don't reimplement)**
`ThemePicker`/`AccentSwatches`/`AppearancePreview`/`Segmented` from Settings (lift to a shared
module) and the MCP chip block from PluginsPane. New `detectProviders()` helper in
[providers.ts](src/lib/providers.ts) wrapping `invoke('detect_providers')`.

### 2.4 The two backend pieces

1. **`detect_providers` (new Rust command).** The shape is already declared
   ([providers.ts:210–220](src/lib/providers.ts#L210)). For each tier-1 CLI, probe its `bin`
   (claude/codex/gemini/opencode) — **reuse the battle-tested resolvers** `which_on_path`
   ([chat.rs:209](src-tauri/src/chat.rs#L209)) + the known-install-dir fallbacks in `claude_bin`
   ([chat.rs:169–205](src-tauri/src/chat.rs#L169)) and `resolve_bin`
   ([chat.rs:223–244](src-tauri/src/chat.rs#L223)). This matters because **GUI-launched Tauri apps
   don't inherit the shell PATH**, so a naive `which` reports installed CLIs as missing. Return
   `{id, available, detail: resolvedPath}`. For tier-2 API providers, check the `keyEnv` vars.
   Register in [lib.rs:91](src-tauri/src/lib.rs#L91) next to `list_plugins`. **Fallback when none
   found:** pre-select the `free` tier-3 provider and show "no agent cli detected — use the free
   model now or install one later"; never dead-end. This command also lets the model picker gray
   out engines the user doesn't have (today `CHAT_MODELS` lists all engines unconditionally,
   [chat.ts:215](src/lib/chat.ts#L215)).

2. **Fix MCP detection on Windows.** `read_mcps()` uses `std::env::var_os("HOME")`
   ([plugins.rs:91](src-tauri/src/plugins.rs#L91)); Windows has no `HOME`, so step 3 (and the
   Plugins pane) silently show nothing on the user's OS. Use a home resolver (`dirs::home_dir()` /
   `USERPROFILE` fallback) — the same pattern [WINDOWS.md](WINDOWS.md) already applies elsewhere.
   Audit other panes for the same `var("HOME")` assumption.

### 2.5 Edge cases (already designed-for)

No CLI at all → free tier + calm note, `defaultAi: "chat"`. No `~/.claude.json` → `read_mcps`
already returns empty → step shows the empty state and continues. Non-Tauri web mirror
(`nativeRuntime === false`, [App.tsx:299](src/App.tsx#L299)) → wrap `invoke` in try/catch, skip the
dots, allow manual pick, default to free. Skip on the name step → still persist
`onboardingComplete: true`, greeting shows "there". `splashOnLaunch: false` → gate on
`onboardingComplete`, not on the splash having played.

---

## 3. Homescreen / idle dashboard

The landing surface is in a **broken mid-refactor state**: [IdleDashboard.tsx:184](src/components/IdleDashboard.tsx#L184)
returns `<IdleControlCenter/>`, so the entire polished bento implementation below it (greeting,
omni-input, graceful per-source empty states, the "never a lying number" design its own header
comment describes) is **unreachable dead code**. The surface that actually ships —
`IdleControlCenter` — is denser, jargon-heavy, and degrades badly for a new user.

**First decision: pick one home surface.** The bento ([IdleDashboard.tsx:210–463](src/components/IdleDashboard.tsx#L210))
is closer to DESIGN.md. Either revive it (delete the early return; port the useful control-center
lanes in as tiles) **or** commit to the control center and delete ~250 lines of dead bento so the
next engineer isn't misled. Stop maintaining two and shipping the worse one.

Then fix the live surface:

| Item | Problem | Fix | Sev | Eff |
|---|---|---|---|---|
| No greeting | The home opens with a static "aios control center" / "jarvis routes the work" slogan — no name, no time ([IdleControlCenter.tsx:76–78](src/components/IdleControlCenter.tsx#L76)). | Time-of-day + `userName` + date greeting (the dead `Greeting`, [IdleDashboard.tsx:570–579](src/components/IdleDashboard.tsx#L570), already does this — port it). `--aios-text-title`, mono-muted date. | high | S |
| Phantom agents | `MONEY_AGENTS` hardcodes 3 "sales agents" for every install with macOS paths under `/Users/firazfhansurie` ([moneyAgents.ts:55](src/lib/moneyAgents.ts#L55)); the "firaz" agent is forced to `health:"running"` even with no state file ([summarizeMoneyAgentState:322](src/lib/moneyAgents.ts#L322)). A new user sees another person's business presented as their live fleet. | Gate seeded agents behind real state-file existence; show an action-oriented empty state ("no agents yet — create one"). Derive home from the OS, never a hardcoded path. | **critical** | M |
| Lying numbers | `PulseIdentityBand` renders eight 22px `—` tiles for a user with no history; `ControlCenterCharts` seeds a **fake** 14-bar trend `[2,5,3,7,8,…]` ([ControlCenterCharts.tsx:113](src/components/dashboard/ControlCenterCharts.tsx#L113)). | Collapse the band to one onboarding line ("your activity will appear here after your first session") when empty; drop the fabricated trend array and render an honest empty state. | high | S |
| No "do work" action | The chat-first app's home has no "new chat" / terminal / browser launcher — only monitoring CTAs ([IdleControlCenter.tsx:122–153](src/components/IdleControlCenter.tsx#L122)). | Add a prominent "new chat" primary (the one button that earns the accent) + a small core-tool dock. | high | M |
| Accent spray | A dozen accent-filled buttons compete at once — "run pulse" on every agent card, "talk to jarvis" on every notification ([AgentOperationsLane.tsx:87](src/components/dashboard/AgentOperationsLane.tsx#L87), [NotificationCommandLane.tsx:45](src/components/dashboard/NotificationCommandLane.tsx#L45)). | One primary action per region; demote the rest to neutral `.pill`/ghost. | high | M |
| Square cards | Every lane card is a `border … bg-panel/30` with **0px corners** ([JarvisBriefingLane.tsx:30](src/components/dashboard/JarvisBriefingLane.tsx#L30), etc.) — harsher than the chat's rounded surfaces. | Wrap in `.surface-card` (panel-2, 12px). | high | M |
| Jargon copy | "jarvis routes the work", "approval aging", "broker between firaz and agents", "control all" read like an internal ops dashboard. | Plain user-facing copy: "your agents, projects, and activity at a glance", "waiting for you", "manage agents". Move persona into tooltips. | medium | S |
| Duplicate heatmap | The 70-day heatmap renders **twice** (in both `PulseIdentityBand` and `ControlCenterCharts`) with two different cell radii. | Render once; share one component; use `rounded-[var(--aios-radius-xs)]`. | low | S |
| No focus ring | Interactive tiles set `role="button"` but have no `:focus-visible` ([IdleDashboard.tsx:490](src/components/IdleDashboard.tsx#L490)). | Apply `.focus-accent` to tiles + lane buttons. | medium | S |

---

## 4. App shell — sidebar, pane grid, chrome, account

| Item | Problem | Fix | Sev | Eff |
|---|---|---|---|---|
| **Focused pane is invisible** | `PaneCard`'s `active` prop only gates webview painting; it produces **zero** visual change ([App.tsx:3141](src/App.tsx#L3141)). In a 2×2 grid nothing shows which pane keyboard/dictation/drops target — DESIGN.md §6's "which is selected" promise broken. | When `active && !overlayOpen`, give the chrome a restrained accent edge (`ring-1 ring-[var(--color-accent)]/40`, the same recipe the OPEN row uses at [App.tsx:3003](src/App.tsx#L3003)). | **critical** | S |
| Non-token chrome strip | The PaneCard strip uses `h-7 … bg-white/[0.02]` ([App.tsx:3157](src/App.tsx#L3157)) — a raw height and a hardcoded white-alpha wash that breaks in light theme. | `h-[var(--aios-h-chrome)] bg-[var(--color-panel)]`; keep the mono-11px-muted label (it matches `.pane-header__title`). | high | S |
| 7 cramped icons, no overflow | The 28px strip can show monitor·open-as·hide·move-left·move-right·maximize·close — seven 12px targets, with two near-identical `MoveRight` glyphs ([App.tsx:3250](src/App.tsx#L3250)/[3260](src/App.tsx#L3260)). | Show only close + maximize at rest; collapse the rest into the `⋯` "pane menu", revealed on `group-hover`. Replace the twin arrows with distinct glyphs or a single menu entry. | high | M |
| No drag-to-move panes | The grid only reorders via two arrow buttons over a flat array ([movePaneByKey:352](src/App.tsx#L352)); you can't drag a pane to a cell. The brief implies drag-to-move. | Make the title strip a drag handle that swaps/inserts on drop, reusing PaneDropZone's accent dashed overlay for the live target. | high | L |
| Mission Control undiscoverable | Reachable only via a 15px `Layers` icon in the **default-hidden** top bar or an undocumented `⌘\`` ([App.tsx:1524](src/App.tsx#L1524), [919](src/App.tsx#L919)); silently no-ops with 0 panes. | Surface a persistent "N panes" pill near the OPEN header when 2+ are open; add the shortcut to the tooltip; disable+dim (not silent no-op) at 0. | high | M |
| Hidden top bar hides essentials | Default `topBarMode: "hidden"` collapses palette, overview, voice, appshot, **notifications (with unread badge)** into an `opacity-0` pill revealed by a 5px hover strip ([App.tsx:1579–1591](src/App.tsx#L1579)). New users can't find any of it, and can't see unread alerts. | Pin two essentials that must stay reachable — the notifications bell (with badge) and palette/search — as small persistent affordances (e.g. sidebar footer near settings, [App.tsx:1648](src/App.tsx#L1648)). Reserve hover-reveal for secondary actions. | high | M |
| Hardcoded identity | `AccountMenu` hardcodes "firaz" / "adletic · owner" / avatar "f" ([AccountMenu.tsx:100](src/components/AccountMenu.tsx#L100),[118](src/components/AccountMenu.tsx#L118)); the wrapper is a non-button `<div>` styled like a button. | Read name/org from settings (set during onboarding); derive monogram+alt from the first initial; make the whole row one button to settings. | medium | S |
| Over-segmented sidebar | OPEN list + SidebarRail (tools/pinned/custom spaces, each with its own header + `border-t`) + OracleRoster + MoneyAgents stack 6+ uppercase headers and hairlines in a 240px rail. | Drop redundant dividers between adjacent system spaces; only render OracleRoster/MoneyAgents when non-empty; widen gaps *between* modules, tighten *within*. | medium | M |
| Icons-only rail unlabeled | In `iconsOnly` mode spaces become bare chevrons with no name/title/count ([App.tsx:2155–2168](src/App.tsx#L2155)). | Add `title={space.name}`; a 1px tick or first-letter glyph to distinguish spaces. | medium | S |
| No brand / home anchor | The `aios` wordmark shows only in the splash; the rail is headerless and there's no one-click "go home" (you must close every pane). | Small sidebar header with the mono `aios` wordmark that minimizes all panes → idle dashboard. | low | S |
| Drop-zone accent leak | PaneDropZone paints `accent/40 + accent/5` while merely *armed* ([PaneDropZone.tsx:64](src/components/PaneDropZone.tsx#L64)); overview hover turns border+text accent ([App.tsx:2812](src/App.tsx#L2812)). §6 forbids accent on armed/hover. | Neutral `--color-border-strong` for armed; reserve the accent dashed border for the actual `over` state. Hover lifts to border-strong/text, not orange. | medium | S |
| Maximized = trapped feeling | A maximized pane covers the bar+sidebar; the only exits are one tiny restore icon and undocumented Esc ([App.tsx:950](src/App.tsx#L950)). | Brief auto-fading "esc to restore" `.helper-line`; "Restore (Esc)" in the tooltip; make the restore button more prominent while maximized. | medium | S |
| Invisible resize gutters | Drag handles are `opacity-0` until hovered ([ResizableGrid.tsx:136](src/components/ResizableGrid.tsx#L136)); no double-click-to-reset; no floor feedback. | Faint resting handle; double-click a gutter resets its two tracks to equal. | low | S |

---

## 5. Discoverability — command palette & keybindings

The `⌘K` palette is the **best-built surface in the app** (self-contained fuzzy matcher, grouped
ranked results, charming empty state). The story around it is what's thin — and it's outright
**broken on Windows.**

| Item | Problem | Fix | Sev | Eff |
|---|---|---|---|---|
| **`⌘` shown, `Ctrl` required** | The handler treats `metaKey \|\| ctrlKey` as the modifier ([App.tsx:897](src/App.tsx#L897)) but **every** label hardcodes the macOS `⌘` glyph — tooltips, palette subtitles, the Settings cheat-sheet, idle hints, overview chips ([appCommands.ts:138](src/lib/appCommands.ts#L138), [Settings.tsx:656](src/components/Settings.tsx#L656), [IdleDashboard.tsx:460](src/components/IdleDashboard.tsx#L460)). No platform detection exists. A Windows user is told to press keys their keyboard lacks. | Add one `lib/platform.ts` (`MOD_LABEL = isApple ? "⌘" : "Ctrl"`, `fmtChord()`); render every hint through it. | **critical** | M |
| Dead `hotkeys` metadata | Commands declare `hotkeys: ['mod+b']` ([commands.ts:26](src/lib/commands.ts#L26)) but **nothing binds them** — the real shortcuts are a hand-written switch in App.tsx. Two sources of truth that silently diverge. | Either delete the field, or (better) build the small dispatcher it anticipates: one `useEffect` that parses the registry against the event. Then the switch, the palette chip, and a rebinding UI share one source. | high | L |
| Half the cheat-sheet missing | Settings → shortcuts lists only 6 of ~15 ([Settings.tsx:655–662](src/components/Settings.tsx#L655)); `⌘R`/`⌘F`/`⌘M`/`⌘1-9`/`⌘\``/`F5`/`⌘J` + per-pane keys are absent and hand-maintained. | Generate it from the command registry, grouped by scope, rendered through the platform formatter. | high | M |
| No ⌘K coachmark | The palette is the gateway to everything but a new user is never told it exists in a way they can't miss. | A one-line dismissible coachmark on the idle omni-input ("press Ctrl+K to launch anything"), gated on a localStorage flag (mirror `PET_ONBOARDING_KEY`). | high | M |
| No recent/MRU | Empty query shows fixed registry order; nothing floats up frequent actions ([CommandPalette.tsx:133](src/components/CommandPalette.tsx#L133)). | Persist a small MRU map; show a "recent" group when the query is empty; recency tiebreaker on scoring. | medium | M |
| Dead-end no-results | A true no-match shows only the mascot; the powerful "ask aios" / "deep search" intents vanish exactly when the user is stuck ([CommandPalette.tsx:278](src/components/CommandPalette.tsx#L278)). | Keep the AI-intent rows alive in the empty state; phrase it as an offer ("no command matches — ask aios instead?"). | medium | S |
| Palette invisible to SR | Plain `<div>`/`<input>`/`<button>` with **zero** ARIA on the primary discovery surface ([CommandPalette.tsx:244](src/components/CommandPalette.tsx#L244)). | Standard combobox/listbox: `role=dialog/combobox/listbox/option`, `aria-selected`, `aria-activedescendant`, an `aria-live` count. No visual change. | medium | M |
| Greedy fuzzy match | First-match-no-backtracking ([CommandPalette.tsx:36](src/components/CommandPalette.tsx#L36)) drops valid matches and mis-ranks. | Backtracking subsequence / small fzy-style DP over the optimal alignment; keep the good scoring heuristics. | medium | M |
| Thin keyboard nav | Only Arrow/Tab/Enter/Esc ([CommandPalette.tsx:213](src/components/CommandPalette.tsx#L213)); no Home/End/PageUp/Down or Ctrl+N/P. | Add them — cheap, makes it feel native to keyboard-first users. | low | S |

---

## 6. Chat transcript — streaming, tool cards, bubbles

The transcript largely earns its "gold standard" status (activity-group model, sticky-pause
autoscroll, partial-stream-safe markdown, the live "Working…" timer). The gaps are about **failure
clarity, safety, and missing affordances.**

| Item | Problem | Fix | Sev | Eff |
|---|---|---|---|---|
| **Errors look like success** | Every failure (`command not found`, "send failed", interrupt) is pushed as a `kind:"result"` turn rendered by `ResultFooter` **identically** to a benign "1.2s · 340 tok" footer — no danger color, icon, or retry ([ChatPane.tsx:3832](src/components/ChatPane.tsx#L3832), fed by [1134](src/components/ChatPane.tsx#L1134)/[1269](src/components/ChatPane.tsx#L1269)). Users miss real failures. | Add a `kind:"error"` block (or detect error text): left-aligned `.surface-card` with a `--color-danger` hairline + `AlertTriangle`, message in `text-2`, and a "Retry" ghost button → `regenerate()`. Keep the calm footer only for the benign line. | **critical** | M |
| Approval under-shows the command | The args preview truncates to 80 chars ([previewArgs:297](src/components/ChatPane.tsx#L297)) **then** the row `truncate`s again ([4106](src/components/ChatPane.tsx#L4106)). For a Bash approval the most safety-critical field can be fully hidden (a `&& rm -rf` tail past 80 chars is invisible). | Render the gated input with the transcript's own rich detail (the `$ command` pre, the diff) in a scrollable multi-line `pre`, or a "show full" toggle. Never clip the field the decision depends on. | high | M |
| "Regenerate from here" lies | Every UserBubble shows a "regenerate from here" button ([3901](src/components/ChatPane.tsx#L3901)) but `regenerate()` always replays the **global** last message ([1793](src/components/ChatPane.tsx#L1793)), ignoring which bubble. | Either only show it on the **last** user turn (relabel "regenerate response"), or implement true "from here" (truncate transcript to that turn, re-dispatch `turn.text`). | high | M |
| No edit-and-resend | The most common correction — tweak my prompt and resend — is impossible; only copy + the misleading regenerate exist ([3880–3913](src/components/ChatPane.tsx#L3880)). | Add a `Pencil` button that loads `turn.text` into the composer (+focus), ideally truncating to that point. | medium | M |
| No find-in-chat | Long sessions have jump-to-latest but no search; browser Ctrl-F can't reveal collapsed thinking/activity blocks ([3179](src/components/ChatPane.tsx#L3179)). | Lightweight in-pane find (Cmd-F when focused): a `.surface-pop` input that scrolls to + highlights matches and force-expands collapsed blocks containing a hit. | medium | L |
| No copy on tool output | `CodeBlock` in prose has a copy button but tool stdout/stderr, the Bash command, Write previews, and diffs don't ([3537](src/components/ChatPane.tsx#L3537), [3564](src/components/ChatPane.tsx#L3564), [3634](src/components/ChatPane.tsx#L3634)). | Add the existing `CopyButton` (size 12, faint) to those blocks. | medium | S |
| No timestamps | Neither user nor assistant messages carry any time; for multi-minute turns and resumed-days-later sessions there's zero temporal orientation. | A very quiet hover timestamp (faint mono) on the action row; a "— resumed 14:32 —" divider for resumed sessions. | medium | M |
| Resolved approval drops context | Once resolved, the card collapses to "bash · allowed" — the args you approved vanish ([4069](src/components/ChatPane.tsx#L4069)), so the transcript isn't auditable. | Keep a faint truncated args echo on the verdict line. | low | S |
| Accent bullet decoration | Markdown unordered-list bullets render in `--color-accent` ([4265](src/components/ChatPane.tsx#L4265)) — decoration, §6 violation (the ordered-list "1." correctly uses faint). | Recolor bullets to `--color-faint`. | low | S |
| Off-token body size | Assistant prose is `text-[14.5px]` ([4020](src/components/ChatPane.tsx#L4020)) vs the 14px `--aios-text-body` and the UserBubble's 14px. | Use `var(--aios-text-body)`; keep user/assistant body sizes consistent. | low | S |

---

## 7. Design-system convergence — secondary panes

The secondary panes are individually competent but collectively drift, because the utility classes
are almost entirely unused outside ChatPane/MotionPane. Treat this as one **mechanical convergence
sweep** — most items are find-replace.

| Item | Where (examples) | Fix |
|---|---|---|
| Hand-rolled headers | Files/Memory/Database/Plugins/Automations/Bridges/CRM/Status all hand-roll their top bar with different heights/padding/title voice ([FilesPane.tsx:172](src/components/FilesPane.tsx#L172), [MemoryPane.tsx:219](src/components/MemoryPane.tsx#L219), [PluginsPane.tsx:48](src/components/PluginsPane.tsx#L48), …) | `.pane-header` + `.pane-header__title` (36px, px-3, mono-11px-muted) everywhere. |
| `text-white` on accent fills | Memory/Database/CRM/Motion save & action buttons ([MemoryPane.tsx:495](src/components/MemoryPane.tsx#L495), [DatabasePane.tsx:461](src/components/DatabasePane.tsx#L461), [CrmPane.tsx:93](src/components/CrmPane.tsx#L93), [MotionPane.tsx:508](src/components/MotionPane.tsx#L508)) — breaks contrast for light/yellow user accents. | `text-[var(--color-accent-fg)]` (luminance-aware) — matches the chat send button. |
| Accent on neutral hovers | Notes/Bridges/CRM/Database neutral buttons turn orange on hover ([NotesPane.tsx:198](src/components/NotesPane.tsx#L198), [BridgesPane.tsx:207](src/components/BridgesPane.tsx#L207), [DatabasePane.tsx:469](src/components/DatabasePane.tsx#L469)). §6 violation. | `hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]` (the `.pill:hover` recipe). |
| Bespoke focus borders | `focus:border-[var(--color-accent)]/60` ad-hoc on inputs ([MemoryPane.tsx:454](src/components/MemoryPane.tsx#L454), Database). | `.focus-accent` on the wrapper. |
| Hardcoded hex | FilesPane `GIT_COLOR` ([28–34](src/components/FilesPane.tsx#L28)); MemoryGraph3D node hex ([11–16](src/components/MemoryGraph3D.tsx#L11)) — and the 2D MemoryPane colors the same types differently. | Files → `--color-warning/success/danger/info`. Graph → read CSS vars via `getComputedStyle` (three.js needs concrete colors) so 2D and 3D legends match. |
| Non-token radii / shadows | Bare `rounded`/`rounded-md`/`rounded-lg` + `shadow-2xl` across Status/Bridges/Database/Plugins modals ([DatabasePane.tsx:737](src/components/DatabasePane.tsx#L737), [StatusPane.tsx:185](src/components/StatusPane.tsx#L185)). | `.surface-card` (12px) for discrete content; `.surface-pop` (16px + `--aios-shadow-pop`) for modals/menus. |
| Resting accent chips | Plugins wraps every connected-MCP chip in `accent/30 + accent-soft` at rest ([PluginsPane.tsx:88](src/components/PluginsPane.tsx#L88)); Automations/Bridges chips are bespoke `rounded-full bg-bg`. | `.pill` for resting; `.pill--active` only for genuinely active. |
| Inconsistent empty states | A grab-bag; several double-dim a token via `text-[var(--color-muted)]/60` ([FilesPane.tsx:227](src/components/FilesPane.tsx#L227), Memory, Plugins, Automations). | One convention: centered, `--color-faint`, optional 28px icon + a single neutral CTA pill (mirror NotesPane's designed block). |
| FilesPane accent folders | All folder icons are `accent/80` and dirty-dots are accent ([299](src/components/FilesPane.tsx#L299), [321](src/components/FilesPane.tsx#L321)) — competes with the selected-row accent. | Folders `--color-muted` at rest; dirty dot `--color-warning`; accent only marks the selected row. |
| Mixed title casing | lowercase-mono vs Title-sans vs UPPERCASE-tracked across panes ([FilesPane.tsx:178](src/components/FilesPane.tsx#L178), Memory, Plugins). | Codify in DESIGN.md §5: pane titles = lowercase mono muted; section dividers = uppercase tracked muted; never UPPERCASE a primary title. |

---

## 8. Cross-cutting bugs (independently verified)

These aren't taste — they're settings/flags that don't do what they claim.

- **`splashOnLaunch` is a dead setting.** The splash always shows (`useState(true)` +
  unconditional 850ms timeout, [App.tsx:307](src/App.tsx#L307)/[426](src/App.tsx#L426)); the toggle
  at [Settings.tsx:1048](src/components/Settings.tsx#L1048) changes nothing. Either gate the initial
  state on the setting or remove the toggle.
- **Font-size slider & density are non-functional.** `--app-font-scale`
  ([Settings.tsx:295](src/components/Settings.tsx#L295)) and `data-density`
  ([Settings.tsx:276](src/components/Settings.tsx#L276)) are *set* but never *consumed* — no CSS
  reads them and `TerminalPane` hardcodes 13px. Either wire them up (have surfaces read the scale /
  add `[data-density]` rules) or hide the controls until they work.
- **Appearance settings only apply when Settings mounts.** `applyFontScale`/`applyReduceMotion` run
  in a Settings effect ([830–831](src/components/Settings.tsx#L830)), not at app boot — so on a
  fresh launch reduce-motion/font-scale aren't applied until the user opens Settings once. Move
  these `apply*` calls into the boot path next to `initTheme` ([App.tsx:70](src/App.tsx#L70)).
- **Identity is triple-sourced and inconsistent:** default `faeez`
  ([settings.ts:76](src/lib/settings.ts#L76)), greeting literal `firaz`
  ([IdleDashboard.tsx:575](src/components/IdleDashboard.tsx#L575)), account row `firaz`
  ([AccountMenu.tsx:118](src/components/AccountMenu.tsx#L118)). After onboarding, single-source all
  three from `settings.userName`.
- **Loud-by-default for a "calm" app:** `flashLevel` defaults to `"lush"`
  ([settings.ts:85](src/lib/settings.ts#L85)) — the loudest ambient-motion composer greets a brand
  new user. Default `"calm"`; let users opt up.

---

## Prioritized roadmap

### P0 — quick wins (≤1 day each, do this week)

These are high-value, low-risk, mostly find-replace. Knocking them out will visibly lift the polish.

> **Status: ✅ 100% complete** — shipped in Session 1 (font-scale/density wired for real in
> Session 7). The Windows-MCP item was a *verified false positive*: detection already works via the
> `HOME`→`%USERPROFILE%` alias at [lib.rs](src-tauri/src/lib.rs) boot, so no code change was needed.

- [x] **Identity:** read `loadSettings().userName` in the greeting + AccountMenu + Jarvis copy; remove the `firaz` literals; default `userName` → `""` (fallback "there").
- [x] **Windows MCP:** *false positive* — already resolved via the boot-time `HOME`→`%USERPROFILE%` alias.
- [x] **Empty hero:** gate the context-chip row + est-token ledger behind `!empty`.
- [x] **Canonical classes in chat:** `.hero-title`, `.surface-pop`+`.focus-accent`, `.helper-line`; dropped the bespoke `shadow-2xl`.
- [x] **Engine label:** derive from `model.engine ?? "claude"` so Codex users don't see "starting claude…".
- [x] **Placeholder + submit hint:** "ask, or describe a task — / for commands, @ for files" + `⏎ send · ⇧⏎ newline`.
- [x] **Accent discipline pass:** resting chip icons → `--color-muted`; markdown bullets → faint; `#a855f7` → `--color-spark` token.
- [x] **Focused pane ring:** soft accent edge on the active PaneCard.
- [x] **Chrome strip token:** `h-[var(--aios-h-chrome)] bg-[var(--color-panel)]`.
- [x] **Error footers:** danger tint + `AlertTriangle` so failures don't look like completions.
- [x] **Homescreen honesty:** deleted the fabricated `TrendBars` array; collapsed the `—`-wall band to an onboarding line.
- [x] **Defaults:** `flashLevel: "calm"` for new installs.
- [x] **Settings honesty:** `splashOnLaunch` gated; **font-scale + density wired for real** (Session 7) — terminal honors `terminalFontSize`, `[data-density="compact"]` tightens the tokens.
- [x] **Platform labels:** `lib/platform.ts` → `Ctrl` on Windows everywhere.

### P1 — next (the substantive features)

> **Status: ✅ 100% complete** — every item below shipped across Sessions 3–6.

- [x] **Implement `detect_providers`** (Rust) — new [providers.rs](src-tauri/src/providers.rs) (`detect_providers` command, registered in lib.rs), probing CLI bins on PATH + per-user install dirs (GUI launches miss the shell PATH) and API key envs. Frontend wrapper [providerDetect.ts](src/lib/providerDetect.ts).
- [x] **Build the onboarding flow** (§2): [Onboarding.tsx](src/components/Onboarding.tsx) (5 steps), `onboardingComplete`/`onboardedAt` in [settings.ts](src/lib/settings.ts) with the veteran back-fill migration, mounted after the splash in [App.tsx](src/App.tsx), re-openable via "replay setup" in Settings → general.
- [x] **Settings → chat engine UI:** new "chat" section — engine + model selects + send-to-AI routing (the previously persisted-but-unrenderable `chatProvider`/`chatModel`/`defaultAi`).
- [x] **Decide & fix the homescreen:** committed to **IdleControlCenter** as the single home surface — the decision is now documented at the [IdleDashboard.tsx](src/components/IdleDashboard.tsx) early-return and enforced by a guard test. Added a **"new chat"** accent primary + a core-tool dock (terminal/browser/files/notes); **gated phantom money-agents** behind real on-disk state so a fresh install no longer shows a stranger's sales fleet, with an action-oriented "no agents yet — create one" empty state. *(Physical deletion of the unreachable bento prototype is folded into the §7 sweep: it interleaves the live `Ring`/`heatColor`/`fmtNum`/`shortModel`/`shortDate` helpers that PulsePane imports, so they must be extracted first — a blind delete would break PulsePane.)*
- [x] **Gray out unavailable engines in the model picker** — ChatPane now runs `detect_providers` on mount and grays models whose engine CLI isn't on PATH ("not installed"), so a user can't pick a CLI they don't have.
- [x] **Chat safety/affordances:** error footers get a **Retry** (re-dispatch mid-session, or repopulate the composer if the session never came up); "regenerate from here" now shows only on the **last** user turn, honestly labeled "regenerate response"; **edit-and-resend** (Pencil) loads a past message back into the composer; the approval card shows the **full** gated Bash command in a scrollable pre (no more silent 80-char clip); copy buttons added to tool stdout/stderr + the Bash command.
- [x] **Startup feedback:** when the active engine's CLI isn't on PATH, the empty state shows "<engine> not found on PATH · choose a CLI" (→ onboarding) instead of letting the first send fail with raw stderr.
- [x] **Composer controls:** the wrench is now a labeled **"options"** pill (was a mystery icon); **attach + dictate** are surfaced as inline composer buttons (out of the overflow menu); a quiet row of **starter chips** (explain this codebase · plan a feature · summarize recent changes · run a command) prefills the empty-hero composer.
- [x] **Top-bar fallback:** with the bar hidden (the default), the sidebar footer now pins **search** + a **notifications bell** (with unread badge) so they stay reachable without the hover-reveal pill.
- [x] **Mission Control discoverability:** a persistent **"N panes"** pill in the OPEN-rail header opens the overview (shown at 2+ panes); the top-bar Layers button now carries the shortcut in its tooltip and **dims/disables at 0** panes instead of silently no-opping.
- [x] **Palette:** dismissible **⌘K coachmark** on the home; **MRU "recent"** group on empty query; **actionable no-results** (keeps the "ask aios / deep search" intents alive); full **ARIA** (combobox/listbox/option + live count); **backtracking** fuzzy matcher (DP over all alignments) + Home/End/PageUp-Down/Ctrl-N-P nav.

### P2 — later (depth & convergence)

> **Status: ✅ complete (Session 9).** Every P2 item is now done or has a documented engineering
> reason for the call made. Shipped across Sessions 7–9: drag-to-move panes (pointer-driven + swap),
> find-in-chat (`⌘F`) + transcript timestamps, the generated cheat-sheet **plus a full rebinding UI**,
> density/font-scale + resize-gutter reset, pane-header convergence, the fluidity motion layer, the
> provider-base sweep, the design-system sweep (contrast + accent discipline + tokenized shadows +
> empty-state convention) **with a CI lint guard**, sidebar home anchor + icons-only labels, and the
> PaneDropZone accent-leak fix. The two "non-issues" (shared `DropOverlay`, sidebar only-render-
> non-empty) were assessed and resolved with a documented rationale rather than a speculative change.

- [x] **Provider-base sweep** (§10): the base now **follows the user's chosen CLI** — `baseModelId(provider)` selector, single `defaultAiForProvider()` reused by onboarding + Settings, engine-neutral copy, the legacy claude→codex migration **removed** (Session 8), + a guard test. *(`AGENT_CHAT_MODEL` stays codex by design — it's the money-agents' own model, gated to provisioned agents.)*
- [x] **App-wide design-system sweep** (§7): `text-white`→`--color-accent-fg` contrast fix app-wide, accent-on-hover neutralized across secondary panes, **pane-header convergence** (Files/Memory/Database/Plugins/Automations/Bridges/CRM → `.pane-header`, density-responsive), FilesPane folders→muted / dirty→warning, Plugins MCP chips → `.pill`+status-dot, **modal shadows tokenized** to `--aios-shadow-pop`, **empty-state convention** ([PaneEmpty.tsx](src/components/PaneEmpty.tsx) + the `muted/60` double-dim → `--color-faint` sweep), and a **CI lint guard** that regression-protects all of it (Session 9).
- [x] **Real hotkey dispatcher + rebinding** (Session 9) — [lib/keybindings.ts](src/lib/keybindings.ts): defaults + a tested `matchesChord`; the App keydown handler dispatches the six global actions data-drivenly (out of the hardcoded switch); Settings → shortcuts gains a **rebind UI** (click a chord, press new keys, reset). The cheat-sheet ([lib/shortcuts.ts](src/lib/shortcuts.ts)) drops the rebindable rows so it never shows a stale default.
- [x] **Drag-to-move panes** — pointer-driven (HTML5 draggable is swallowed by the Tauri webview), per-pane hover detection, clean **swap** semantics, accent drop-highlight. The `sqrt`-layout empty cell was already filled by the 3-pane span special-case.
- [x] **Sidebar:** **brand/home anchor** (one-click minimize-all → home) + **icons-only spaces labeled**. De-segment / only-render-non-empty **assessed and rejected** — the modules already render compactly (full-mode money-agents has no divider) and hiding them would remove the create/attach affordances for no real clutter gain.
- [x] **Transcript:** **find-in-chat** (`⌘F` context-aware, match scroll + tint, `⏎`/`⇧⏎` cycle) + **hover timestamps** (per-turn `createdAt` in the reducer + a quiet wall-clock on user/assistant bubbles; reducer tests updated) + assistant body tokenized. *(Tool output is already capped + scrollable; an explicit collapse toggle was deemed unnecessary.)*
- [x] **Wire density/font-scale** — terminal honors `terminalFontSize` live; `[data-density="compact"]` tightens the tokens at boot; resize-gutter resting hint + double-click reset. The "shared `DropOverlay`" was a non-issue — `PaneDropZone` is *already* the single shared drop component; its §6 **accent leak** (accent while merely armed) was fixed instead.

---

## 9. Quality-of-life polish (cross-cutting)

Small, pervasive interaction details that separate "works" from "feels finished." None are
architectural; together they're most of what reads as "unpolished." Treat this as a standing
backlog — knock items off opportunistically alongside the roadmap above.

> **✅ cleared (Session 10).** The whole §9 backlog was swept end-to-end. Foundations: a shared
> [`uiHooks.ts`](src/lib/uiHooks.ts) (`useDismiss`/`useFocusTrap`/`useScrollMemory`), a
> [`Skeleton`](src/components/Skeleton.tsx) + [`CopyButton`](src/components/CopyButton.tsx)
> component, a global [`toast()`](src/lib/toast.ts) bus, and design-system CSS for the keyboard
> focus ring + skeleton shimmer. A `§9` lint guard ([bundleBoundaries.test.ts](src/lib/bundleBoundaries.test.ts))
> regression-protects the primitives. `tsc` clean · 90 tests pass.

### 9.1 Overlays, menus & dismissal

- [x] **Composer selectors clip against the pane top** — the model/effort/context menus opened
  upward (`bottom-full`) with no max-height, so tall lists were cut off. *Fixed:* capped at
  `max-h-[min(360px,55vh)]` + scroll ([ChatPane.tsx Dropdown](src/components/ChatPane.tsx)).
- [x] **Can't click away to dismiss a selector** — the `Dropdown` had no outside-click handler.
  *Fixed:* added outside-mousedown + `Esc` dismissal.
- [x] **Direction-aware menus** — the composer `Dropdown` now measures its trigger rect on open and
  flips `bottom-full`/`top-full` by available space, so it never clips against a short pane
  ([ChatPane.tsx Dropdown](src/components/ChatPane.tsx)). The other menus (open-as, browser, sidebar)
  are top-anchored and correctly fixed-direction.
- [x] **Apply the same dismissal everywhere** — extracted one shared
  [`useDismiss(ref, onClose, enabled)`](src/lib/uiHooks.ts) (outside-mousedown + captured `Esc`) and
  routed the composer `Dropdown`, the pane "open-as" menu, and both browser menus through it. Identical
  behavior everywhere; the slash/`@`/resume overlays keep their textarea-driven `Esc`/arrow handling.
- [x] **Menu keyboard nav** — the `Dropdown` is fully keyboard-drivable: ↑/↓ move, `Home/End` jump,
  `Enter` picks, `Tab` closes, focus moves into the selected row on open and back to the trigger on
  close. Rows carry `role="menuitem"`/`menuitemradio` + `aria-checked`.
- [x] **Trap focus in modals** — [`useFocusTrap`](src/lib/uiHooks.ts) wraps Settings, onboarding,
  pin-site, and the DB add-connection modal: Tab cycles inside, and focus restores to the trigger on
  close. Each carries `role="dialog"` + `aria-modal`.

### 9.2 Feedback & loading states

- [x] **Loading skeletons, not blank** — a shared [`<Skeleton>`](src/components/Skeleton.tsx) shimmer
  (one CSS look, reduce-motion-safe) replaces the blank-then-pop flash: Plugins (skill grid), Files
  (skeleton tree on first load), Database (query running), Bridges (channel cards). Crm's hand-rolled
  `animate-pulse` rows were converged onto it; Memory keeps its graph-loading state.
- [x] **Optimistic + confirmed states** — Settings now flashes a quiet "✓ saved" on every `patch()`,
  so silent persistence is legible. (Crm/DB already append optimistically; the copy buttons confirm
  with a check.)
- [x] **Copy buttons everywhere machine text appears** — shared
  [`<CopyButton>`](src/components/CopyButton.tsx) (check-on-copy, mirrors the chat) added to DB cells
  (hover), Bridges pairing code + log path, and Memory node ids.
- [x] **Toasts for every async action** — a global [`toast()`](src/lib/toast.ts) bus (window event →
  the app's existing pill, no prop-drilling) now covers memory save/delete, browser profile switch,
  and sidebar unpin, joining the existing send-to-AI/screenshot/run/pin toasts.
- [x] **Disabled states explain themselves** — the composer send button already carries a *why* title
  ("chat session is still starting" / "type a follow-up to queue or steer"); MotionPane's generate
  button now does too ("enter a prompt to generate"). *(Mission Control done in Session 6.)*
- [x] **Full app reset (type-to-confirm)** — Settings → general has a destructive "reset app" gated
  behind typing `reset` ("wipe & restart"); it clears **all** local settings/preferences and re-runs
  first-run onboarding. The user's files, chats, and memory vault on disk are untouched
  ([settings.ts `resetApp()`](src/lib/settings.ts), [Settings.tsx](src/components/Settings.tsx)).

### 9.3 Keyboard, focus & a11y

- [x] **Visible focus rings** — one restrained accent `:focus-visible` ring on every interactive
  surface, applied globally in [App.css](src/App.css) (keyboard-only; pointer clicks stay quiet).
  Text-entry surfaces keep their `.focus-accent` border treatment.
- [x] **Platform-correct shortcut labels** — swept the remaining visible `⌘` literals through the
  platform-aware `chord()` helper (TerminalComposer dictate, MotionPane generate); the generated
  cheat-sheet shipped in P1.
- [x] **ARIA on custom controls** — the composer `Dropdown` is a `role="menu"` with
  `menuitemradio`/`aria-checked` rows; Settings toggles are `role="switch"` and now get an accessible
  name from their row label (via `cloneElement`); the Settings nav is a `role="tablist"`; modals are
  `role="dialog"`; the command palette was already fully ARIA'd.

### 9.4 Consistency & micro-interactions

- [x] **One radius/shadow/empty-state vocabulary** — floating menus/toasts/modals converged onto
  `--aios-shadow-pop` (or `.surface-pop`) across App/ChatPane/TerminalComposer/Bridges/Browser; the
  remaining `text-[var(--color-muted)]/{50,60}` empties moved to `--color-faint`; empty states share
  [`<PaneEmpty>`](src/components/PaneEmpty.tsx).
- [x] **Consistent hover language** — the swept menus + panes lift border/text one step on hover;
  accent stays reserved for active/selected, never a hover color.
- [x] **Transitions** — a global motion baseline in [App.css](src/App.css) already eases color/border/
  shadow/transform on every interactive element type (reduce-motion-aware); newly-added rows use it.
- [x] **Scroll-position memory** — [`useScrollMemory`](src/lib/uiHooks.ts) remembers scroll per pane
  across unmount/remount (Files tree, Plugins); the chat keeps its pinned-to-bottom behavior.
- [x] **Truncation + tooltips** — added `title` to the truncating agent-lane label/job, Bridges log
  path, Memory id, and DB cells (which already truncated).
- [x] **Hit targets** — the always-visible pane-chrome icon buttons were padded up (`p-0.5` → `p-1`),
  and overflow actions already collapse into the "open-as" menu (P1).

### 9.5 Homescreen "fresh start" (first-run feel)

The control center reads like the author's ops dashboard, not a fresh user's home. Partly addressed
this session; the rest folds into the P1 homescreen decision.

- [x] **Empty metrics recede** — pulse tiles with no data now render faint instead of a wall of
  prominent `—` ([PulseIdentityBand.tsx](src/components/dashboard/PulseIdentityBand.tsx)).
- [x] **De-spray accent + round cards** — notification/Jarvis/agent lanes + footer demoted to one
  accent action and given `--aios-radius-lg` corners.
- [x] **Stop dumping raw prompts as labels** — the Jarvis CTA shows "ask aios about this" instead of
  the multi-line control-center prompt.
- [x] **Don't surface transient junk as the headline** — notifications gained a `transient` flag
  ([notifications.ts](src/lib/notifications.ts)): transient confirmations never badge the bell, are
  filtered out of the Jarvis briefing candidates ([controlCenter.ts](src/lib/controlCenter.ts)), and
  self-expire after a 45s TTL. The browser/bridges pane confirmations are now marked transient, so
  "no text selected" can't become the headline.
- [x] **Honest partial data** — the Pulse band now *drops* tiles it genuinely can't fill (sessions /
  messages / active-since when ccusage isn't installed) instead of rendering a faint `—`
  ([PulseIdentityBand.tsx](src/components/dashboard/PulseIdentityBand.tsx)).
- [x] **Genericize remaining persona/identity** — the seeded cofounder agent now shows the user's
  onboarding name (fallback "cofounder", not "firaz"; internal id/paths unchanged)
  ([moneyAgents.ts](src/lib/moneyAgents.ts)); the mirror room prefix is neutral `aios-`; the Settings
  example path is generic. `PRIMARY_ORACLE_IDENTITY` is intentionally left synced to the backend's
  `AIOS_PRIMARY_ORACLE` default — a fresh user simply has no oracle by that name, so nothing leaks.
- [ ] **A "new chat" primary on the home** — the chat-first app's home should let you start the
  central action in one click (the one button that earns the accent fill). ✅ *shipped (Session 6)*

---

## 10. Provider-base sweep — make the "base" follow the user's chosen CLI

The app was built **Codex-first**: the "base" provider/model is hardcoded to `codex-cli` /
`codex-code` / `gpt-5.3-codex-spark` in many places, even though onboarding now lets the user pick
claude / gemini / opencode. A claude user still meets codex assumptions baked into defaults, copy,
and seeds. The goal of this sweep: the **base provider + model derive from
`settings.chatProvider`/`chatModel`** (set in onboarding, editable in Settings → chat), and every
downstream default, label, and seed switches with it. This is §7's convergence idea applied to
*provider assumptions* instead of design tokens.

> **Important distinction:** some `codex` references are *legitimately* codex-specific — the codex
> launcher (`apps.ts:71`), the codex **app-server** engine (`chat.rs`), codex usage-pace warnings.
> The sweep targets the **generic base defaults**, not codex support itself. Don't delete codex;
> stop *assuming* it.

### 10.1 Where the codex base is hardcoded (audit)

| Where | Hardcoded today | Should be |
|---|---|---|
| `settings.ts:115/118` | `chatProvider: "codex-cli"`, `defaultAi: "codex-code"` as the shipped defaults | First **detected** provider from `detect_providers` (fallback chain), chosen at onboarding |
| `settings.ts:152–153` | veteran migration **forces** `chatProvider="codex-cli"` / `defaultAi="codex-code"` when missing | back-fill from the detected base, not a fixed codex |
| `providers.ts:199` | `DEFAULT_PROVIDER_ID: ProviderId = "codex-cli"` | a `baseProvider()` selector that reads settings → detected → first tier-1 |
| `moneyAgents.ts:60` | `AGENT_CHAT_MODEL = "gpt-5.3-codex-spark"` drives every seeded agent + chat seed (`:256`, `:328`) | the base model (or a per-agent override); never a fixed spark id |
| `ChatPane.tsx:282` | context-budget copy `"stripped codex home, explicit context only"` shown to **all** engines | engine-neutral wording, or gate the codex phrasing on `engine === "codex"` |
| `chat.ts` default | when `chatModel === null`, the effective model falls through to an implicit engine | resolve to the **chosen** provider's first model |
| `settings.ts:49` comment | "Default codex-cli keeps new chats aligned with the WA oracle" | document the *configurable* base instead |

### 10.2 Approach

1. **One source of truth.** Add `baseProvider()` / `baseModel()` selectors in
   [providers.ts](src/lib/providers.ts) that read `settings.chatProvider`/`chatModel`, fall back to
   the first **detected** provider (`detect_providers`), then to the first tier-1 entry — never a
   hardcoded codex. Everything that needs "the base" calls these.
2. **Derive, don't duplicate.** Make `defaultAi` a function of `chatProvider`
   (`claude-cli`→`claude-code`, `codex-cli`→`codex-code`, `gemini-cli`→…, else `chat`) instead of a
   second persisted copy that can drift out of sync.
3. **Engine-neutral copy.** Replace codex-specific user-facing strings (the "codex home" budget sub,
   any "starting codex…" assumptions) with engine-derived wording (the empty-hero label already does
   this — extend the pattern).
4. **Settings = the base control.** The new Settings → chat section already switches engine/model;
   make it the authoritative "base" and ensure every default reads through the selectors above.
5. **Guard it.** Add a lint/test that no **new** `codex-cli` / `gpt-5.3` literal appears in *generic*
   (non-codex-specific) paths, so the base can't silently re-hardcode.

*Effort: L (cross-cutting). Sequence after the current P1 batch; it pairs naturally with the §7
design-system sweep and the §8 identity single-sourcing as one "convergence" milestone.*

---

## Progress log

**Session 1 — P0 quick wins (shipped, `tsc` clean + 76 tests pass):** identity single-sourced from
`settings.userName` (+ live greeting on the real homescreen); empty chat hero calmed (telemetry rows
gated, canonical classes, engine-aware label, actionable placeholder, `⏎` hint); accent discipline
(muted resting chips, faint bullets, `--color-spark` token); error footers get a danger treatment;
focused-pane accent ring + tokenized pane chrome; homescreen honesty (no fabricated trend, no `—`
wall); `splashOnLaunch` actually gates the splash + reduce-motion applied at boot; `flashLevel`
defaults to `calm`; new `lib/platform.ts` → `Ctrl` labels on Windows everywhere.
*One audit finding was a false positive — Windows MCP detection already works via the `HOME`→`%USERPROFILE%`
alias in [lib.rs:47](src-tauri/src/lib.rs#L47).*

**Session 2 — QoL pass:** chat selector clipping + outside-click/`Esc` dismissal fixed; homescreen
"fresh start" polish (faint empty metrics, de-sprayed accent, rounded cards, clean Jarvis CTA).

**Session 3 — P1 onboarding slice (shipped, `tsc` clean + 76 tests pass + `cargo check` clean):**
new `detect_providers` Rust command (cross-platform CLI/key detection that survives GUI-launch PATH
loss) + `providerDetect.ts` wrapper; a calm, skippable 5-step first-run **onboarding** (welcome →
name → engine-with-live-detection → MCP review → theme/accent), gated on a new `onboardingComplete`
flag with a veteran back-fill migration, mounted after the splash and re-openable from Settings; a
new Settings **"chat"** section exposing engine/model/routing (previously persisted but unrenderable).
Two homescreen guard tests were updated to match the de-jargoned copy, and the deleted-CI-workflow
assertion was dropped from the mirror test.

**Session 4 — P1 chat honesty + safety (shipped, `tsc` clean + 76 tests pass):** model picker grays
out engines whose CLI isn't installed (closes the `detect_providers` loop); error footers gained a
**Retry**; "regenerate from here" fixed to last-turn-only + honest label; the approval card now shows
the **full** gated command (scrollable, no silent clip); copy buttons on tool stdout/stderr + Bash
commands. Remaining P1: edit-and-resend, startup "claude not found" inline state, top-bar fallback,
Mission Control discoverability, palette upgrades, and the homescreen "new chat" primary.

**Session 5 — bugfix + P1 (shipped, `tsc` clean + `cargo check` 0 warnings + 81 tests pass):** fixed a
real **double-reply** bug — claude re-sends the cumulative message as a final `assistant` event (some
engines twice), and the reducer's `streamingTurnId == null` guard let the repeat through, rendering two
identical bubbles; added a content-level dedup in `reduceChatStreamEvent` + a regression test (and wired
`chatStream.test.ts` into the suite). Silenced the 28 Windows Rust warnings (Unix-only inert code) via a
`#![cfg_attr(windows, allow(dead_code, unused_imports, unused_variables))]` so the macOS build still
warns. Shipped P1 **edit-and-resend** and the **engine-not-found** startup state. *(The "~30k tokens for
hi" was not a bug — that's claude CLI's own system prompt + project files on the first turn; AIOS's added
context in lean mode is ~120 tokens.)* **P0 audit: 100% complete** (font-scale/density remain P2 — they
need real consumption wiring, not a fake).

**Session 6 — P1 finish (shipped, `tsc` clean + `cargo check` 0 warnings + 81 tests pass):** closed out
the remaining P1 batch. **Composer:** the mystery wrench is now a labeled **"options"** pill, **attach +
dictate** are inline composer buttons (out of the overflow), and a quiet row of **starter chips** prefills
the empty hero. **Homescreen:** committed to IdleControlCenter (decision documented at the IdleDashboard
early-return + test-enforced), added a **"new chat"** accent primary + core-tool dock, **gated phantom
money-agents** behind real on-disk state (+ honest firaz health, "no agents yet" empty state). **Shell:**
the hidden top bar's **search + notifications** (with badge) are pinned in the sidebar footer; a persistent
**"N panes"** overview pill + the top-bar Mission-Control button **dims/disables at 0**. **Palette:**
**⌘K coachmark**, **MRU recents**, **actionable no-results** (AI intents stay alive), full **ARIA**, and a
**backtracking** fuzzy matcher + richer keyboard nav. **Plus two user-requested adds:** a type-to-confirm
**app reset** (Settings → general; clears local prefs + re-onboards, leaves files/chats/memory intact) and a
new **§10 provider-base sweep** in the plan (make the base provider/model follow the user's chosen CLI
instead of the hardcoded Codex defaults). *The unreachable bento prototype in IdleDashboard is documented
but not yet physically deleted — it interleaves live helpers PulsePane imports; excision is folded into §7.*

**Session 7 — aggressive feel pass + P2 (shipped, `tsc` clean + `cargo check` 0 warnings + 82 tests pass).**
New standing directive: make the whole app **feel fluid, look phenomenal, great to use** (don't preserve
the current look for its own sake). Delivered in committed batches:
- **§10 provider-base sweep (core):** `baseModelId(provider)` + single `defaultAiForProvider()` (killed the
  triplicated mapping); new chats default to the **user's** provider, not codex spark; guard test.
- **Fluidity layer (App.css):** a global motion baseline (every interactive element eases color/border/
  shadow/transform/opacity, spring easing, reduce-motion-safe) + opt-in `.lift` / `.press` / `.btn-glow`
  helpers (the composer-send treatment, generalized). Applied to the home new-chat, tool dock, footer cards,
  and chat send/steer.
- **§7 accent + contrast + structural:** `text-white`-on-accent **contrast bug** fixed app-wide →
  `--color-accent-fg`; accent-on-hover neutralized across the secondary panes; FilesPane folders→muted /
  dirty→warning; Plugins MCP chips → neutral `.pill` + green status dot.
- **Shell:** sidebar **aios home/brand anchor** (one-click minimize-all → home).
- **Honesty:** the dead **density** + **text-size** settings now do something real — terminal reads
  `terminalFontSize` (live) and `[data-density="compact"]` tightens the canonical tokens (applied at boot).
- **Transcript:** assistant body tokenized to `--aios-text-body`.

*Still open (each a focused effort): find-in-chat (needs `⌘F` made context-aware vs the fullscreen binding),
the real hotkey dispatcher, drag-to-move panes, and the full pane-header convergence.*

**Session 8 — P2 features + completion audit (shipped, `tsc` clean + 82 tests pass).** Built the
remaining user-facing P2 features and audited the whole roadmap. **Features:** **find-in-chat**
(`⌘F` made context-aware vs the fullscreen binding; a find bar scrolls to + tints each match, `⏎`/`⇧⏎`
cycle); **drag-to-move panes** (pointer-driven — HTML5 `draggable` is swallowed by the Tauri webview's
file drag-drop; per-pane hover detection + clean **swap** semantics + accent drop-highlight); the
**generated shortcuts cheat-sheet** ([lib/shortcuts.ts](src/lib/shortcuts.ts) — one source, platform
correct, 15 shortcuts vs the old hand-kept 6); **pane-header convergence** (7 panes → `.pane-header`,
now density-responsive); **resize-gutter** double-click reset + faint resting handle; tokenized **modal
shadows** → `--aios-shadow-pop`; removed the **legacy claude→codex migration** (§10); spread fluidity
(IconBtn press, pane fade-in entrance). **Audit result — P0: ✅ 100%, P1: ✅ 100%, P2: user-facing work
done**; the remainder is genuine depth (hotkey *rebinding UI*, the *full* design-system convergence +
lint guard, a shared `DropOverlay`, sidebar de-segment, transcript timestamps) — best folded into the
next "further improve" plan.

**Session 9 — P2 depth complete (shipped, `tsc` clean + 89 tests pass).** Pushed through the
remaining depth items so **P0/P1/P2 are now fully closed**. **Hotkey rebinding:** new
[lib/keybindings.ts](src/lib/keybindings.ts) (defaults + a unit-tested `matchesChord`/`chordFromEvent`);
the App keydown handler dispatches the six global actions data-drivenly (migrated out of the hardcoded
switch, ⌘N alias preserved); a **rebind UI** in Settings → shortcuts (click a chord → press new keys →
save/reset). **Transcript timestamps:** per-turn `createdAt` in the stream reducer + a quiet hover
wall-clock on user/assistant bubbles (reducer tests updated). **Design-system:** a shared
[PaneEmpty.tsx](src/components/PaneEmpty.tsx) empty-state + the `muted/60` double-dim → `--color-faint`
sweep, plus a **CI lint guard** ([bundleBoundaries.test.ts](src/lib/bundleBoundaries.test.ts)) that
regression-protects the contrast fix, header convergence, tokenized shadows, and the rebinding
migration. **Two non-issues resolved with rationale:** `PaneDropZone` is already the shared drop
component (fixed its §6 accent-leak instead of extracting a redundant `DropOverlay`); the sidebar
modules already render compactly, so only-render-non-empty was rejected (it would drop the create/attach
affordances). Test count 82 → **89**.

---

## Appendix — methodology & sources

This plan was produced by a multi-agent audit: seven parallel deep-read agents (one per surface)
each read the live source and cited `file:line`, an adversarial pass re-checked all 33
high/critical findings against the code (**33/33 confirmed, 0 rejected**), and a dedicated agent
designed the onboarding flow against the existing `providers.ts`/`plugins.rs`/Settings
infrastructure. The headline structural claims (the dead bento dashboard, the `firaz`/`faeez`
identity split, the `splashOnLaunch`/font-scale/density no-ops, the default-`codex` vs
hardcoded-`claude` mismatch) were independently re-verified by hand against the current tree.

Total: **84 findings across 7 surfaces**, distilled here into themes and a roadmap. The raw,
per-finding detail (severity · category · effort · location · problem · recommendation) lives in
the audit and can be regenerated on demand.

*All references are to the working tree as of this audit. Line numbers will drift as the code
changes — search the cited symbol if a line no longer matches.*
