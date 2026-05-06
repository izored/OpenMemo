<#
.SYNOPSIS
    Full OpenMemo release script — bump version, commit, tag, and create GitHub release.

.DESCRIPTION
    Reads current version from backend/config.py, computes the new version
    based on bump type (major | minor | patch), updates every file that carries
    the version string, commits, tags, creates a GitHub Release, and pushes.

.PARAMETER Bump
    Which semver segment to increment: major, minor, or patch.

.PARAMETER Title
    Short release title for the commit message (e.g. "fix blank page, Ollama fallback").
    Defaults to a generic title.

.PARAMETER Date
    Optional release date override (default: today).

.PARAMETER SkipChangelog
    Skip prepending a new blank section to docs/CHANGELOG.md.
    Use this if you already wrote the changelog section before running the script.

.PARAMETER DryRun
    Print what would change without writing any files or creating releases.

.EXAMPLE
    .\bump-version.ps1 patch -Title "fix blank page, Ollama fallback, memo sort"
    # Full release: bump -> commit -> tag -> GitHub release -> push

.EXAMPLE
    .\bump-version.ps1 minor -DryRun
    # Shows diff but does not modify anything
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("major", "minor", "patch")]
    [string]$Bump,

    [string]$Title = "",

    [string]$Date = (Get-Date -Format "yyyy-MM-dd"),

    [switch]$SkipChangelog,

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# --- Resolve gh CLI path ---
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    $ghPath = "C:\Program Files\GitHub CLI\gh.exe"
    if (Test-Path $ghPath) {
        $gh = Get-Command $ghPath
    } else {
        throw "GitHub CLI (gh) not found. Install it: winget install --id GitHub.cli"
    }
}

# --- Resolve project root ---
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $root) { $root = $PWD }

# --- Read current version from single source of truth ---
$configPath = Join-Path $root "backend\config.py"
if (-not (Test-Path $configPath)) {
    throw "Cannot find backend/config.py - are you running from repo root?"
}

$configText = Get-Content $configPath -Raw
if ($configText -notmatch 'VERSION:\s*str\s*=\s*"(\d+)\.(\d+)\.(\d+)"') {
    throw "Could not parse VERSION from backend/config.py"
}

$currentMajor = [int]$Matches[1]
$currentMinor = [int]$Matches[2]
$currentPatch = [int]$Matches[3]
$currentVersion = "$currentMajor.$currentMinor.$currentPatch"

# --- Compute new version ---
switch ($Bump) {
    "major" { $newMajor = $currentMajor + 1; $newMinor = 0; $newPatch = 0 }
    "minor" { $newMajor = $currentMajor; $newMinor = $currentMinor + 1; $newPatch = 0 }
    "patch" { $newMajor = $currentMajor; $newMinor = $currentMinor; $newPatch = $currentPatch + 1 }
}
$newVersion = "$newMajor.$newMinor.$newPatch"

if (-not $Title) {
    $Title = "release v$newVersion"
}

Write-Host "Current version: $currentVersion"
Write-Host "New version:     $newVersion"
Write-Host "Title:           $Title"
Write-Host ""

# --- Define file replacements ---
# Each entry: Path relative to root, regex pattern, replacement template
$replacements = @(
    @{
        Path    = "backend\config.py"
        Pattern = '(VERSION:\s*str\s*=\s*")\d+\.\d+\.\d+("\s*)'
        Replace = '${1}' + $newVersion + '${2}'
    },
    @{
        Path    = "README.md"
        Pattern = '(version-)\d+\.\d+\.\d+(-\d+.*?style)'
        Replace = '${1}' + $newVersion + '${2}'
    },
    @{
        Path    = "chrome-extension\manifest.json"
        Pattern = '("version"\s*:\s*")\d+\.\d+\.\d+("\s*,?)'
        Replace = '${1}' + $newVersion + '${2}'
    }
)

# --- Execute replacements ---
$changedFiles = @()
foreach ($r in $replacements) {
    $filePath = Join-Path $root $r.Path
    if (-not (Test-Path $filePath)) {
        Write-Warning "Skipping missing file: $($r.Path)"
        continue
    }

    $original = Get-Content $filePath -Raw
    $updated  = [regex]::Replace($original, $r.Pattern, $r.Replace)

    if ($original -eq $updated) {
        Write-Host "  - $($r.Path) - no match"
        continue
    }

    $changedFiles += $r.Path

    if ($DryRun) {
        Write-Host "  -> $($r.Path) (dry run)"
    } else {
        Set-Content -Path $filePath -Value $updated -NoNewline
        Write-Host "  + $($r.Path)"
    }
}

# --- CHANGELOG.md - prepend new release section ---
$changelogPath = Join-Path $root "docs\CHANGELOG.md"
if ((-not $SkipChangelog) -and (Test-Path $changelogPath)) {
    $changelog = Get-Content $changelogPath -Raw
    $headerPattern = '^## \[\d+\.\d+\.\d+\].*?\n(?=## |# |$)'
    $firstEntry = [regex]::Match($changelog, $headerPattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

    $newSection = "## [$newVersion] - $Date" + "`n`n" +
        "### Added" + "`n`n" +
        "- (fill in before release)" + "`n`n" +
        "### Changed" + "`n`n" +
        "- (fill in before release)" + "`n`n" +
        "### Fixed" + "`n`n" +
        "- (fill in before release)" + "`n`n" +
        "---" + "`n`n"

    if ($firstEntry.Success) {
        $updatedChangelog = $changelog.Insert($firstEntry.Index, $newSection)
    } else {
        $updatedChangelog = $newSection + $changelog
    }

    if ($DryRun) {
        Write-Host "  -> docs/CHANGELOG.md (dry run)"
    } else {
        Set-Content -Path $changelogPath -Value $updatedChangelog -NoNewline
        Write-Host "  + docs/CHANGELOG.md"
    }
    $changedFiles += "docs\CHANGELOG.md"
}

# --- Summary ---
Write-Host ""
if ($DryRun) {
    Write-Host "Dry run complete - no files were modified."
    Write-Host "Next: run without -DryRun to execute the full release."
    exit 0
}

Write-Host "Version bumped: $currentVersion -> $newVersion"
Write-Host "Files touched: $($changedFiles.Count)"
Write-Host ""

# --- Git: stage, commit, tag, push ---
Write-Host "Staging changes..."
git add -A

$commitMsg = "release: v$newVersion - $Title"
Write-Host "Committing: $commitMsg"
git commit -m $commitMsg

Write-Host "Creating annotated tag: v$newVersion"
git tag -a "v$newVersion" -m "OpenMemo v$newVersion"

Write-Host "Pushing main + tags to origin..."
git push origin main --tags

# --- GitHub Release ---
Write-Host ""
Write-Host "Creating GitHub release v$newVersion..."

# Extract just this version's notes from CHANGELOG.md
$changelogContent = Get-Content $changelogPath -Raw
# Escape dots in version so regex doesn't treat them as wildcards
$escapedVersion = [regex]::Escape($newVersion)
$versionPattern = "## \[$escapedVersion\].*?(?=\r?\n## \[\d+\.\d+\.\d+\]|\z)"
$versionMatch = [regex]::Match($changelogContent, $versionPattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

if ($versionMatch.Success) {
    $releaseNotes = $versionMatch.Value.Trim()
    # Strip trailing --- separator if present
    $releaseNotes = $releaseNotes -replace '\r?\n---\s*$', ''
    $releaseNotes = $releaseNotes.Trim()
    $lineCount = ($releaseNotes -split '\r?\n').Count
    Write-Host "Extracted $lineCount lines for GitHub Release notes."
    $tempNotes = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tempNotes -Value $releaseNotes -NoNewline
    & $gh.Source release create "v$newVersion" --title "OpenMemo v$newVersion" --notes-file "$tempNotes"
    Remove-Item $tempNotes
} else {
    Write-Warning "Could not extract changelog section for v$newVersion. Using auto-generated notes."
    & $gh.Source release create "v$newVersion" --title "OpenMemo v$newVersion" --generate-notes
}

Write-Host ""
Write-Host "Release complete!"
Write-Host "  GitHub: https://github.com/izored/OpenMemo/releases/tag/v$newVersion"
Write-Host ""
Write-Host "Post-release reminders:"
Write-Host "  1. Fill in CHANGELOG placeholders if you used the skeleton"
Write-Host "  2. Rebuild Docker containers if code changed"
Write-Host "  3. Hard-refresh browser to verify"
