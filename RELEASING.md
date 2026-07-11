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

Releases are built, signed, and published by **CI** (`.github/workflows/build.yml`)
on a `v*` tag push — no local build needed. `tauri-action` compiles Windows +
macOS, signs the updater artifacts with the `TAURI_SIGNING_PRIVATE_KEY` Actions
secret, generates `latest.json` (all platforms), and creates a **draft** Release.

1. **Bump the version** (keep them in lockstep):
   - `package.json` → `version` — `tauri.conf.json` reads it via `"version": "../package.json"`, so it needs no separate bump
   - `src-tauri/Cargo.toml` → `version` (and the `osai` entry in `src-tauri/Cargo.lock`)
   - the two `v… · Jul.Nazz` literals in `src/components/Settings.tsx` (about hero + sidebar footer)

2. **Commit** the version bump together with the release's changes.

3. **Annotate the tag WITH THE CHANGELOG.** The tag's message *body* is the single
   source of the release notes: the workflow feeds it to `tauri-action` as
   `releaseBody`, which lands in BOTH the GitHub release body **and**
   `latest.json`'s `notes` — the text shown in the in-app **Settings › about ›
   software update** panel. That panel renders **plain text** (`whitespace-pre-line`),
   so write plain prose + bullets (e.g. `•`), not markdown headings.

   ```pwsh
   # put the changelog in a file, then annotate the tag with it:
   git tag -a v<version> -F notes.txt
   ```

   > A lightweight tag (or an annotation with no body) falls back to the tag's
   > subject line — the in-app notes will be one terse line. Always annotate with
   > the full changelog.

4. **Push** — the tag is what triggers the release build:

   ```pwsh
   git push origin main
   git push origin v<version>
   ```

5. **Publish the draft** once CI is green. The build only *drafts* the release;
   publishing is the user-facing step that lets installs auto-update:

   ```pwsh
   gh release edit v<version> --draft=false --latest
   ```

   Then confirm the endpoint resolves to the new version **with** notes:

   ```pwsh
   curl -sL https://github.com/kingxjullien14/OSAI/releases/latest/download/latest.json
   ```

That's it — an older install offers the new version (with the changelog) within a
few seconds of launch, or on demand in **Settings › about**.

## Notes / gotchas

- **Notes source = the annotated tag.** If a release ships with empty in-app notes,
  the tag wasn't annotated with a message body (step 3). Fix after the fact by
  patching `notes` in the release's `latest.json` and re-uploading it
  (`gh release upload v<version> latest.json --clobber`).
- **Both platforms self-update.** CI builds + signs Windows *and* macOS, so
  `latest.json` carries `windows-x86_64` + `darwin-aarch64` entries. (Linux / x64
  macOS aren't in the matrix yet — add runners to extend.)
- `latest.json` is **git-ignored** — a per-release artifact built by CI and
  attached to the release, never source.
- The endpoint needs the repo's releases to be **public** (or the updater can't
  fetch the asset). Private repos need a token-bearing endpoint instead.

## Building locally (optional)

Not needed for a release, but to produce a signed build by hand:

```pwsh
pwsh scripts/fetch-psmux.ps1   # bundle the Windows psmux sidecar (persistent terminals)
$env:TAURI_SIGNING_PRIVATE_KEY          = "$env:USERPROFILE\.aios\keys\aios-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""   # passwordless key
npm run tauri build
```
