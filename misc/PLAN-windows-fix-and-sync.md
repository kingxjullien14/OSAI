# Plan — Windows terminal-spam fix + what to pull from `feat/cross-machine-sync`

> Drafted 2026-06-14. Investigated Firaz's repo `ferazfhansurie/aios-superapp`,
> branch `feat/cross-machine-sync`, from `898e7d3` to its tip (`6d5d60e`, 38
> commits). Fetched locally as remote `feraz`.
>
> **Also checked `windows-port` (`c826e38` → tip `c50d130`, 17 commits).** Despite
> the name it contains **no Windows-specific work** — it is a strict *subset* of
> `feat/cross-machine-sync` (identical SHAs; cross-machine-sync = windows-port +
> the box/tailnet commits on top). Its range diff has **zero**
> `creation_flags` / `CREATE_NO_WINDOW` / `conhost` / `cfg!(windows)` /
> `CommandExt` / `USERPROFILE` tokens. So **neither** branch carries a Windows
> terminal-spam fix — Part 1 below is the real fix, and the Part 2 catalog
> already covers every portable commit on windows-port (they're the same SHAs).

## TL;DR

1. **The Windows "spamming new terminals" fix is NOT in Firaz's branch.** The
   full 38-commit range adds **zero** `CREATE_NO_WINDOW` / `creation_flags` /
   `no_window` anywhere (verified by grepping the entire range diff). Firaz
   develops on macOS, so he never sees this. Whatever he "fixed" is either a
   different issue or unmerged — it is not on this branch.
2. **The root cause is in OUR code, and it's fixable in ~1 small batch.** In a
   *built* Windows app (no parent console), every `std::process::Command` we
   spawn **without** the `CREATE_NO_WINDOW` flag pops its own console window.
   Several of those spawns run **on a poll/timer** (git repo-pulse, usage
   `curl`, `ccusage`), so the built app flashes a new console every few seconds
   = "spamming new terminals." Only `browser.rs` / `browser_store.rs` currently
   set the flag.
3. **Our repo and Firaz's have UNRELATED histories** (no common merge-base — our
   tree was re-`git init`ed on Jun 11). So nothing here can be `cherry-pick`ed
   or merged cleanly; each item below is a **manual replication** from the diff.

---

## Part 1 — The terminal-spam fix (do this first; it's the ask)  ✅ SHIPPED

> Implemented 2026-06-14: new `src-tauri/src/proc.rs` (`NoWindow` trait) wired in
> `lib.rs`, `.no_window()` applied to every Windows-live spawn in `files.rs`
> (git ×7 / soffice / rg), `usage.rs` (curl ×2 / sqlite3), `stats.rs`
> (ccusage ×2), and folded into `chat.rs::detach_child_process` (covers
> claude / codex / opencode / app-server). `cargo check` clean — the old
> `unused cmd` warning is gone. **Build-verify on Windows still pending** (see
> "Verify" below — dev mode has a parent console and won't reproduce the flash).

### Root cause (confirmed)

In `src-tauri/src/`, these spawn sites do **not** suppress the console window,
and the polled ones flash repeatedly in the built app:

| File | Lines | What it spawns | Cadence | Windows-live? |
|---|---|---|---|---|
| `files.rs` | 147–328 | `git` (repo pulse: toplevel/branch/status/ahead-behind, **per project**) | **polled by the idle dashboard** | ✅ — main culprit |
| `usage.rs` | 71, 279 | `curl.exe` (usage fetch) | **polled (~30s)** | ✅ |
| `stats.rs` | 143–149 | `ccusage` / `npx` (usage stats) | **polled** | ✅ |
| `files.rs` | 953 | `soffice.exe` (office preview) | on demand | ✅ (flash on open) |
| `files.rs` | 1274 | `rg` (global search) | on demand | ✅ (flash on search) |
| `usage.rs` | 333 | `sqlite3` | on demand | ✅ |
| `chat.rs` | 699, 940, 941, 1269 | `claude` / `codex` / `opencode` / app-server | per session / per turn | ✅ (flash per send, worst on opencode) |
| `device.rs` | 81 | `pmset` | polled | ❌ macOS-only |
| `pty.rs` | 493, 511 | `tmux` (unix) / **`psmux`** (windows) | on demand | ✅ — psmux (native Windows tmux) backs persistent/detachable panes; `mux_bin` prefers PATH then a bundled sidecar (`scripts/fetch-psmux.ps1`), else falls back to a non-persistent PTY |
| `bridges.rs` / `monitor.rs` / `oracles.rs` / `mac_apps.rs` | — | `launchctl` / `tmux` / mac | — | ❌ inert on Windows |

> **Future option (not built, deliberate):** psmux can run Claude Code "agent
> teams" — interactive `claude` in a psmux pane spawning each sub-agent in its
> own visible pane (docs/claude-code.md). Only the interactive *claude-code*
> terminal pane qualifies (not the `claude -p` chat pane), needs PowerShell 7+,
> and **Opus prefers invisible worktree agents** so panes rarely appear without a
> CLAUDE.md "prefer teammates" nudge. If revisited: inject `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
> + `PSMUX_CLAUDE_TEAMMATE_MODE=tmux` via psmux `new-session -e` in `pty.rs`.

**Not the PTY.** `pty.rs` uses `portable_pty::native_pty_system()` → ConPTY on
Windows, which runs its `conhost` hidden (pseudo-console). The terminal *pane*
is not the spam source; the polled `git`/`curl`/`ccusage` console flashes are.

### The fix (shared helper + apply everywhere)

Add one tiny cross-platform helper and call it before every `.output()` /
`.spawn()` / `.status()` on a `std::process::Command`. New file
`src-tauri/src/proc.rs`:

```rust
//! One place that suppresses the child-process console window on Windows.
//! In a built app (no parent console) any un-flagged spawn pops its own
//! conhost window — on a poll that reads as "spamming new terminals".
//! No-op on Unix.
pub trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}
```

Wire `mod proc;` in `lib.rs`, then in each file: `use crate::proc::NoWindow;`
and insert `.no_window()` into the builder chain before the terminal call, e.g.

```rust
let out = std::process::Command::new("git")
    .args(["-C", &root, "status", "--porcelain", "--ignored=no"])
    .no_window()           // <-- add
    .output()?;
```

**Apply to every call site in:** `files.rs` (all `git`, `rg`, `soffice`),
`usage.rs` (both `curl`, `sqlite3`), `stats.rs` (`ccusage`/`npx`), `chat.rs`
(claude/codex/opencode/app-server spawns). Leave the Unix/mac-only ones alone
(harmless to flag, but unnecessary). `browser.rs` / `browser_store.rs` already
do it inline — optionally refactor them onto the helper for consistency.

> The existing `chat.rs::detach_child_process(cmd)` is `#[cfg(unix)]`-only (a
> no-op on Windows — hence the `unused cmd` warning). Fold `.no_window()` into
> that same helper so chat spawns get both treatments from one call.

### Verify

- `cargo check` clean (0 new warnings; the `unused cmd` warning disappears once
  the Windows arm uses `cmd`).
- **Build the installer** (`.\scripts\run.ps1 -Build`) and run the *built* app
  (dev mode has a parent console so it won't reproduce). Sit on the idle
  dashboard ~2 min with a git project open: **no console windows should flash.**
- Send a chat message (esp. an opencode model) → no flash on spawn.
- Open the Files pane on a repo, run a global search → no flash.
- If ANY flash remains, grep for a missed `Command::new` and add `.no_window()`.

### Secondary (only if a flash persists after the above)

- ConPTY edge: some Windows builds flash a `conhost` on PTY open. If observed,
  check `portable-pty` version / pass the ConPTY no-window path. Unlikely — list
  it only as a fallback.

---

## Part 2 — Fixes & features worth replicating from the branch

> **SHIPPED 2026-06-14** (hand-ported; unrelated histories so no cherry-pick):
> Batch A browser urlNormalize + reportError `f218ca5` · Batch B pty wave-1C
> `1f18894` · Batch C editor save-conflict UX `b9a7765` · **LSP (TS/JS + Rust)
> `910dd5d`** (Windows-adapted: node_bin Windows arm, rust-analyzer/.exe + PATH
> resolution, `.no_window()` on every server spawn). Each gated (cargo/tsc/
> tests/build) green. LSP needs server binaries installed to light up — see the
> commit body. Remaining catalog below is reference for anything not yet pulled.

**Constraint:** unrelated histories → no cherry-pick. Each is a manual port, and
our `App.tsx` / `ChatPane.tsx` have diverged hard (Waves 4–5), so UI-heavy ones
will need hand-merging, not diff-apply. Recommendation tiers below.

### Already in our tree (skip — verify only)
- `3632200` canonical **fileKinds** module — our history already has it.
- `fa5410e` **shell history persistence** — already present.
- `a8a22d3` **pane-nav shortcuts / stable pane keys / chrome catalog** — present.
- `c826e38` moneyAgents **runtime home** (no hardcoded `/Users/firaz…`) — we
  already have the equivalent (`cleanseStored` / `ensureMoneyAgentHome`, asserted
  in `bundleBoundaries.test.ts`). Verify, don't re-port.
- `b9c22d1` / `7318124` **claude real-time steering** — we appear to have this
  (chatPaneState `stopStrategy` / `interrupt`, steering asserts in the ratchet).
  Verify parity; port only deltas.

### Tier 1 — high value, contained, low risk (recommend porting)
- **`64899fe` pty wave 1C** — dead-session hard errors, structured `pty-exit`,
  **orphan GC**, bracketed paste. `pty.rs` (+242) / `pty.ts` (+60), self-contained.
  Improves terminal robustness and could also prevent any *real* respawn loop.
  **Best companion to Part 1.**
- **`1023914` browser normalizeUrl** — dev-host heuristics fix + `reportError`
  diag helper, **ships with `urlNormalize.test.ts`**. Small, well-tested, isolated.
- **`3632200`** already in tree — but if our copy predates it, diff for the test.

### Tier 2 — valuable features, larger surface (port deliberately, own batch each)
- **`6635c90` editor save-conflict UX** — keep-mine / take-disk / show-diff +
  idle external-change watcher. `files.rs` (+87) / `EditorPane.tsx` (+138).
  Genuine correctness feature (no silent overwrites). Medium effort.
- **`29e7db1` perf + sidebar** — memo'd transcript, idle chunk prefetch, OPEN-rail
  polish. Touches `ChatPane.tsx` heavily (which we've changed a lot in W5) →
  replicate the *ideas* (memoization, prefetch), don't diff-apply.

### Tier 3 — big, optional (only if we actually want the capability)
- **`24b3855` LSP (Track B)** — Rust supervisor + hand-rolled TS client
  (diagnostics/hover/def/completions), new `lsp.rs` + `src/lib/lsp/*` (~3.3k LOC,
  brings a `pnpm-lock.yaml` we'd convert to npm). Real editor IDE-ification, but
  a project in itself. Defer unless the editor pane is a priority.
- **`03c7b48` CDP Chrome-as-a-pane spike** — experimental; we already ship the
  native WebView2 browser pane. Skip.

### Skip — Firaz-infra specific (the actual point of this branch)
The bulk of the branch is **cross-machine sync** plumbing for *his* multi-box
tailnet setup — not useful for our single-machine Windows daily driver:
- `aios-noded` daemon, `node_registry`, Mac-side remote-attach, box session over
  tailnet WS (`c92a5b9`, `cca852d`, `e20fadd`, `6d5d60e`, `445a1b2`).
- "box" idle dashboard (Vercel-style server cockpit, PM2 monitor, `AIOS_FULLSCREEN`)
  (`4782525`, `a1611c9`, `1fd5592`).
- `aios-chat-core` crate extraction + codex app-server RPC refactor (`bbaf62f`,
  `51bb84c`, `184c1e1`, `ab610a7`, `3c771a0`) — a large architectural refactor;
  only worth it if we adopt the cross-machine work, which we shouldn't.
- persistent-agent runtime + localhost control hook (`f21bf25`) — tied to the box
  fleet model.

---

## Suggested sequencing

1. **Part 1 (terminal spam)** — the `NoWindow` helper + apply to all polled/live
   spawns. One batch, one commit. Build-verify on Windows. *This is the user's ask.*
2. **`64899fe` pty wave 1C** — terminal robustness, pairs naturally with #1.
3. **`1023914` browser normalizeUrl** — quick, tested win.
4. **`6635c90` editor save-conflict** — when the editor pane gets attention.
5. Revisit LSP (`24b3855`) only if we decide to invest in the editor.

## Cleanup
The investigation added a git remote: `git remote remove feraz` when done (kept
for now so the diffs above stay inspectable).
