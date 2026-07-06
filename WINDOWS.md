<div align="center">

# 🪟 Running OSAI on Windows

**the native Windows build of OSAI — and Windows is home turf.**

Tauri v2 (Rust) + React/Vite — one codebase, native on Windows and macOS.

[![back to README](https://img.shields.io/badge/←-README-blue)](./README.md)
[![port notes](https://img.shields.io/badge/internals-WINDOWS--PORT.md-555)](./WINDOWS-PORT.md)

</div>

---

OSAI runs natively on Windows — it's the author's daily driver there. Every
Windows-specific change is cross-platform guarded (`cfg!(windows)` +
`USERPROFILE` fallbacks), so the same tree still builds on macOS. This page is
the **run guide**; for what was ported and how the internals differ, see
[`WINDOWS-PORT.md`](./WINDOWS-PORT.md).

## 🧰 One-time setup

Install these once per machine:

| Tool | How | Why |
| --- | --- | --- |
| **Rust** (MSVC) | <https://rustup.rs> | the Tauri backend |
| **VS Build Tools 2022** + "Desktop development with C++" | <https://aka.ms/vs/17/release/vs_BuildTools.exe> | links the Rust binary |
| **Node 18+** + **pnpm** | <https://nodejs.org> · `npm i -g pnpm` | the frontend |
| **WebView2** | preinstalled on Windows 11 | renders the UI |
| **claude CLI** | `claude.exe` on `PATH` | the chat pane (runs on your subscription) |

### Optional (only if you want these live)

| Want | Install |
| --- | --- |
| Office-file previews in the Files pane | **LibreOffice** (`soffice.exe` on `PATH`) |
| Editor diagnostics / hover / go-to-def | `npm i -g typescript-language-server` · `rustup component add rust-analyzer` |
| The Codex / Opencode chat engines | `npm i -g @openai/codex` · `npm i -g opencode-ai` |
| Push-to-talk voice | a local **whisper.cpp** server on `:9000` (endpoint configurable in Settings) |
| A pinned **psmux** version | `winget install psmux` — otherwise the bundled sidecar is used automatically |

> [!NOTE]
> **psmux** ("native Windows tmux") is what makes terminals *persistent* on
> Windows — detach, reattach, survive an app quit. Release builds bundle it;
> dev trees stage it with `pwsh scripts/fetch-psmux.ps1`. A PATH install always
> wins over the bundled copy, and with neither present terminals still work,
> just non-persistently.

## ▶️ Run it

A helper script wraps everything:

```powershell
.\scripts\run.ps1            # install deps (first run) + launch the dev app
.\scripts\run.ps1 -Build     # produce a signed-ready installer instead
```

Or manually:

```powershell
pnpm install
pnpm tauri dev
```

The first Rust build takes a few minutes; after that it's cached and fast.

## ✅ What works vs. what's inert

Nothing crashes — the few Unix-only integrations show empty and stay quiet.

**Working on Windows** — the whole app:

- **Persistent terminals** — PowerShell over ConPTY inside **psmux** sessions:
  detach, reattach, survive closing the pane or quitting OSAI (socket
  configurable in Settings → general).
- **The agent roster** — spawn and reattach oracle sessions (`claude`, `codex`,
  …) that keep running when the window closes.
- **Chat** — `claude.exe` first-class, Codex / Opencode if installed. (BYO-key
  native-API engines are on deck; the key vault already uses Windows
  credentials.)
- **Files** + office preview · **code editor** (Monaco) + **language servers** ·
  **browser** (WebView2 — real Chromium, screenshots, annotate-to-chat).
- **App-window mirroring** — cast another app's window into a pane via
  `Windows.Graphics.Capture` (display-only for now).
- **Notes** — the native Stone & Chisel client: your own notes cloud, offline
  queue, three-way merge.
- **Scheduled agents**, **plugins/skills**, **notifications** (in-app + native
  toasts), **pulse / usage**, device & battery, the command palette, theming
  (accent + glow), the lock screen and its resident, tray + minimize-to-tray.
- **Voice** — works anywhere a whisper.cpp server is reachable.
- **Self-update** — signed builds from GitHub Releases.

**Inert on Windows** (they need a Unix host and simply show empty)

- **Bridges** — the WhatsApp/messaging dispatch infra runs on a Unix box and is
  detected via process scans; the Windows app is the shell, not the bridge.
- **Money agents** — `launchd`-backed daemons.

## ⬆️ Updating

OSAI updates itself: the in-app updater pulls **signed** builds from this
repo's GitHub Releases, verifies the signature, installs, and relaunches —
quietly at boot and from **Settings › about › software update**. See
[`RELEASING.md`](./RELEASING.md) for how signed releases are produced.

To track the source instead of release builds, pull this repo and relaunch:

```powershell
git pull origin main
.\scripts\run.ps1
```

> [!NOTE]
> [Firaz's original AIOS](https://github.com/ferazfhansurie/aios-superapp)
> lives on a separate `upstream` remote with an unrelated history — its ideas
> are hand-ported, not merged. The in-app updater is the supported way to stay
> current.

## 🔧 Windows surface area (for reviewers)

The Windows-specific code, so you know what to look at:

| File | What it does on Windows |
| --- | --- |
| `src-tauri/src/lib.rs` | aliases `HOME` → `%USERPROFILE%` at startup (lights up usage / memory / files) |
| `src-tauri/src/proc.rs` | `NoWindow` trait → `CREATE_NO_WINDOW` on every child spawn, so a built app never flashes a console |
| `src-tauri/src/pty.rs` | ConPTY terminals wrapped in **psmux** sessions (PATH → bundled sidecar → plain ConPTY fallback); oracle attach via `new-session -A` |
| `src-tauri/src/chat.rs` | resolves `claude.exe` / `codex` / `opencode`; no console flash |
| `src-tauri/src/wincast.rs` | app-window mirroring via `Windows.Graphics.Capture` + a child HWND |
| `src-tauri/src/lsp.rs` | Windows `node` arm, `rust-analyzer.exe` / PATH resolution, no-window spawns |
| `src-tauri/src/device.rs` | battery via `GetSystemPowerStatus`; home-drive disk |
| `src-tauri/src/stats.rs` | JSONL-telemetry fallback when ccusage/cache is absent |
| `src-tauri/src/memory.rs` | Windows path encoding for the memory-focus vault |
| `src-tauri/src/browser.rs` | Windows UA; screenshot + clipboard via PowerShell |
| `src-tauri/src/files.rs` | `soffice.exe`, OS temp dir, `file://` URLs, `USERPROFILE` |
| `scripts/fetch-psmux.ps1` | stages the psmux sidecar into `src-tauri/resources/` for bundling |
| `src/components/TerminalPane.tsx` | focuses the terminal so you can type; WebGL context-loss fallback |
| `src-tauri/tauri.conf.json` | NSIS installer + the signed GitHub-Releases updater |
