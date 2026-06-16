/**
 * In-app self-update (Tauri updater plugin + GitHub Releases).
 *
 * The mechanism: `tauri.conf.json` points the updater at a signed `latest.json`
 * attached to the repo's GitHub release (`releases/latest/download/latest.json`);
 * `check()` compares its `version` against the running build, and — if newer and
 * the minisign signature verifies against the committed pubkey — hands back an
 * `Update` we download, install, and relaunch into. See RELEASING.md for how the
 * manifest + signature are produced at release time.
 *
 * Everything here is a thin, defensive wrapper so the UI (Settings › software
 * update + the quiet boot check) never has to touch the plugin API directly and
 * always degrades gracefully off-Tauri (the web shell) or when offline.
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { isTauriRuntime } from "./tauri";
import { reportDiag } from "./diag";

/** Coarse phase a caller can render. `pct` is null when the server didn't send
 *  a Content-Length (rare) — show an indeterminate bar then. */
export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; pct: number | null }
  | { kind: "installing" }
  | { kind: "ready" } // installed; relaunch pending
  | { kind: "error"; message: string };

/**
 * Ask GitHub Releases whether a newer signed build exists. Returns the `Update`
 * handle (caller installs it) or `null` when already current / not in a Tauri
 * runtime. Throws only on a real failure (offline, malformed manifest) so the
 * caller can surface "couldn't check" distinctly from "up to date".
 */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauriRuntime()) return null;
  try {
    // `check()` returns null when the manifest version <= the running version.
    return await check();
  } catch (e) {
    reportDiag("updater.check", e, {});
    throw e;
  }
}

/**
 * Download + install an `Update`, reporting progress, then relaunch into the new
 * build. On Windows this fetches + runs the signed NSIS setup; `relaunch()`
 * restarts the app once it's applied. The promise normally never resolves
 * (the process is replaced) — treat reaching the end as "ready, relaunching".
 */
export async function installUpdate(
  update: Update,
  onPhase?: (p: UpdatePhase) => void,
): Promise<void> {
  try {
    let total = 0;
    let received = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          onPhase?.({ kind: "downloading", pct: total ? 0 : null });
          break;
        case "Progress":
          received += event.data.chunkLength;
          onPhase?.({
            kind: "downloading",
            pct: total ? Math.min(100, Math.round((received / total) * 100)) : null,
          });
          break;
        case "Finished":
          onPhase?.({ kind: "installing" });
          break;
      }
    });
    onPhase?.({ kind: "ready" });
    await relaunch();
  } catch (e) {
    reportDiag("updater.install", e, { version: update.version });
    onPhase?.({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
