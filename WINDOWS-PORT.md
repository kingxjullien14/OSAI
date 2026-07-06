<div align="center">

# 🛠 OSAI — Windows Port Notes

**what's cross-platform, what was ported, and the little that's still Unix-only.**

[![back to README](https://img.shields.io/badge/←-README-blue)](./README.md)
[![run guide](https://img.shields.io/badge/run%20guide-WINDOWS.md-555)](./WINDOWS.md)

</div>

---

> The frontend is fully cross-platform; the porting work was almost entirely in
> the Rust PTY/session/device layer. That work is **done** — OSAI is a native
> Windows daily driver, including persistent terminals and the agent roster
> (via **psmux**). This doc tracks the internals so reviewers and future
> contributors know the surface area. For setup and how to run, see
> [`WINDOWS.md`](./WINDOWS.md).

## 📦 Status at a glance

| Area | State on Windows |
| --- | --- |
| Frontend (React / xterm.js / Monaco / palette / composer) | ✅ cross-platform as-is |
| Terminals (PowerShell over ConPTY) | ✅ working — **persistent** via psmux (detach / reattach / survive quit) |
| Agent roster (oracle sessions) | ✅ working — psmux-backed, same socket namespace as terminals |
| Chat (`claude` / `codex` / `opencode`) | ✅ working — BYO-key vault in Windows credentials, native-API engines on deck |
| Files + office preview · editor + LSP · browser (WebView2) | ✅ working |
| Notes (Stone & Chisel sync client) | ✅ working — token in the credential vault, offline outbox |
| App-window mirroring (`Windows.Graphics.Capture`) | ✅ working — display-only |
| Usage / device / battery · screenshots · clipboard bridge | ✅ working |
| Scheduled agents · control plane · tray | ✅ working |
| No-console-flash for built apps | ✅ done (`proc.rs`) |
| Self-update (signed GitHub Releases) | ✅ working |
| Bridges (WhatsApp dispatch infra) · money agents | ⛔ Unix-host infra (degrade to empty) |

## ✅ Cross-platform as-is

The whole React/xterm.js frontend — windowed workspace, lock screen + the
resident, command palette, composer, sidebar, usage meter, theming — is
platform-agnostic. The chat pane needs the `claude` CLI on `PATH` (Windows
install of Claude Code). The editor (Monaco), Files pane, and Browser
(WebView2/Chromium) all run unmodified. Image paste/drop, copy/paste, and
drag-drop work the same.

## 🔩 What was implemented for Windows

Every change is behind a `cfg(windows)` guard or a `USERPROFILE`/temp-dir
fallback, so the macOS build is untouched.

- **`lib.rs`** — aliases `HOME` → `%USERPROFILE%` at startup, which lights up
  every `$HOME`-rooted data source (usage, memory, files, `~/.aios` state).
- **`proc.rs`** — a `NoWindow` trait sets `CREATE_NO_WINDOW` on every child
  `Command`, so a built app (which has no parent console) never flashes a
  conhost window. **Use `.no_window()` on every new `std::process::Command`.**
- **`pty.rs`** — terminals launch PowerShell over ConPTY, wrapped in **psmux**
  sessions for real tmux-style persistence. `resolve_mux()` picks the binary:
  a PATH install (`psmux.exe` / `pmux.exe` / `tmux.exe`) wins, else the
  **bundled sidecar** (`resources/psmux.exe`, staged by
  `scripts/fetch-psmux.ps1` and packed into release builds), else terminals
  fall back to plain non-persistent ConPTY — never a hard failure. Oracle
  attach uses `new-session -A -s` (psmux's `attach -t` ignores its target).
- **`chat.rs`** — resolves `claude.exe` (and `codex` / `opencode`) on Windows;
  spawns without a console flash.
- **`wincast.rs`** — the Windows twin of `appcast.rs`: captures a target
  window's pixels with `Windows.Graphics.Capture` (GPU-resident) and presents
  them into a child `HWND` we own, bounds-synced over a React slot. Display-only
  (the `HWND` answers `WM_NCHITTEST` with `HTTRANSPARENT`); input forwarding is
  the parked phase B.
- **`lsp.rs`** — a Windows `node` resolution arm, `rust-analyzer.exe` / PATH
  lookup, and `.no_window()` per spawn, so the editor's language features work.
- **`device.rs`** — battery via `GetSystemPowerStatus`; disk stats off the home
  drive.
- **`stats.rs`** — a JSONL-telemetry fallback when ccusage / its cache is absent.
- **`memory.rs`** — Windows path encoding for the memory-focus vault lookup.
- **`browser.rs`** — Windows user-agent; screenshot + clipboard via PowerShell.
- **`files.rs`** — `soffice.exe` for previews, the OS temp dir for pasted images,
  `file://` URLs, `USERPROFILE` roots.
- **`apikeys.rs` / `snc.rs`** — BYO-key API keys + the notes-cloud token live in
  the Windows credential vault (same keychain API as macOS via the `keyring`
  crate).
- **`TerminalPane.tsx`** — focuses the terminal so you can type immediately;
  recovers from a WebGL context loss.
- **`tauri.conf.json`** — NSIS installer (branded header/sidebar art) and the
  signed GitHub-Releases updater.

## ⛔ Still Unix-only (the remaining gaps)

These degrade gracefully (empty / clean error), never crash:

1. **Bridges** — the WhatsApp/messaging dispatch infra runs on a Unix host and
   is detected via process scans + `~/.aios/state` logs. The Windows app is the
   shell; the bridge stays remote.
2. **Money agents** — `launchd`-backed daemons; the board shows empty without
   them.

## 🧪 Build & verify

```powershell
pnpm exec tsc --noEmit     # frontend types
pnpm run test:chatpane     # the node test suite
pnpm tauri dev             # run it
.\scripts\run.ps1 -Build   # produce an installer
```

> [!NOTE]
> A built installer is the only way to verify the no-console-flash behavior —
> dev mode has a parent console and can't reproduce the flash. Stage psmux
> first (`pwsh scripts/fetch-psmux.ps1`) if you want persistence bundled.
