<#
.SYNOPSIS
  LEGACY - sync upstream changes into this branch, and push.

.DESCRIPTION
  *** LEGACY (Firaz-era) ***
  Written when this tree tracked Firaz's AIOS as its direct upstream. OSAI has
  diverged since (the upstream remote now has an UNRELATED history - his ideas
  are hand-ported, never merged), so running a merge from it will conflict on
  everything. Kept for reference; at most use -Preview to see what changed
  upstream. Day to day you want plain `git push origin main`.

  ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI, so non-ASCII
  characters would corrupt parsing. Keep this file ASCII.

.PARAMETER Preview
  Only SHOW what upstream changed upstream (incoming commits + files). No merge.

.PARAMETER Push
  Commit any local changes and push this branch to origin (for the team).

.EXAMPLE
  .\scripts\aios-sync.ps1 -Preview      # see what's new from upstream
  .\scripts\aios-sync.ps1               # pull his changes + rebuild
  .\scripts\aios-sync.ps1 -Push         # publish our branch for the team
#>
param(
  [switch]$Preview,
  [switch]$Push
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Say($msg, $color = "Cyan") { Write-Host ">> $msg" -ForegroundColor $color }
function Die($msg) { Write-Host "x $msg" -ForegroundColor Red; exit 1 }

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Say "repo:   $repo"
Say "branch: $branch"

# Always fetch so we're comparing against the freshest upstream.
Say "fetching origin..."
git fetch origin --quiet

$incoming = (git rev-list --count "HEAD..origin/master").Trim()
Say "upstream has $incoming new commit(s) on origin/master not in your branch."

if ($incoming -ne "0") {
  Write-Host ""
  Write-Host "-- what upstream changed -----------------------------" -ForegroundColor Yellow
  git log --oneline --no-decorate "HEAD..origin/master"
  Write-Host ""
  Write-Host "-- files he touched -------------------------------" -ForegroundColor Yellow
  git diff --stat "HEAD..origin/master"
  Write-Host ""
}

# PUSH mode: commit local work + publish the branch.
if ($Push) {
  $dirty = git status --porcelain
  if ($dirty) {
    Say "committing local changes..."
    git add -A
    $msg = "windows: sync " + (Get-Date -Format "yyyy-MM-dd HH:mm")
    git commit -m $msg | Out-Null
  } else {
    Say "working tree clean - nothing new to commit."
  }
  Say "pushing $branch to origin..."
  git push -u origin $branch
  Say "pushed. teammates pull with:  git pull origin $branch" "Green"
  exit 0
}

# PREVIEW mode: stop after showing the diff.
if ($Preview) {
  Say "preview only - no changes made. Run without -Preview to merge + rebuild." "Green"
  exit 0
}

if ($incoming -eq "0") {
  Say "already up to date with upstream. nothing to merge." "Green"
  exit 0
}

# SYNC mode: require a clean tree, then merge.
$dirty = git status --porcelain
if ($dirty) {
  Write-Host "x You have uncommitted changes. Commit or stash them first:" -ForegroundColor Red
  git status --short
  Write-Host "  (tip: .\scripts\aios-sync.ps1 -Push   to commit + publish them)" -ForegroundColor DarkGray
  exit 1
}

Say "merging origin/master into $branch..."
$mergeFailed = $false
git merge --no-edit origin/master
if ($LASTEXITCODE -ne 0) { $mergeFailed = $true }

if ($mergeFailed) {
  # The ONLY expected conflict: pnpm-lock.yaml (we deleted it; we use npm).
  # Auto-resolve that one; anything else is a real conflict for a human.
  $conflicts = git diff --name-only --diff-filter=U
  $remaining = @()
  foreach ($f in $conflicts) {
    if ($f -eq "pnpm-lock.yaml") {
      Say "auto-resolving pnpm-lock.yaml (Windows uses npm)..."
      git rm -f pnpm-lock.yaml | Out-Null
    } else {
      $remaining += $f
    }
  }
  if ($remaining.Count -gt 0) {
    Write-Host "x Real conflicts need a human (likely upstream changed the same lines we did):" -ForegroundColor Red
    $remaining | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host "  Resolve them, then run:  git commit  &&  .\scripts\aios-sync.ps1" -ForegroundColor DarkGray
    exit 1
  }
  git commit --no-edit | Out-Null
  Say "lockfile conflict auto-resolved."
}

# Rebuild: refresh deps + verify both layers compile.
Say "installing frontend deps (npm)..."
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Die "npm install failed." }

Say "type-checking frontend (tsc)..."
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Die "frontend type-check failed - the upstream changes may need a Windows tweak." }

Say "compiling Rust backend (cargo)..."
Push-Location src-tauri
cargo build --color never 2>&1 | Select-String -Pattern "error\[|^error:|Finished" | ForEach-Object { Write-Host "    $_" }
$cargoOk = ($LASTEXITCODE -eq 0)
Pop-Location
if (-not $cargoOk) { Die "cargo build failed - the upstream changes may need a Windows tweak (check the errors above)." }

Write-Host ""
Say "synced the upstream $incoming commit(s) and rebuilt clean." "Green"
Say "  launch with:  .\scripts\run.ps1     publish with:  .\scripts\aios-sync.ps1 -Push" "Green"
