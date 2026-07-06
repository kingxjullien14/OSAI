# Releasing OSAI (signed self-update via GitHub Releases)

OSAI ships an in-app updater (`tauri-plugin-updater`). On launch it quietly checks
GitHub Releases for a newer **signed** build and nudges you toward
**Settings › about › software update**, which downloads, installs, and relaunches
in place. This file is the release-side counterpart: how a new version gets built,
signed, and published so existing installs can find it.

## How it works

- `src-tauri/tauri.conf.json` → `plugins.updater`:
  - `endpoints`: `https://github.com/kingxjullien14/OSAI/releases/latest/download/latest.json`
    — `releases/latest/download/...` always resolves to the newest release's asset,
    so you never have to update the endpoint.
  - `pubkey`: the **public** half of the updater signing key (safe to commit).
- The app trusts an update only if `latest.json`'s version is newer **and** the
  bundle's signature verifies against that pubkey. No valid signature → no update.

## The signing key (one-time, already done)

Generated once with:

```pwsh
npx tauri signer generate -w "$env:USERPROFILE\.aios\keys\aios-updater.key" --ci
```

- **Private key:** `~/.aios/keys/aios-updater.key` — **never commit, never lose it.**
  If it's lost, you can't sign updates and clients pinned to the current pubkey
  will stop accepting new releases (you'd have to ship a manual reinstall carrying
  a new pubkey). It was generated **passwordless** for build simplicity; you can
  rotate to a password-protected key later.
- **Public key:** already pasted into `tauri.conf.json` → `plugins.updater.pubkey`.

## Cutting a release

1. **Bump the version** in all three (keep them in lockstep):
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
   - `package.json` → `version`
   - and the two version literals in `src/components/Settings.tsx` (`v… · Jul.Nazz`
     — the about hero + the sidebar footer).

2. **Stage the psmux sidecar** (Windows builds — the bundled "native Windows
   tmux" that powers persistent/detachable terminal panes). Fetches the latest
   psmux release into `src-tauri/resources/` (gitignored), which the
   `bundle.resources` glob then packages:

   ```pwsh
   pwsh scripts/fetch-psmux.ps1            # latest, host arch (x64/arm64)
   ```

   Skip-able: if you omit this, the app still bundles fine (the glob just packs
   the `.gitkeep`) and falls back to a PATH-installed psmux or a non-persistent
   PTY at runtime — but bundling guarantees persistence works out-of-the-box.

3. **Build, signed.** Point Tauri at the private key so it emits the `.sig`:

   ```pwsh
   $env:TAURI_SIGNING_PRIVATE_KEY          = "$env:USERPROFILE\.aios\keys\aios-updater.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""   # passwordless key
   npm run tauri build
   ```

   Output (Windows): `src-tauri/target/release/bundle/nsis/OSAI_<version>_x64-setup.exe`
   plus a matching `…-setup.exe.sig`. (`createUpdaterArtifacts: true` in the config
   is what makes Tauri produce the `.sig`.)

4. **Generate the manifest:**

   ```pwsh
   pwsh scripts/make-latest-json.ps1 -Notes "short changelog line"
   ```

   Writes `latest.json` at the repo root, pointing at the v`<version>` release asset.

5. **Publish** (uploads the installer **and** the manifest to the release; the
   script prints these exact commands too):

   ```pwsh
   gh release create v<version> `
     "src-tauri/target/release/bundle/nsis/OSAI_<version>_x64-setup.exe" `
     "latest.json" -t "v<version>" -n "short changelog line"
   ```

   Re-publishing to an existing tag? `gh release upload v<version> <files> --clobber`.

That's it — open an older OSAI install and within a few seconds of launch it'll
offer the new version, or check on demand in **Settings › about**.

## Notes / gotchas

- **Only Windows is wired** in `latest.json` (`windows-x86_64`). To also self-update
  macOS/Linux, build on those platforms and add their `.app.tar.gz`/`AppImage` +
  `.sig` entries to the `platforms` map (extend `make-latest-json.ps1`).
- `latest.json` is **git-ignored** — it's a per-release artifact, regenerated each
  time and uploaded, not source.
- The endpoint needs the repo's releases to be **public** (or the updater can't
  fetch the asset). Private repos need a token-bearing endpoint instead.
