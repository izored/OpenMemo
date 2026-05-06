<#
.SYNOPSIS
    OpenMemo release script.

.PARAMETER Bump
    major | minor | patch

.PARAMETER Title
    Short release title for commit message and GitHub Release.

.PARAMETER Date
    Release date override (default: today, YYYY-MM-DD).

.PARAMETER DryRun
    Preview without writing files or running git/gh commands.

.EXAMPLE
    .\bump-version.ps1 patch -Title "fix blank page, Ollama fallback"
#>
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet("major", "minor", "patch")]
    [string]$Bump,

    [Parameter(Mandatory)]
    [string]$Title,

    [string]$Date = (Get-Date -Format "yyyy-MM-dd"),

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion -ge [version]"7.3") {
    $PSNativeCommandErrorActionPreference = 'Stop'
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $root) { $root = $PWD.Path }

# --- Read current version ---
$configPath = Join-Path $root "backend\config.py"
$configText = Get-Content $configPath -Raw
if ($configText -notmatch 'VERSION:\s*str\s*=\s*"(\d+)\.(\d+)\.(\d+)"') {
    throw "Could not parse VERSION from backend/config.py"
}
$oldVersion = "$([int]$Matches[1]).$([int]$Matches[2]).$([int]$Matches[3])"
$maj = [int]$Matches[1]; $min = [int]$Matches[2]; $pat = [int]$Matches[3]

switch ($Bump) {
    "major" { $maj++; $min = 0; $pat = 0 }
    "minor" { $min++;           $pat = 0 }
    "patch" {                   $pat++   }
}
$newVersion = "$maj.$min.$pat"

Write-Host "Version: $oldVersion -> $newVersion"
Write-Host ""

# --- Pre-flight ---
Write-Host "Pre-flight..."

$branch = (git branch --show-current 2>&1)
if ($LASTEXITCODE -ne 0 -or $branch.Trim() -ne "main") {
    throw "Not on main (on '$($branch.Trim())'). Switch first."
}
Write-Host "  OK  On main"

$dirty = (git status --porcelain 2>&1)
if ($LASTEXITCODE -ne 0) { throw "git status failed" }
if ($dirty) { throw "Uncommitted changes present. Commit or stash first." }
Write-Host "  OK  Clean working tree"

$ghExe = (Get-Command gh -ErrorAction SilentlyContinue)
if (-not $ghExe) {
    $ghPath = "C:\Program Files\GitHub CLI\gh.exe"
    if (Test-Path $ghPath) { $ghExe = Get-Command $ghPath }
    else { throw "gh not found. Install: winget install --id GitHub.cli" }
}
& $ghExe.Source auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "gh not authenticated. Run: gh auth login" }
Write-Host "  OK  gh authenticated"
Write-Host ""

# --- Find TEMP_CHANGELOG ---
$tempFiles = Get-ChildItem -Path $root -Filter "TEMP_CHANGELOG_v*.md" -ErrorAction SilentlyContinue
if (-not $tempFiles) {
    throw "No TEMP_CHANGELOG_v*.md found in repo root. Create it with the release notes first."
}
if ($tempFiles.Count -gt 1) {
    throw "Multiple TEMP_CHANGELOG files: $($tempFiles.Name -join ', '). Keep only one."
}
$tempPath = $tempFiles[0].FullName
$tempContent = Get-Content $tempPath -Raw
Write-Host "Notes: $($tempFiles[0].Name)"
Write-Host ""

if ($DryRun) {
    Write-Host "[DryRun] $oldVersion -> $newVersion"
    Write-Host "[DryRun] Commit:  release: v$newVersion - $Title"
    Write-Host "[DryRun] Release: OpenMemo v$newVersion — $Title"
    exit 0
}

# --- Bump version files ---
Write-Host "Bumping version files..."
$replacements = @(
    @{
        Path    = "backend\config.py"
        Pattern = '(VERSION:\s*str\s*=\s*")\d+\.\d+\.\d+(")'
        Replace = '${1}' + $newVersion + '${2}'
    },
    @{
        Path    = "README.md"
        Pattern = '(version-)\d+\.\d+\.\d+(-\d+.*?style)'
        Replace = '${1}' + $newVersion + '${2}'
    },
    @{
        Path    = "chrome-extension\manifest.json"
        Pattern = '("version"\s*:\s*")\d+\.\d+\.\d+(")'
        Replace = '${1}' + $newVersion + '${2}'
    }
)

$staged = [System.Collections.Generic.List[string]]::new()
foreach ($r in $replacements) {
    $fp = Join-Path $root $r.Path
    if (-not (Test-Path $fp)) { Write-Warning "Skipping missing file: $($r.Path)"; continue }
    $orig    = Get-Content $fp -Raw
    $updated = [regex]::Replace($orig, $r.Pattern, $r.Replace)
    if ($orig -eq $updated) { Write-Warning "No version match in $($r.Path)"; continue }
    Set-Content -Path $fp -Value $updated -NoNewline
    $staged.Add($r.Path)
    Write-Host "  + $($r.Path)"
}

# --- Prepend to docs/CHANGELOG.md ---
$changelogPath = Join-Path $root "docs\CHANGELOG.md"
if (Test-Path $changelogPath) {
    $existing = Get-Content $changelogPath -Raw
    $section  = "## [$newVersion] - $Date — $Title`n`n" + $tempContent.TrimEnd() + "`n`n---`n`n"
    Set-Content -Path $changelogPath -Value ($section + $existing) -NoNewline
    $staged.Add("docs\CHANGELOG.md")
    Write-Host "  + docs/CHANGELOG.md"
}
Write-Host ""

# --- Commit + tag (local only until gh release succeeds) ---
Write-Host "Committing..."
foreach ($f in $staged) {
    git add (Join-Path $root $f)
    if ($LASTEXITCODE -ne 0) { throw "git add failed: $f" }
}
$commitMsg = "release: v$newVersion - $Title"
git commit -m $commitMsg
if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
Write-Host "  OK  $commitMsg"

git tag -a "v$newVersion" -m "OpenMemo v$newVersion"
if ($LASTEXITCODE -ne 0) { throw "git tag failed" }
Write-Host "  OK  Tag v$newVersion"
Write-Host ""

# --- GitHub Release (before push — failure here is recoverable) ---
Write-Host "Creating GitHub Release..."
& $ghExe.Source release create "v$newVersion" `
    --title "OpenMemo v$newVersion — $Title" `
    --notes-file "$tempPath" `
    --target main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "GitHub Release failed. Commit + tag are local only (not pushed). Retry:"
    Write-Host "  gh release create v$newVersion --title ""OpenMemo v$newVersion — $Title"" --notes-file ""$tempPath"""
    Write-Host "  git push origin main --tags"
    exit 1
}
Write-Host "  OK  Release created"
Write-Host ""

# --- Push ---
Write-Host "Pushing..."
git push origin main --tags
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed. Release exists on GitHub. Run: git push origin main --tags"
    exit 1
}
Write-Host "  OK  Pushed"

# --- Cleanup ---
Remove-Item $tempPath
Write-Host "  OK  Deleted $($tempFiles[0].Name)"
Write-Host ""
Write-Host "Done: https://github.com/izored/OpenMemo/releases/tag/v$newVersion"
