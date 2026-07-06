<#
.SYNOPSIS
  The OSAI desktop launcher: open the app (your current code, no auto-sync).

.DESCRIPTION
  This is what the Desktop "OSAI" icon runs. It:
    1. installs deps only when package.json changed
    2. launches the app (Tauri dev - hot reload of your local source)
  It does NOT fetch or merge anything - you stay on exactly your own code.

  (The filename keeps the aios- prefix on purpose: desktop shortcuts and any
  scheduled tasks point at this exact path.)

  ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI, so
  non-ASCII characters would corrupt parsing. Keep this file ASCII.
#>
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Say($m) { Write-Host "[osai] $m" -ForegroundColor Cyan }

# package manager: pnpm is the project default; npm works in a pinch.
$pm = "pnpm"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { $pm = "npm" }

# 1. install deps only when package.json is newer than node_modules
$needInstall = $true
if (Test-Path "node_modules") {
  if ((Get-Item "node_modules").LastWriteTime -ge (Get-Item "package.json").LastWriteTime) {
    $needInstall = $false
  }
}
if ($needInstall) {
  Say "installing deps ($pm)..."
  if ($pm -eq "pnpm") { pnpm install } else { npm install --no-audit --no-fund }
}

# 2. launch the app (your local source only)
Say "launching OSAI..."
if ($pm -eq "pnpm") { pnpm tauri dev } else { npx tauri dev }
