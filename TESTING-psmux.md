# Testing the new persistent terminals (psmux) — a first-timer's guide

You've never used this before, so here's the whole thing in plain English, with
exact things to type and click. Take it slow; each test is self-contained.

---

## 1. What is this, and why should I care?

Normally, when you close a terminal, whatever was running inside it **dies**. If
you started a long build, an AI agent, or a server, closing the window (or the
app) kills it.

A **terminal multiplexer** fixes that. It keeps your terminal session alive in
the background on a little server. You can *detach* (walk away, close the pane,
even quit the whole app) and later *reattach* — and everything you left running
is still going, with its output intact. On Mac/Linux this tool is called
**tmux**. tmux doesn't exist on Windows.

**psmux** is "tmux for Windows" — a separate program that does the same job
natively. We just wired AIOS to use it, so your AIOS terminal panes on Windows
can now survive being closed. This guide is you kicking the tires on that.

> **The one-sentence test:** start something in a terminal, close it, bring it
> back — and it's still running. That's the whole feature.

---

## 2. One-time setup (about 5 minutes)

### Step 2a — Install psmux

Open a **new** PowerShell or Windows Terminal window and run:

```powershell
winget install psmux
```

Let it finish. Then **close that window** (important — the next window will pick
up the freshly-installed `psmux`).

Open a **brand-new** PowerShell window and confirm it's there:

```powershell
psmux -V
```

You should see something like `tmux 3.3.6`. (Yes, it says "tmux" — psmux
pretends to be tmux on purpose, so existing tools recognize it. That's expected,
not a bug.)

> If `psmux -V` says "not recognized," the install didn't land on your PATH yet.
> Close ALL terminal windows and open a fresh one, or sign out/in once. Then
> retry. Don't continue until `psmux -V` prints a version.

### Step 2b — Start AIOS

In a fresh PowerShell window, go to the project folder and launch the app:

```powershell
cd C:\FHE-Work\AIOS-Superapp
pwsh -File scripts\run.ps1
```

(If `pwsh` isn't found, use `powershell -File scripts\run.ps1`.)

The first launch compiles the Rust backend and can take a few minutes — that's
normal and only slow the first time. Leave this window open; it's running the
app. The AIOS window will appear on its own.

---

## 3. Quick confidence check: is psmux actually being used?

1. In AIOS, open a **terminal pane**: click **terminal** in the left sidebar.
   (If you can't find it, press **Ctrl+K** to open the command palette, type
   `terminal`, and press Enter.)
2. A terminal opens inside AIOS. Look at the **bottom edge of that pane**.

- **You see a thin status bar** (often a colored strip showing a session name
  like `aios-term-…` and a window number) → **psmux is active. Persistence is
  on.** 🎉
- **No status bar, just a plain PowerShell prompt** → psmux wasn't found, and
  AIOS fell back to a normal (non-persistent) terminal. Go back to Step 2a; jump
  to **Troubleshooting** at the bottom if needed.

Don't close this pane yet — we'll use it.

---

## 4. Test 1 — "Closing a pane doesn't kill what's inside" (5 min)

This proves the session keeps running in the background after you close its pane.

1. In the terminal pane you just opened (**call it Pane A**), start a simple
   counter so we have something visibly "running." Type this and press Enter:

   ```powershell
   while ($true) { Write-Host "still alive: $(Get-Date -Format HH:mm:ss)"; Start-Sleep 1 }
   ```

   You'll see a new line tick by every second. Good — it's running.

2. Open a **second** terminal pane (**Pane B**): click **terminal** in the
   sidebar again (or Ctrl+K → `terminal`). You now have two terminals side by
   side, A still counting.

3. In **Pane B**, ask psmux to list its live sessions:

   ```powershell
   psmux -L aios ls
   ```

   You should see **two** lines, one per pane, e.g.:

   ```
   aios-term-pane-abc123: 1 windows (created ...)
   aios-term-pane-def456: 1 windows (created ...)
   ```

   Those are your two terminals, living on the psmux server. (The names are
   auto-generated — you don't need to memorize them.)

4. Now **close Pane A**: hover Pane A's top bar and click its **✕ (close)**
   button. The pane disappears.

5. Back in **Pane B**, run the list again:

   ```powershell
   psmux -L aios ls
   ```

   **Both sessions are still listed.** Closing the pane only *detached* it — the
   counter is still ticking away in the background, even though you can't see it.

✅ **Pass:** the session you closed is still in the `ls` output.
❌ **Fail:** it vanished from the list (that would mean close = kill; tell me).

---

## 5. Test 2 — "It survives quitting the whole app" (the headline, 10 min)

This is the real payoff: close the **entire app**, reopen it, and your terminal
comes back exactly where you left it.

### Step 5a — Turn on "reopen last layout"

By default AIOS may start with a clean slate. For this test we want it to
restore your panes on launch:

1. Open **Settings**: press **Ctrl+K**, type `settings`, press Enter (or click
   the **gear/settings** icon in the sidebar).
2. Find the toggle labeled **"reopen last layout"** and switch it **ON**.
3. Close Settings.

### Step 5b — Leave something running

1. Open a **terminal pane** (sidebar → **terminal**).
2. Start the counter again:

   ```powershell
   while ($true) { Write-Host "still alive: $(Get-Date -Format HH:mm:ss)"; Start-Sleep 1 }
   ```

3. Watch it for ~5 seconds and note the **last time** it printed (e.g.
   `14:03:07`).

### Step 5c — Quit AIOS completely

Close the AIOS window (the title-bar **✕**). Make sure it's fully gone — if it
hides in the system tray (bottom-right of Windows, near the clock), right-click
its tray icon and choose **Quit/Exit**. The app must be entirely closed.

Wait ~15–20 seconds (so you can prove time passed while it was closed).

### Step 5d — Relaunch and check

Start AIOS again (in your PowerShell window: `pwsh -File scripts\run.ps1`, or
just relaunch it however you started it).

When it comes back:

- Your **terminal pane is restored**, and
- the **counter is still running** — and the timestamps **jumped ahead** past
  when you closed the app (it kept counting the whole time it was shut).

✅ **Pass:** the counter survived the app restart and shows it never stopped.
❌ **Fail:** the terminal is empty / counting from scratch (tell me — that means
the session didn't persist across restart).

---

## 6. Test 3 — Reattach a session you closed (the agents panel)

Each terminal session now carries a **friendly name** (the creation time, e.g.
`Jun 16, 16:45:03`) shown in its status bar — so two terminals are easy to tell
apart. You can also **rename** it and **reattach** it after closing.

1. Open a terminal, run the counter, then **close its pane** (✕). The session
   keeps running in the background (Test 1).
2. Look at the **agents panel** in the sidebar (the "agents" section). Below it
   you'll see a **"reattach (N)"** group listing your detached sessions by their
   friendly name, each with a cold dot (= detached).
3. **Click one** → it pops back into a new pane, reattached to the still-running
   session (your counter is still going).
4. **Rename**: hover a reattach row → click the **pencil** → type a name (e.g.
   "build") → Enter. The status bar + list now show that name. (The rename
   survives detach/reattach; it doesn't affect the underlying session.)
5. This also works **after quitting and reopening the whole app** (Windows keeps
   the sessions running) — the "reattach" list shows them on next launch.

> The name is a timestamp by default (not the pane title, which can change) and
> is set once when the session is created, so it stays stable across reattaches.

## 7. Test 4 — (Optional) keep an AI agent alive

If you have `claude` installed:

1. Open the **claude code** terminal (sidebar, or Ctrl+K → `claude`), or in a
   normal terminal pane run `claude`.
2. Start a conversation / a long task.
3. Close the pane, then bring AIOS back (as in Test 2), or reattach it from the
   agents panel (Test 3).
4. The claude session is still alive — no lost work.

---

## 8. Cleanup (when you're done testing)

The background sessions stick around on purpose. To wipe them all out:

```powershell
psmux -L aios kill-server
```

That stops the psmux server and every leftover `aios-term-…` session in one go.
(AIOS also auto-cleans sessions that have no pane the next time it starts, so
this is optional tidiness.)

To stop the app itself: close the AIOS window, then press **Ctrl+C** in the
PowerShell window that's running `run.ps1`.

---

## 9. Troubleshooting

**"No status bar / it didn't persist" — psmux probably isn't being found.**
- In a fresh PowerShell, run `psmux -V`. No version? Re-do Step 2a and open a
  brand-new window so PATH refreshes.
- Confirm where Windows finds it: `where.exe psmux` (should print a path).
- Make sure you started AIOS *after* installing psmux, from a new terminal (so
  the app inherits the updated PATH).

**`psmux -L aios ls` says "no server running" or "no sessions."**
- That just means no AIOS terminal panes are open right now. Open one first,
  then list.

**The first `run.ps1` launch is taking forever.**
- The first Rust compile is genuinely slow (a few minutes). Later launches are
  fast. Watch the PowerShell window for progress; it's not stuck.

**I want to peek at the sessions myself.**
- `psmux -L aios ls` — list sessions
- `psmux -L aios has-session -t <name>` — check one exists (exit code 0 = yes)

---

## 10. What to tell me afterward

Just report which tests passed/failed, plus:
- Did you see the status bar at the bottom of the terminal pane? (Test 3 check.)
- For Test 2: did the counter keep going across the full app restart?
- Anything weird — a pane that wouldn't open, an error in red, the app flashing
  a console window, sluggish typing — copy the exact text and send it over.

That tells me whether the three things I couldn't verify from my side —
**detach-not-kill, survive-app-close, and clean ConPTY rendering** — actually
work on your machine.
