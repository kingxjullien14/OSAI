<div align="center">

# 🛠 AIOS — Windows Port Notes

**what's cross-platform, what was ported, and what's still Unix-only.**

[![back to README](https://img.shields.io/badge/←-README-blue)](./README.md)
[![run guide](https://img.shields.io/badge/run%20guide-WINDOWS.md-555)](./WINDOWS.md)

</div>

---

> The frontend is fully cross-platform; the porting work was almost entirely in
> the Rust PTY/session/device layer. The bulk of it is **done** — AIOS is a
> native Windows daily driver. This doc tracks the internals so reviewers and
> future contributors know the surface area. For setup and how to run, see
> [`WINDOWS.md`](./WINDOWS.md).

## 📦 Status at a glance

| Area | State on Windows |
| --- | --- |
| Frontend (React / xterm.js / Monaco / palette / composer) | ✅ cross-platform as-is |
| Terminals (PowerShell over ConPTY) | ✅ working — non-persistent (no tmux) |
| Chat (`claude` / `codex` / `opencode`) | ✅ working |
| Files + office preview · editor + LSP · browser (WebView2) | ✅ working |
| App-window mirroring (`Windows.Graphics.Capture`) | ✅ working — display-only |
| Usage / device / battery · screenshots · clipboard bridge | ✅ working |
| No-console-flash for built apps | ✅ done (`proc.rs`) |
| Self-update (signed GitHub Releases) | ✅ working |
| Oracle roster · persistent terminals · bridges · money agents | ⛔ Unix-only (degrade to empty) |

## ✅ Cross-platform as-is

The whole React/xterm.js frontend, command palette, composer, sidebar, and usage
meter are platform-agnostic. The chat pane needs the `claude` CLI on `PATH`
(Windows install of Claude Code). The editor (Monaco), Files pane, and Browser
(WebView2/Chromium) all run unmodified. Image paste/drop, copy/paste, and
drag-drop work the same.

## 🔩 What was implemented for Windows

Every change is behind a `cfg(windows)` guard or a `USERPROFILE`/temp-dir
fallback, so the macOS build is untouched.

- **`lib.rs`** — aliases `HOME` → `%USERPROFILE%` at startup, which lights up
  every `$HOME`-rooted data source (usage, memory, files).
- **`proc.rs`** — a `NoWindow` trait sets `CREATE_NO_WINDOW` on every child
  `Command`, so a built app (which has no parent console) never flashes a
  conhost window. **Use `.no_window()` on every new `std::process::Command`.**
- **`pty.rs`** — terminals launch PowerShell over ConPTY via a `cfg(windows)`
  path. Persistence is the one gap (see below): the Windows path is
  non-persistent, and oracle/all-tmux attach returns a clean "not supported on
  Windows" error rather than hanging.
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
- **`files.rs`** — `soffice.exe` for previews, the OS temp dir for pasted images
  (was a hardcoded `/tmp/aios-paste`), `file://` URLs, `USERPROFILE` roots.
- **`TerminalPane.tsx`** — focuses the terminal so you can type immediately;
  recovers from a WebGL context loss.
- **`tauri.conf.json`** — `npm` dev/build hooks, an NSIS installer, and the
  signed GitHub-Releases updater.

## ⛔ Still Unix-only (the remaining gaps)

These degrade gracefully (empty / clean error), never crash:

1. **Terminal persistence** — detach/reattach + survive-app-close uses `tmux` on
   macOS/Linux and **psmux** (native Windows tmux) on Windows, on the configurable
   socket (Settings → terminal socket, default `aios`). When neither is installed
   /bundled, terminals fall back to a plain non-persistent ConPTY.
2. **Oracle / tmux panes** — `pty_spawn_oracle` / `pty_spawn_tmux` attach to
   multiplexer sessions and now work on Windows via psmux. The WhatsApp **bridge**
   (which auto-creates oracle sessions on macOS) is separate Unix infra; the
   Windows port is the shell app, not the bridge.
3. **Money agents** — `launchd`-backed daemons; the board shows empty without
   them.

## 🧪 Build & verify

```powershell
npx tsc --noEmit        # frontend types
npx tauri dev           # run it
.\scripts\run.ps1 -Build  # produce an installer (.exe / .msi)
```

> [!NOTE]
> A built `.msi`/`.exe` is the only way to verify the no-console-flash behavior —
> dev mode has a parent console and can't reproduce the flash.
