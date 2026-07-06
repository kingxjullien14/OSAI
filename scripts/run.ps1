<#
.SYNOPSIS
  Launch OSAI on Windows - one command.

.DESCRIPTION
  Installs frontend deps when they're stale, then starts the Tauri dev app
  (Vite + Rust backend, hot-reload). First Rust build takes a few minutes;
  subsequent launches are fast (cached).

  Prefers pnpm (the project's package manager) and falls back to npm when
  pnpm isn't installed. Every step checks its exit code - a failed build
  says FAILED, loudly, instead of pretending it finished.

  ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI, so
  non-ASCII characters would corrupt parsing. Keep this file ASCII.

.PARAMETER Build
  Produce a distributable installer instead of running dev. Reminds you to
  stage the psmux sidecar (persistent terminals) if it isn't staged, and
  lists the produced artifacts when done.

.EXAMPLE
  .\scripts\run.ps1            # dev app
  .\scripts\run.ps1 -Build     # release installer
#>
param([switch]$Build)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$t0 = Get-Date

function Step($msg) { Write-Host "[osai] $msg" -ForegroundColor Cyan }
function Note($msg) { Write-Host "[osai] $msg" -ForegroundColor DarkGray }
function Ok($msg)   { Write-Host "[osai] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[osai] $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  OSAI - the ai cockpit" -ForegroundColor Magenta
Write-Host "  ----------------------" -ForegroundColor DarkGray

# package manager: pnpm is the project default; npm works in a pinch.
$pm = "pnpm"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  $pm = "npm"
  Note "pnpm not found - falling back to npm (npm i -g pnpm to match the project)"
}

# Install deps if node_modules is missing or package.json is newer than it.
$needInstall = $true
if (Test-Path "node_modules") {
  $pkg = (Get-Item "package.json").LastWriteTime
  $nm = (Get-Item "node_modules").LastWriteTime
  if ($nm -ge $pkg) { $needInstall = $false }
}
if ($needInstall) {
  Step "installing frontend deps ($pm)..."
  if ($pm -eq "pnpm") { pnpm install } else { npm install --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) { Fail "dependency install FAILED (exit $LASTEXITCODE)" }
}

if ($Build) {
  if (-not (Test-Path "src-tauri\resources\psmux.exe")) {
    Note "psmux sidecar is NOT staged - the installer won't bundle persistent terminals."
    Note "  stage it first with: pwsh scripts\fetch-psmux.ps1"
  }
  Step "building release installer (this takes a while)..."
  if ($pm -eq "pnpm") { pnpm tauri build } else { npx tauri build }
  if ($LASTEXITCODE -ne 0) {
    Fail "build FAILED (exit $LASTEXITCODE) - scroll up for the first rust/vite error"
  }
  $mins = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
  Ok "build complete in $mins min - artifacts:"
  Get-ChildItem "src-tauri\target\release\bundle" -Recurse -Include "*.exe", "*.msi" -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "  $($_.FullName)" -ForegroundColor Green }
  Note "next: sign + publish per RELEASING.md (make-latest-json.ps1 builds the updater manifest)"
} else {
  Step "starting OSAI (dev)... first Rust build is slow, then cached."
  if ($pm -eq "pnpm") { pnpm tauri dev } else { npx tauri dev }
  if ($LASTEXITCODE -ne 0) { Fail "dev exited with code $LASTEXITCODE" }
}
