param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet("major", "minor", "patch")]
    [string]$Bump,

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

$dirty = git status --porcelain
if ($dirty) { throw "Working tree is dirty. Commit or stash changes first." }

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

git commit -m "release: v$new"
git tag -a $tag -m "OpenMemo $tag"

Write-Host ""
Write-Host "  Tagged $tag locally. Pushing..." -ForegroundColor Cyan

git push origin main
git push origin $tag

Write-Host ""
Write-Host "  Done. GitHub Actions will generate the release notes and create the GitHub Release." -ForegroundColor Green
Write-Host "  https://github.com/izored/OpenMemo/releases/tag/$tag"
Write-Host ""
