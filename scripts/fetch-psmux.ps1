<#
  fetch-psmux.ps1 - stage the psmux sidecar (the native Windows tmux,
  https://github.com/psmux/psmux) into src-tauri/resources/ so `tauri build`
  bundles it. psmux gives Windows the persistent / detachable terminal sessions
  tmux can't (tmux is unix-only); pty.rs::mux_bin prefers a PATH-installed psmux
  and falls back to this bundled copy.

  Run before a Windows release build (see RELEASING.md):
      pwsh scripts/fetch-psmux.ps1            # latest release, host arch
      pwsh scripts/fetch-psmux.ps1 -Tag v3.3.6 -Arch x64

  Idempotent: re-running re-downloads + overwrites. The binary is gitignored
  (never committed). On non-Windows hosts this is a no-op (psmux is Windows-only)
  so a mac build's `bundle.resources` glob just packages the .gitkeep.
#>
[CmdletBinding()]
param(
  [string]$Tag = "latest",
  [ValidateSet("x64", "arm64", "x86")]
  [string]$Arch = "",
  [string]$Repo = "psmux/psmux"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$destDir = Join-Path $root "src-tauri/resources"
$dest = Join-Path $destDir "psmux.exe"

if (-not $IsWindows -and $env:OS -ne "Windows_NT") {
  Write-Host "fetch-psmux: non-Windows host - skipping (psmux is Windows-only)."
  exit 0
}

if (-not $Arch) {
  $Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { "arm64" }
    "x86"   { "x86" }
    default { "x64" }
  }
}

# Resolve the release (latest or a pinned tag) and find the windows-<arch> zip.
$api = if ($Tag -eq "latest") {
  "https://api.github.com/repos/$Repo/releases/latest"
} else {
  "https://api.github.com/repos/$Repo/releases/tags/$Tag"
}
Write-Host "fetch-psmux: querying $api"
$headers = @{ "User-Agent" = "aios-fetch-psmux" }
if ($env:GITHUB_TOKEN) { $headers["Authorization"] = "Bearer $env:GITHUB_TOKEN" }
$release = Invoke-RestMethod -Uri $api -Headers $headers

$asset = $release.assets | Where-Object { $_.name -like "*windows-$Arch*.zip" } | Select-Object -First 1
if (-not $asset) {
  throw "no windows-$Arch zip asset on psmux release '$($release.tag_name)'. Assets: $($release.assets.name -join ', ')"
}
Write-Host "fetch-psmux: $($release.tag_name) -> $($asset.name)"

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "psmux-$([System.IO.Path]::GetRandomFileName())"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $zip = Join-Path $tmp $asset.name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -Headers $headers
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $exe = Get-ChildItem -Path $tmp -Recurse -Filter "psmux.exe" | Select-Object -First 1
  if (-not $exe) {
    $exe = Get-ChildItem -Path $tmp -Recurse -Filter "*.exe" | Select-Object -First 1
  }
  if (-not $exe) { throw "no .exe found inside $($asset.name)" }

  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  Copy-Item -Path $exe.FullName -Destination $dest -Force
  $size = [math]::Round((Get-Item $dest).Length / 1MB, 1)
  Write-Host "fetch-psmux: staged $dest ($size MB)"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
