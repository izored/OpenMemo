param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet("major", "minor", "patch")]
    [string]$Bump,

    # Human headline for this release. Becomes the annotated-tag subject, which
    # release.yml reads to name the GitHub Release ("openMemo v3.1.1 — <Title>").
    # Optional: omit and the release is named by version alone.
    [string]$Title = "",

    [string]$Date = (Get-Date -Format "yyyy-MM-dd"),

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
    $PSNativeCommandErrorActionPreference = 'Stop'
}

# ── Helpers ──────────────────────────────────────────────────────────────────

function Find-Gh {
    $candidates = @(
        "gh",
        "C:\Program Files\GitHub CLI\gh.exe"
    )
    foreach ($c in $candidates) {
        if (Get-Command $c -ErrorAction SilentlyContinue) { return $c }
    }
    throw "GitHub CLI (gh) not found. Install from https://cli.github.com"
}

function Update-FileVersion($path, $pattern, $replacement) {
    if (-not (Test-Path $path)) { Write-Warning "Skipped (not found): $path"; return }
    $content = Get-Content $path -Raw
    $new = [regex]::Replace($content, $pattern, $replacement)
    if ($content -eq $new) { Write-Warning "Pattern not matched in: $path"; return }
    if (-not $DryRun) {
        Set-Content $path $new -NoNewline
        git add $path
    }
    Write-Host "  bumped: $path"
}

# ── Pre-flight ────────────────────────────────────────────────────────────────

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") { throw "Must be on main. Currently on: $branch" }

# Only block on uncommitted changes to TRACKED files — a release commit never
# picks up stray local untracked files (skills caches, scratch notes), so those
# must not gate the release.
$dirty = git status --porcelain --untracked-files=no
if ($dirty) { throw "Tracked files have uncommitted changes. Commit or stash first." }

$gh = Find-Gh
& $gh auth status | Out-Null

# ── Parse current version ─────────────────────────────────────────────────────

$configPath = "backend/config.py"
$configContent = Get-Content $configPath -Raw
if ($configContent -notmatch 'VERSION: str = "(\d+)\.(\d+)\.(\d+)"') {
    throw "Could not parse VERSION from $configPath"
}
[int]$maj = $Matches[1]
[int]$min = $Matches[2]
[int]$pat = $Matches[3]
$old = "$maj.$min.$pat"

switch ($Bump) {
    "major" { $maj++; $min = 0; $pat = 0 }
    "minor" { $min++; $pat = 0 }
    "patch" { $pat++ }
}
$new = "$maj.$min.$pat"
$tag = "v$new"

Write-Host ""
Write-Host "  $old  →  $new  ($Bump)" -ForegroundColor Cyan
if ($DryRun) { Write-Host "  [DRY RUN — no changes made]" -ForegroundColor Yellow; return }
Write-Host ""

# ── Promote the changelog's Unreleased section to this version ────────────────
# release.yml extracts the "## [$new]" section from docs/CHANGELOG.md verbatim as
# the GitHub Release body, so that heading MUST exist and match the tag. Rename
# the working "## [Unreleased]" heading to "## [$new] - $Date". Fail loudly if
# there's nothing to release, rather than pushing a tag whose release job dies.

$clPath = "docs/CHANGELOG.md"
$clContent = Get-Content $clPath -Raw
$unreleasedRx = [regex]'(?m)^##\s*\[Unreleased\].*$'
$versionRx = [regex]("(?m)^##\s*\[" + [regex]::Escape($new) + "\]")
if ($unreleasedRx.IsMatch($clContent)) {
    $clNew = $unreleasedRx.Replace($clContent, "## [$new] - $Date", 1)
    Set-Content $clPath $clNew -NoNewline
    git add $clPath
    Write-Host "  changelog: [Unreleased] -> [$new] - $Date"
}
elseif ($versionRx.IsMatch($clContent)) {
    Write-Host "  changelog: [$new] section already present — leaving as-is"
}
else {
    throw "docs/CHANGELOG.md has no '## [Unreleased]' section and no '## [$new]' section. release.yml would find no notes for $tag. Add an '## [Unreleased]' section (with this release's entries) first."
}

# ── Bump version files ────────────────────────────────────────────────────────

Update-FileVersion "backend/config.py" `
    'VERSION: str = "\d+\.\d+\.\d+"' `
    "VERSION: str = `"$new`""

Update-FileVersion "chrome-extension/manifest.json" `
    '"version": "\d+\.\d+\.\d+"' `
    "`"version`": `"$new`""

# macOS desktop shell (About panel + update notifier read this). NOT the
# lockfile - a blanket "version" replace there would corrupt nested entries.
Update-FileVersion "macOS/package.json" `
    '"version": "\d+\.\d+\.\d+"' `
    "`"version`": `"$new`""

Update-FileVersion "README.md" `
    'version-\d+\.\d+\.\d+' `
    "version-$new"

# ── Commit & tag ──────────────────────────────────────────────────────────────

$tagMessage = if ($Title) { $Title } else { "openMemo $tag" }
git commit -m "release: v$new"
git tag -a $tag -m $tagMessage

Write-Host ""
Write-Host "  Tagged $tag locally. Pushing..." -ForegroundColor Cyan

git push origin main
git push origin $tag

Write-Host ""
Write-Host "  Done. GitHub Actions will generate the release notes and create the GitHub Release." -ForegroundColor Green
Write-Host "  https://github.com/izored/OpenMemo/releases/tag/$tag"
Write-Host ""
