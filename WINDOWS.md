<div align="center">

# 🪟 Running AIOS on Windows

**the native Windows build of the AIOS superapp.**

Tauri v2 (Rust) + React/Vite — one codebase, native on Windows and macOS.

[![back to README](https://img.shields.io/badge/←-README-blue)](./README.md)
[![port notes](https://img.shields.io/badge/internals-WINDOWS--PORT.md-555)](./WINDOWS-PORT.md)

</div>

---

AIOS runs natively on Windows. Every Windows-specific change is cross-platform
guarded (`cfg!(windows)` + `USERPROFILE` fallbacks), so the same tree still
builds on macOS. This page is the **run guide**; for what was ported and how the
internals differ, see [`WINDOWS-PORT.md`](./WINDOWS-PORT.md).

## 🧰 One-time setup

Install these once per machine:

| Tool | How | Why |
| --- | --- | --- |
| **Rust** (MSVC) | <https://rustup.rs> | the Tauri backend |
| **VS Build Tools 2022** + "Desktop development with C++" | <https://aka.ms/vs/17/release/vs_BuildTools.exe> | links the Rust binary |
| **Node 18+** | <https://nodejs.org> | the frontend (`npm`) |
| **WebView2** | preinstalled on Windows 11 | renders the UI |
| **claude CLI** | `claude.exe` on `PATH` | the chat pane (runs on your subscription) |

> [!NOTE]
> We use **npm** on Windows, not pnpm — pnpm 11's build-approval gate blocks
> esbuild's install. This is the only deliberate divergence from the macOS setup.

### Optional (only if you want these panes live)

| Want | Install |
| --- | --- |
| Office-file previews in the Files pane | **LibreOffice** (`soffice.exe` on `PATH`) |
| Editor diagnostics / hover / go-to-def | `npm i -g typescript-language-server` · `rustup component add rust-analyzer` |
| The Codex / Opencode chat engines | `npm i -g @openai/codex` · `npm i -g opencode-ai` |
| Push-to-talk voice | a local **whisper.cpp** server on `:9000` (set the endpoint in Settings → general) |

## ▶️ Run it

A helper script wraps everything:

```powershell
.\scripts\run.ps1            # install deps (first run) + launch the dev app
.\scripts\run.ps1 -Build     # produce an installer (.exe / .msi) instead
```

Or manually:

```powershell
npm install
npx tauri dev
```

The first Rust build takes a few minutes; after that it's cached and fast.

## ✅ What works vs. what's inert

Nothing crashes — Unix-only integrations just show empty and stay quiet.

**Working on Windows**

- **Terminals** — PowerShell over ConPTY (open as many as you like).
- **Chat** — `claude.exe`, plus Codex / Opencode if those CLIs are installed.
- **Files** + office preview · **Code editor** (Monaco) + **language servers**
  (TS/JS + Rust, once the server binaries are installed).
- **Browser** — native WebView2 (real Chromium, profiles, screenshots).
- **App-window mirroring** — cast another app's window into a pane via
  `Windows.Graphics.Capture` (display-only for now).
- **Pulse / usage dashboard** (your real stats), **device & battery** panel.
- **Notes**, **Plugins/skills**, **Notifications**, screenshots, clipboard
  "send to chat", theming, onboarding, and the command palette.
- **Voice** — works anywhere a whisper.cpp server is reachable (same as macOS).
- **Self-update** — signed builds from GitHub Releases (see below).

**Inert on Windows** (need a Unix host)

- The **oracle roster** and **persistent terminals** — both need `tmux`, so
  Windows terminals work but don't survive an app quit.
- **Money agents** — `launchd`-backed daemons.
- **Bridges** status — detected via `launchctl` / process scans.

## ⬆️ Updating

AIOS updates itself: the in-app updater pulls **signed** builds from this repo's
GitHub Releases, verifies the signature, installs, and relaunches — quietly at
boot and from Settings › software update. See [`RELEASING.md`](./RELEASING.md)
for how signed releases are produced.

To track the source instead of release builds, pull this repo and relaunch:

```powershell
git pull origin main
.\scripts\run.ps1
```

> [!NOTE]
> The original macOS repo lives on a separate `upstream` remote and has an
> unrelated history — its changes are hand-ported, not merged. The in-app
> updater is the supported way to stay current.

## 🔧 Windows surface area (for reviewers)

The Windows-specific code, so you know what to look at:

| File | What it does on Windows |
| --- | --- |
| `src-tauri/src/lib.rs` | aliases `HOME` → `%USERPROFILE%` at startup (lights up usage / memory / files) |
| `src-tauri/src/proc.rs` | `NoWindow` trait → `CREATE_NO_WINDOW` on every child spawn, so a built app never flashes a console |
| `src-tauri/src/pty.rs` | terminals launch PowerShell over ConPTY; `cfg(windows)` non-persistent path (no tmux) |
| `src-tauri/src/chat.rs` | resolves `claude.exe` / `codex` / `opencode`; no console flash |
| `src-tauri/src/wincast.rs` | app-window mirroring via `Windows.Graphics.Capture` + a child HWND |
| `src-tauri/src/lsp.rs` | Windows `node` arm, `rust-analyzer.exe` / PATH resolution, no-window spawns |
| `src-tauri/src/device.rs` | battery via `GetSystemPowerStatus`; home-drive disk |
| `src-tauri/src/stats.rs` | JSONL-telemetry fallback when ccusage/cache is absent |
| `src-tauri/src/memory.rs` | Windows path encoding for the memory-focus vault |
| `src-tauri/src/browser.rs` | Windows UA; screenshot + clipboard via PowerShell |
| `src-tauri/src/files.rs` | `soffice.exe`, OS temp dir, `file://` URLs, `USERPROFILE` |
| `src/components/TerminalPane.tsx` | focuses the terminal so you can type; WebGL context-loss fallback |
| `src-tauri/tauri.conf.json` | `npm` dev/build hooks, NSIS installer, signed GitHub-Releases updater |
