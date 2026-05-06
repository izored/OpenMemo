<#
.SYNOPSIS
    Bump OpenMemo version across all project files.

.DESCRIPTION
    Reads current version from backend/config.py, computes the new version
    based on bump type (major | minor | patch), then updates every file
    that carries the version string.

.PARAMETER Bump
    Which semver segment to increment: major, minor, or patch.

.PARAMETER Date
    Optional release date override (default: today).

.PARAMETER SkipChangelog
    Skip prepending a new blank section to docs/CHANGELOG.md.

.PARAMETER DryRun
    Print what would change without writing any files.

.EXAMPLE
    .\bump-version.ps1 patch
    # 1.6.5 -> 1.6.6

.EXAMPLE
    .\bump-version.ps1 minor
    # 1.6.5 -> 1.7.0

.EXAMPLE
    .\bump-version.ps1 major -DryRun
    # Shows diff but does not write files
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("major", "minor", "patch")]
    [string]$Bump,

    [string]$Date = (Get-Date -Format "yyyy-MM-dd"),

    [switch]$SkipChangelog,

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

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

Write-Host "Current version: $currentVersion"
Write-Host "New version:     $newVersion"
Write-Host ""

# --- Define file replacements ---
# Each entry: Path relative to root, regex pattern, replacement template
$replacements = @(
    @{
        Path    = "backend\config.py"
        Pattern = '(VERSION:\s*str\s*=\s*")\d+\.\d+\.\d+(")'
        Replace = '${1}' + $newVersion + '${2}'
    },
    @{
        Path    = "frontend\src\pages\SettingsPage.tsx"
        Pattern = '(Version\s+)\d+\.\d+\.\d+'
        Replace = '${1}' + $newVersion
    },
    @{
        Path    = "README.md"
        Pattern = '(Version:\s*)\d+\.\d+\.\d+'
        Replace = '${1}' + $newVersion
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
    $headerPattern = '^## \[\d+\.\d+\.\d+\].*?\n(?=## |#|$)'
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
} else {
    Write-Host "Version bumped: $currentVersion -> $newVersion"
    Write-Host "Files touched: $($changedFiles.Count)"
    Write-Host ""
    # --- GitHub Release (minor/major only) ---
    if ($Bump -ne "patch") {
        $gh = Get-Command gh -ErrorAction SilentlyContinue
        if ($gh) {
            Write-Host ""
            Write-Host "Creating GitHub release v$newVersion..."
            $releaseNotes = "Release v$newVersion`n`nSee CHANGELOG.md for details."
            $changelogPath = Join-Path $root "docs\CHANGELOG.md"
            if (Test-Path $changelogPath) {
                $changelog = Get-Content $changelogPath -Raw
                $sectionPattern = "(?s)## \[$newVersion\].*?(?=## \[|\z)"
                $section = [regex]::Match($changelog, $sectionPattern)
                if ($section.Success) {
                    $releaseNotes = $section.Value.Trim()
                }
            }
            & gh release create "v$newVersion" --title "v$newVersion" --notes "$releaseNotes"
            Write-Host "GitHub release created: v$newVersion"
        } else {
            Write-Host ""
            Write-Host "NOTE: Install GitHub CLI (gh) to auto-create releases for minor/major bumps."
        }
    }

    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Fill in the CHANGELOG section for $newVersion"
    Write-Host "  2. git add -A && git commit -m 'Release v$newVersion'"
    Write-Host "  3. git tag v$newVersion"
    Write-Host "  4. git push origin main --tags"
}
