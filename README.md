<div align="center">

<img src="docs/cover/cover.png" alt="AIOS — one native window to drive your AI coding agents" width="100%" />

<br /><br />

# AIOS

**the superapp for driving AI coding agents — one native window.**

terminals, an agent roster, a multi-engine chat, an embedded browser, a file
explorer, a Monaco code editor with language servers, live app-window mirroring,
and a push-to-talk conductor that builds your workspace from a sentence. native,
fast, self-updating, and it runs on *your own* AI subscriptions with no keys
baked in.

<br />

[![platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows-000?logo=apple&logoColor=white)](#-requirements)
[![built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-stable-000?logo=rust&logoColor=white)](https://rustup.rs)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![self-update](https://img.shields.io/badge/updates-signed%20%2F%20auto-success)](./RELEASING.md)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

<sub>actively developed — it's the author's daily driver, updated most days.</sub>

</div>

---

AIOS is a desktop **superapp** for driving AI coding agents. It wraps a Rust
(Tauri v2) backend and a React + xterm.js frontend into a single native window
where **every pane is a tool**: terminals, an agent roster, a multi-engine chat,
an embedded browser, a file explorer, a Monaco editor with language servers,
mirrored native app windows, a pulse dashboard, and more.

It runs natively on **macOS and Windows** from one codebase, and it **degrades
gracefully** — it runs fine on a plain machine with nothing but a terminal. No
`claude` CLI? The chat pane sits quiet. No `tmux` (or on Windows)? The oracle
roster is just empty. Nothing errors; missing pieces simply go quiet.

## 📸 Screenshots

| The deck | Tile everything |
| --- | --- |
| ![deck](docs/screenshots/deck.png) | ![grid](docs/screenshots/grid.png) |
| **Light theme + model picker** | **Embedded browser** |
| ![light](docs/screenshots/light.png) | ![browser](docs/screenshots/browser.png) |

## ✨ What's inside

AIOS is built around a **resizable pane grid** — open as many tools as you want,
drag the dividers, maximize, minimize to the sidebar, or fan them all out in a
Mission-Control-style overview. When nothing's open you land on an **idle
dashboard**: a bento grid of your usage pulse, recent repos, a memory focus
widget, money-agent summaries, your oracle fleet, and live device stats.

A calm, skippable **first-run onboarding** (welcome → your name → engine
detection → MCP review → theme & accent) sets you up on first launch.

### 💬 Chat — multi-engine, local-first

A Codex-style chat pane that streams from a **local CLI** — so conversations run
on *your own* subscription with no API keys baked into the app.

- **Multiple engines** — `claude` (a persistent stream-json process), **Codex**
  (your ChatGPT subscription, the whole `gpt-5.x` family), and
  **Opencode/OpenRouter** with a zero-setup free fallback (`nemotron · free`).
  Swap engine and model from the model pill.
- **Model picker** — Opus 4.8 · Sonnet 4.6 · Haiku 4.5 · the `gpt-5.x` Codex
  family · a free OpenRouter model. The context window adapts to whichever model
  is live, and per-model rate windows show in the picker.
- **Effort levels** — `low · medium · high · xhigh · max · ultracode`, where
  *ultracode* layers orchestrated multi-agent fan-out (the Task tool) on top of
  xhigh and lights up an unmistakable "this is expensive" gradient.
- **Permission modes** — *ask each time · plan only · accept edits · full
  access*, with inline approval cards when the agent requests a tool.
- **Rich transcript** — user/assistant bubbles, collapsible thinking blocks with
  durations, and Codex-style tool-activity cards (verb · target · result · cost
  + token badge). Artifacts (Write/Edit) open straight into the file viewer or
  the code editor. Inline **question cards** when the agent asks you to choose.
- **Composer** — multi-line input, drafts autosaved per pane, image attach +
  paste + drag for vision, `/` slash menu, `@` file-mention picker, history
  recall, a true **stop** button, push-to-talk voice, and a **working-directory
  picker** so you can re-root the agent's session without leaving the pane.

### 🖥 Terminals — real PTYs

- Real PTYs streamed **per session over a Tauri Channel**, rendered with
  `xterm.js` + the **WebGL** addon (DOM fallback). Open as many as you want.
  PowerShell on Windows, your login shell on Unix.
- On Unix, **persistent shells** route through a `tmux` session
  (`aios-term-<pane>`) so they survive an app quit; oracle/raw panes stay
  ephemeral.
- **Compose box** — a multi-line prompt bar (default-open for oracle/claude-code
  panes) with live mode/model/context pills parsed straight from the PTY output,
  plus slash commands sent raw to the shell.
- **Niceties** — copy-on-select, `Shift+Enter` soft newline, paste (images
  auto-saved + path inserted), middle-click paste, file-drop → shell-quoted
  paths, and a `[[btn: a | b | c]]` sentinel that renders clickable buttons.

### 🛰 Oracle roster

Spawn, rename, attach, and kill **`tmux`-backed agent sessions** ("oracles")
from the sidebar. A pinned, undeletable **master** session sits on top. The
superapp attaches to each as a terminal. No tmux (or on Windows) → the roster is
simply empty.

### 🌐 Browser — a real webview

A **native child webview** (real WebKit / WebView2, not an iframe) for docs,
dashboards, and previews without leaving the deck.

- URL bar with auto-https + search fallback, back/forward/reload, zoom (50–200%),
  and a device-emulation toggle.
- **Screenshot** to a temp file; **annotation mode** — click an element to
  capture a note + selector + text and route it into chat.
- **Cookie profiles** — separate storage jars per profile, so logins (Google,
  YouTube Premium, etc.) actually persist and stay isolated.
- **Pin to sidebar** — resolves the favicon and drops the site into your rail.

### 📁 Files

A fast, VS Code-style explorer with a filterable tree, **git status**
decorations (M/A/D/U/R + folder "dirty" dots), indent guides, and type icons.
Single-click opens — code into the editor, media into the viewer. Drag any row
into a terminal or chat to insert its shell-quoted path.

### ✍️ Code editor (with language servers) & file viewer

- **Editor** — Monaco (VS Code's engine): syntax highlighting, minimap,
  find/replace, multi-cursor, dirty/saved indicator, `⌘/Ctrl+S` to save, and a
  save-conflict banner (keep-mine / take-disk / show-diff) when a file changes
  underneath you.
- **Language servers** — a built-in **LSP** bridge wires real diagnostics,
  hover, go-to-definition, and completions into Monaco: TypeScript/JavaScript
  via `typescript-language-server` and Rust via `rust-analyzer`. Install the
  server binaries to light it up; absent, it quietly degrades to Monaco's
  built-in worker.
- **Viewer** — inline preview for images, PDFs, and office docs (via
  LibreOffice).

### 🪞 App mirror & attach

Cast **one native app window** live into an AIOS pane — `ScreenCaptureKit` on
macOS, `Windows.Graphics.Capture` on Windows — so you can keep a design tool,
a simulator, or another app on the deck beside your agents. Pick a window from
the dropdown; the frame mirrors and tracks as you resize. (Display is shipped;
click/keystroke forwarding is in progress.)

### 🗒 Notes

An Apple-Notes-style scratch pad over your markdown files — search, create,
delete, autosave (debounced + on blur), word count, and a **live sync** so edits
made by an oracle show up without clobbering what you're typing. "Send to AI"
routes a note straight into chat.

### 🤖 Money agents

A board for always-on **autonomous agents** — long-running, scheduled daemons
with a mission, a work queue, and live health (running / scheduled / needs-steer
/ failed). Each row shows its primary metric, current job, next action, and last
run, with the logs a click away; open one straight into a chat to steer it.
(Daemon-backed — Unix-oriented; the board shows empty where the daemons aren't
running.)

### 📊 Pulse & usage

The idle dashboard and account menu surface a GitHub-style **activity heatmap**,
**current/longest streaks**, token totals, your favorite model, live **5h / 7d
rate-limit %**, and **device stats** (CPU, RAM, disk, battery, uptime) — all read
locally from your usage data, degrading to quiet zeros when absent.

### 🔌 Bridges · 🧩 Plugins · 🔔 Notifications

- **Bridges** — connection status for every channel AIOS can speak through
  (WhatsApp and more), detected via process, scheduler, and activity logs.
- **Plugins / skills** — a catalog of your AIOS skills (parsed from the skill
  index) plus the MCP servers wired into your `~/.claude.json`.
- **Notifications** — a center for agent + system events, with a **task
  monitor** that can watch an oracle's session and ping you when a task goes idle
  (done) or throws, with anti-spam guards so you get a signal, not noise.

### 🎙 Voice & the Conductor

Hold to record, transcribe via a local **whisper.cpp** server, and either drop
the text into the focused composer **or** speak a whole workspace into
existence: the **Conductor** parses what you said into an ordered plan of
existing primitives — *"open a terminal and a browser on github.com, then ask
claude to wire up the deploy"* — and executes it over the pane bus. Routing
happens in plain code; it never pollutes the model's context.

### 🐾 Companion · 🎨 Theming

- **Companion** — a small idle pet tile with subtle liveness, plus celebratory
  flourishes (confetti, sparks) on a long clean run. Pure delight, fully gated
  behind a reduce-motion-aware "fun fx" setting.
- **Theming** — system / light / dark, a live **accent color** picker, density
  (comfortable / compact), a font-size slider, a reduce-motion toggle, and the
  motion/fx system built on `motion` (Framer Motion's successor).

### ⌘ Command palette & shortcuts

A Raycast-style fuzzy **command palette** groups every action into **open** (new
panes), **resume** (recent chats), **fleet** (oracles), **run** (auto-discovered
projects), **view**, **actions**, and **app**.

<details>
<summary><b>⌨️ Keyboard shortcut reference</b></summary>

> Modifiers are platform-aware: **⌘ on macOS = Ctrl on Windows/Linux**. The keys
> below show the macOS glyphs.

| Shortcut | Action |
| --- | --- |
| `⌘K` | Command palette |
| `⌘B` | Toggle sidebar |
| `⌘T` / `⌘N` | New terminal |
| `⌘W` | Close focused pane |
| `⌘M` / `⌘⇧M` | Minimize focused pane / restore all |
| `⌘F` | Maximize (fullscreen) the focused pane |
| `⌘1`–`⌘9` | Jump to the Nth open pane |
| `` ⌘` `` | Mission-Control overview |
| `⌘R` | Reload the app |
| `⌘,` | Settings |
| `⌘J` | Voice dictation |
| `F5` | Run the detected project |
| `Esc` | Exit a maximized pane |
| **Chat** | `Enter` send · `Shift+Enter` newline · history recall · `@` files |
| **Terminal** | `Shift+Enter` soft newline · paste · copy · middle-click paste |
| **Editor** | `⌘/Ctrl+S` save |

</details>

### ⬆️ Self-update

AIOS updates itself. The in-app updater checks **GitHub Releases** for a newer
**minisign-signed** build, verifies the signature against a pinned public key,
downloads, installs, and relaunches — surfaced both at boot (quietly) and in
Settings › software update. See [`RELEASING.md`](./RELEASING.md) for how signed
release manifests are produced.

## 🚀 Requirements

- **macOS or Windows** (the Tauri shell is cross-platform; some agent
  integrations — tmux oracles, bridges, money-agent daemons — assume a Unix
  host and stay quiet on Windows).
- **Rust** (stable, via [rustup](https://rustup.rs)) — for the Tauri backend.
  On Windows, the MSVC toolchain + **VS Build Tools 2022** ("Desktop development
  with C++").
- **Node** 18+ — for the frontend. macOS can use **pnpm**; **Windows uses npm**
  (see [`WINDOWS.md`](./WINDOWS.md) for why).
- **WebView2** — preinstalled on Windows 11; renders the UI.
- _Optional:_ a `claude` CLI on your `PATH` — for the chat pane.
- _Optional:_ the `codex` and/or `opencode` CLIs — for the other chat engines.
- _Optional:_ **tmux** — for the oracle roster and persistent terminals (Unix).
- _Optional:_ `typescript-language-server` / `rust-analyzer` — to light up the
  editor's language features.
- _Optional:_ a **whisper.cpp** server on `:9000` — for push-to-talk voice.

## 🛠 Build & Run

```bash
npm install           # install frontend deps
npx tauri dev         # run AIOS in dev (hot-reload frontend + backend)
npx tauri build       # produce a release bundle (.app / .msi / binary)
```

On **Windows**, a helper script wraps the above:

```powershell
.\scripts\run.ps1            # install deps (first run) + launch dev app
.\scripts\run.ps1 -Build     # produce an .msi / .exe installer instead
```

(macOS users can substitute `pnpm` for `npm` if they prefer. `npm run dev` runs
just the Vite frontend on `:1420`.)

## ⚙️ Configuration

Everything below is **optional** — AIOS picks sensible defaults and runs with
none of it set. Use these env vars only to point it at a non-default layout:

| Variable | What it does | Default / fallback |
| --- | --- | --- |
| `AIOS_CLAUDE_BIN` | Override the `claude` CLI path. | resolved from `PATH` |
| `AIOS_CODEX_BIN` | Override the `codex` CLI path. | resolved from `PATH` |
| `AIOS_OPENCODE_BIN` | Override the `opencode` CLI path. | resolved from `PATH` |
| `AIOS_SKILL_INDEX` | Skill index (`_INDEX.md`) for the plugins pane. | `$HOME/.claude/skills/_INDEX.md`, then the first `$HOME/.claude/projects/*/skills/_INDEX.md`. None → empty list. |
| `AIOS_MEMORY_VAULT` | Markdown memory vault feeding the home-screen memory focus. | `$HOME/.claude/projects/<encoded-$HOME>/memory`, then the first `$HOME/.claude/projects/*/memory`, then `$HOME/.claude/memory`. |
| `VITE_AIOS_MIRROR_URL` | Cloudflare worker URL for the optional desktop-mirror feature (build-time). | none (mirror dormant) |

> Terminal + oracle sessions share one multiplexer socket, configurable in
> **Settings → terminal socket** (default `aios`) — `tmux` on macOS/Linux, `psmux`
> on Windows. The one-tap oracle name is **Settings → oracles → default oracle name**.

On Windows, `HOME` is aliased to `%USERPROFILE%` at startup, so all of the above
`$HOME`-rooted defaults resolve to your user profile. The MCP server list is read
from `~/.claude.json` automatically (no config). App state — settings, sidebar
layout, and per-pane chat drafts — persists in `localStorage` (`aios.settings`,
`aios.sidebar`, `aios-chat-draft:<pane>`).

## 🧩 Architecture

```
src/            React + TypeScript frontend (Vite)
  components/     one file per pane (Chat, Terminal, Editor, Browser, Files,
                  Notes, Pulse, Bridges, Plugins, AppCast, MoneyAgents, Pet,
                  Viewer, Onboarding, …) + fx/ (the motion/fx primitives)
  lib/            thin Tauri-invoke wrappers, the pane bus, the conductor,
                  the LSP client, the updater, settings
  App.tsx         the superapp shell — pane grid, layout, keybinds, dispatch
  App.css         the design system (color tokens, type scale, radii, spacing)
src-tauri/      Rust (Tauri v2) backend — #[tauri::command]s across:
  src/            pty · chat · browser · files · memory · oracles · lsp
                  appcast · wincast · monitor · bridges · plugins · device
                  stats · usage · telemetry · diag · proc (no-window spawns)
  tauri.conf.json app config (name "AIOS", id com.julnazz.aios, window, bundle,
                  signed GitHub-Releases updater)
```

- **One pane = one component + one backend module + one lib wrapper.** Low
  coupling; adding a capability is a vertical slice, not a refactor.
- **Backend (Rust / Tauri v2)** exposes capabilities as `#[tauri::command]`
  functions. PTYs and the chat stream push output to the frontend over Tauri
  **Channels** (one per session) so terminals and chat update token-by-token.
  Every child process is spawned with a no-window flag (`proc.rs`) so a built
  Windows app never flashes a console.
- **Frontend (React / xterm.js / WebGL)** renders each capability as a pane.
  Terminals use `@xterm/xterm` (WebGL + fit + web-links); the editor is Monaco
  with an LSP bridge; a small pane bus coordinates cross-pane actions (appshot →
  chat, drag → terminal, send-to-AI, the conductor).
- **Chat** shells out to your local CLIs (`claude` in stream-json mode, `codex`,
  `opencode`), normalizing each engine's events to one shape — so the model runs
  on your own subscription, no keys in the app.
- **Native webview for the browser & app mirror** — real WebKit/WebView2 and
  capture-backed child views (not iframes), so sessions persist and frames are
  real. They paint *above* HTML, which is why maximizing a pane deactivates its
  siblings.

## 🎨 Design

Calm, chat-first, restrained. A near-black ground with generous negative space;
soft hairline borders; a four-step text hierarchy; monospace reserved for the
machine's voice (status, paths, tool names). The **accent is precious** — it
appears only for the primary action, the active/selected state, and the focus
edge. Never a default border, never every hover. When in doubt, make it quieter.
All of it lives as theme-aware CSS custom properties in `src/App.css`,
runtime-overridable for theme and accent. Motion is built on `motion` with a
strict reduce-motion contract and a tokenized fx layer (`src/components/fx/`).

## 🗺 Roadmap

Shipped and stable today: everything in **What's inside** above. On deck:

- **App-cast input forwarding** — click/scroll/keystroke through to the mirrored
  native window (display is already live).
- **Control plane** — expose every UI action over localhost HTTP + MCP so an
  agent can drive the superapp exactly like a human.
- **Chat upgrades** — edit-and-resend a prior message, retry-with-different-model
  without losing the thread, in-transcript find, and a cumulative cost HUD.
- **Model-agnostic chat** — a live model catalog, OpenRouter key onboarding, and
  BYO-key native APIs with secure key storage.
- **Deeper Windows parity** — Windows-native equivalents for the remaining
  Unix-only integrations (detach/reattach terminals, bridges).

## 📄 License

[MIT](./LICENSE) © 2026 Jul.Nazz

<div align="center">
<br />
<sub>built with <a href="https://tauri.app">Tauri</a> · <a href="https://react.dev">React</a> · <a href="https://rustup.rs">Rust</a> · <a href="https://xtermjs.org">xterm.js</a> · <a href="https://microsoft.github.io/monaco-editor/">Monaco</a> · <a href="https://motion.dev">motion</a></sub>
<br /><br />
<sub><b>AIOS</b> — your AI co-founder's command deck.</sub>
</div>
