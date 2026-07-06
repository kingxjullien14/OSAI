<#
  make-latest-json.ps1 — assemble the Tauri updater manifest (latest.json) from a
  freshly built, SIGNED Windows NSIS bundle, ready to attach to a GitHub release.

  Run from anywhere AFTER a signed build (see RELEASING.md):
      $env:TAURI_SIGNING_PRIVATE_KEY      = "$env:USERPROFILE\.aios\keys\aios-updater.key"
      $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""      # key was generated passwordless
      pnpm tauri build
      pwsh scripts/make-latest-json.ps1 -Notes "what changed in this release"

  It reads version + productName from src-tauri/tauri.conf.json (resolving the
  "../package.json" version POINTER tauri.conf uses), finds the signed
  *-setup.exe + its .sig under target/release/bundle/nsis, and writes latest.json
  pointing at the release asset URL. The endpoint in tauri.conf.json is
  releases/latest/download/latest.json, so as long as latest.json is attached to
  the newest release, every installed app will find it.
#>
[CmdletBinding()]
param(
  [string]$Notes = "",
  [string]$Repo = "kingxjullien14/OSAI",
  [string]$OutFile = "latest.json"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$conf = Get-Content (Join-Path $root "src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
# tauri v2 allows `"version": "../package.json"` (a file POINTER, not a number).
# Resolve it, or the manifest would say "v../package.json" and every installed
# app would reject the update.
if ($version -notmatch '^\d+\.\d+') {
  $version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
}
if ($version -notmatch '^\d+\.\d+') {
  throw "could not resolve a real version (got '$version') from tauri.conf.json/package.json"
}
$product = $conf.productName

$nsisDir = Join-Path $root "src-tauri/target/release/bundle/nsis"
$setup = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $setup) {
  throw "no *-setup.exe under $nsisDir — run 'npm run tauri build' first"
}

$sigFile = "$($setup.FullName).sig"
if (-not (Test-Path $sigFile)) {
  throw "missing signature '$sigFile' — set TAURI_SIGNING_PRIVATE_KEY before building so Tauri emits the .sig"
}

$signature = (Get-Content $sigFile -Raw).Trim()
$assetUrl = "https://github.com/$Repo/releases/download/v$version/$($setup.Name)"
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$manifest = [ordered]@{
  version   = $version
  notes     = $Notes
  pub_date  = $pubDate
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signature
      url       = $assetUrl
    }
  }
}

$json = $manifest | ConvertTo-Json -Depth 6
$outPath = Join-Path $root $OutFile
# WriteAllText → UTF-8 WITHOUT a BOM (Set-Content -Encoding utf8 adds one on
# PS 5.1, which can trip strict JSON parsers).
[System.IO.File]::WriteAllText($outPath, $json)

Write-Host "wrote $outPath for $product v$version"
Write-Host "  asset:     $assetUrl"
Write-Host "  signature: $($signature.Substring(0, [Math]::Min(24, $signature.Length)))..."
Write-Host ""
Write-Host "publish (uploads BOTH the installer and the manifest to the v$version release):"
Write-Host "  gh release create v$version '$($setup.FullName)' '$outPath' -t 'v$version' -n '$Notes'"
Write-Host "or, if the release already exists:"
Write-Host "  gh release upload v$version '$($setup.FullName)' '$outPath' --clobber"
