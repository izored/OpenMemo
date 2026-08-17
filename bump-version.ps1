<#
.SYNOPSIS
  Cut an openMemo release: promote the changelog, bump every version file, tag,
  push, and verify the published result.

.DESCRIPTION
  Written to fail EARLY and LOUDLY rather than half-succeed. Every check that
  can run before anything is modified runs first, so the common failure modes
  end with "nothing was changed" instead of a repository in a state someone has
  to unpick by hand.

  Guards, in order:
    1.  on main, clean tracked tree
    2.  local main is exactly origin/main (never tag a stale or ahead branch)
    3.  the target tag does not already exist, locally or on the remote
    4.  the changelog has an [Unreleased] section with REAL entries in it
    5.  every version file already agrees (drift is caught before adding more)
    6.  the backend test suite passes (-SkipTests to skip)
    7.  after writing: the files agree again, and the new section is non-empty
    8.  after pushing main: origin really moved, BEFORE the tag is pushed
    9.  after pushing the tag: the GitHub Release exists and its body is the
        changelog section, not an empty or auto-generated one
   10.  the profile repo ended up with exactly ONE entry for this tag.
        release.yml announces it from a dependent job; this script only checks

  Anything that fails between the first write and the push rolls the working
  tree back. Anything that fails after the push prints the exact recovery
  command instead of guessing.

.EXAMPLE
  .\bump-version.ps1 minor -Title "Instagram reels and carousels save properly again"

.EXAMPLE
  .\bump-version.ps1 patch -DryRun
#>
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet("major", "minor", "patch")]
    [string]$Bump,

    # Human headline for this release. Becomes the FIRST LINE of the annotated
    # tag, which release.yml reads to name the GitHub Release
    # ("openMemo v3.4.0 — <Title>"). The rest of the tag body is the full
    # changelog section, so the tag is a complete record on its own.
    [string]$Title = "",

    [string]$Date = (Get-Date -Format "yyyy-MM-dd"),

    # Print everything that would happen — including the exact tag body — and
    # leave the working tree untouched.
    [switch]$DryRun,

    # Skip the backend test suite. For when CI has already gone green on the
    # exact commit you are tagging.
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
    $PSNativeCommandErrorActionPreference = 'Stop'
}

$RepoRoot = $PSScriptRoot
Set-Location $RepoRoot

# ── Output helpers ───────────────────────────────────────────────────────────

function Step($msg) { Write-Host "  $msg" }
function Ok($msg) { Write-Host "  [ok] $msg" -ForegroundColor Green }
function Warn2($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Die($msg) { throw $msg }

# ── The one list of places a version is written ──────────────────────────────
# backend/tests/test_version_consistency.py asserts these agree, so CI fails on
# drift. Add a file here and add it there in the same commit.

$VersionFiles = @(
    @{ Path = "backend/config.py"; Pattern = 'VERSION: str = "\d+\.\d+\.\d+"'; Replace = { param($v) "VERSION: str = `"$v`"" } },
    @{ Path = "chrome-extension/manifest.json"; Pattern = '"version": "\d+\.\d+\.\d+"'; Replace = { param($v) "`"version`": `"$v`"" } },
    @{ Path = "macOS/package.json"; Pattern = '"version": "\d+\.\d+\.\d+"'; Replace = { param($v) "`"version`": `"$v`"" } },
    @{ Path = "README.md"; Pattern = 'version-\d+\.\d+\.\d+'; Replace = { param($v) "version-$v" } }
)

function Get-CurrentVersion {
    $content = Get-Content "backend/config.py" -Raw
    if ($content -notmatch 'VERSION: str = "(\d+)\.(\d+)\.(\d+)"') {
        Die "Could not parse VERSION from backend/config.py"
    }
    return @{ Major = [int]$Matches[1]; Minor = [int]$Matches[2]; Patch = [int]$Matches[3] }
}

# npm writes the root version TWICE in the lockfile: at the top level, and
# again under packages[""]. That empty-string key is why the lockfile cannot go
# through ConvertFrom-Json here ("a property whose name is an empty string...
# only supported using -AsHashTable"), and -AsHashtable would lose key order
# and rewrite the whole file on the way back out. So both are matched by
# anchored regex instead: precise, and it cannot reformat anything.
$LockTopRx = [regex]'(?s)(\A\{\s*"name":\s*"[^"]*",\s*"version":\s*")(\d+\.\d+\.\d+)(")'
$LockRootRx = [regex]'(?s)("packages":\s*\{\s*"":\s*\{\s*"name":\s*"[^"]*",\s*"version":\s*")(\d+\.\d+\.\d+)(")'

function Get-StatedVersions {
    # Every version this repo currently claims, keyed by where it says it.
    $stated = [ordered]@{}
    $cfg = Get-Content "backend/config.py" -Raw
    if ($cfg -match 'VERSION: str = "(\d+\.\d+\.\d+)"') { $stated["backend/config.py"] = $Matches[1] }

    foreach ($f in @("chrome-extension/manifest.json", "macOS/package.json")) {
        $stated[$f] = (Get-Content $f -Raw | ConvertFrom-Json).version
    }

    $lockRaw = Get-Content "macOS/package-lock.json" -Raw
    $m = $LockTopRx.Match($lockRaw)
    if (-not $m.Success) { Die "Could not read the top-level version from macOS/package-lock.json" }
    $stated["macOS/package-lock.json"] = $m.Groups[2].Value
    $m2 = $LockRootRx.Match($lockRaw)
    if (-not $m2.Success) { Die "Could not read packages[''].version from macOS/package-lock.json" }
    $stated["macOS/package-lock.json (root pkg)"] = $m2.Groups[2].Value

    $readme = Get-Content "README.md" -Raw
    if ($readme -match 'version-(\d+\.\d+\.\d+)') { $stated["README.md badge"] = $Matches[1] }

    return $stated
}

function Assert-VersionsAgree($expected, $when) {
    $stated = Get-StatedVersions
    $wrong = @()
    foreach ($k in $stated.Keys) {
        if ($stated[$k] -ne $expected) { $wrong += "$k says $($stated[$k])" }
    }
    if ($wrong.Count) {
        Die "Version drift $when (expected $expected): $($wrong -join '; ')"
    }
}

# ── Changelog helpers ────────────────────────────────────────────────────────

$ChangelogPath = "docs/CHANGELOG.md"

function Get-ChangelogSection($heading) {
    # Everything from "## [heading]" up to (not including) the next "## [".
    $lines = (Get-Content $ChangelogPath -Raw) -split "`r?`n"
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match ("^##\s*\[" + [regex]::Escape($heading) + "\]")) { $start = $i; break }
    }
    if ($start -lt 0) { return $null }
    $end = $lines.Count
    for ($i = $start + 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^##\s*\[') { $end = $i; break }
    }
    $section = $lines[$start..($end - 1)]
    # Trim trailing blanks and the "---" rule that separates releases.
    while ($section.Count -and ($section[-1].Trim() -eq "" -or $section[-1].Trim() -eq "---")) {
        $section = $section[0..($section.Count - 2)]
    }
    return ($section -join "`n")
}

function Assert-UnreleasedHasEntries {
    $section = Get-ChangelogSection "Unreleased"
    if ($null -eq $section) {
        Die "$ChangelogPath has no '## [Unreleased]' section. Write this release's entries there first."
    }
    # Ignore the heading, blank lines and the scaffold comment.
    $meat = ($section -split "`n") | Where-Object {
        $_ -notmatch '^##\s*\[' -and $_.Trim() -ne "" -and $_.Trim() -notmatch '^<!--'
    }
    if (-not $meat.Count) {
        Die "The '## [Unreleased]' section is empty. There is nothing to release."
    }
    $bullets = @($meat | Where-Object { $_.TrimStart().StartsWith("-") }).Count
    Step "changelog: [Unreleased] has $bullets entr$(if ($bullets -eq 1) { 'y' } else { 'ies' })"
}

# ── Preflight ────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "openMemo release" -ForegroundColor Cyan
Write-Host ""

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") { Die "Must be on main. Currently on: $branch" }
Ok "on main"

# Only TRACKED changes gate a release; stray untracked scratch files must not.
$dirty = git status --porcelain --untracked-files=no
if ($dirty) { Die "Tracked files have uncommitted changes. Commit or stash first:`n$dirty" }
Ok "working tree clean"

$gh = $null
foreach ($c in @("gh", "C:\Program Files\GitHub CLI\gh.exe")) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $gh = $c; break }
}
if (-not $gh) { Die "GitHub CLI (gh) not found. Install from https://cli.github.com" }
& $gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Die "gh is not authenticated. Run: gh auth login" }
Ok "gh authenticated"

# Local main must be EXACTLY origin/main. Tagging a stale main publishes a
# release whose notes do not match what is on the remote; tagging an ahead main
# pushes unreviewed commits along with the tag.
git fetch --quiet origin main --tags
$localSha = (git rev-parse HEAD).Trim()
$remoteSha = (git rev-parse origin/main).Trim()
if ($localSha -ne $remoteSha) {
    $ahead = (git rev-list --count origin/main..HEAD).Trim()
    $behind = (git rev-list --count HEAD..origin/main).Trim()
    Die "main is not in sync with origin (ahead $ahead, behind $behind). Push or pull first."
}
Ok "main matches origin/main"

$cur = Get-CurrentVersion
$old = "$($cur.Major).$($cur.Minor).$($cur.Patch)"

switch ($Bump) {
    "major" { $cur.Major++; $cur.Minor = 0; $cur.Patch = 0 }
    "minor" { $cur.Minor++; $cur.Patch = 0 }
    "patch" { $cur.Patch++ }
}
$new = "$($cur.Major).$($cur.Minor).$($cur.Patch)"
$tag = "v$new"

# A tag that already exists means this release was already cut (or half cut).
$existsLocal = git tag -l $tag
if ($existsLocal) { Die "Tag $tag already exists locally. Delete it first: git tag -d $tag" }
$existsRemote = git ls-remote --tags origin "refs/tags/$tag"
if ($existsRemote) { Die "Tag $tag already exists on origin. Pick a different bump, or delete it on GitHub first." }
Ok "tag $tag is free"

Assert-VersionsAgree $old "before bumping"
Ok "all version files agree on $old"

Assert-UnreleasedHasEntries

if (-not $SkipTests) {
    $py = "backend/.venv/Scripts/python.exe"
    if (Test-Path $py) {
        Step "running backend tests..."
        # Only the verdict line. pytest's tail is full of asyncio teardown
        # noise ("Task was destroyed but it is pending!") that says nothing
        # about whether the release is safe to cut.
        $testOut = & $py -m pytest backend/tests -q --no-header -p no:cacheprovider 2>&1
        $verdict = $testOut | Select-String -Pattern '\d+ (passed|failed)' | Select-Object -Last 1
        if ($verdict) { Write-Host "       $($verdict.Line.Trim())" }
        if ($LASTEXITCODE -ne 0) {
            $testOut | Select-String -Pattern '^(FAILED|ERROR)' | Select-Object -First 10 |
                ForEach-Object { Write-Host "       $($_.Line)" -ForegroundColor Red }
            Die "Backend tests failed. Fix them, or re-run with -SkipTests if CI is already green on this commit."
        }
        Ok "backend tests pass"
    }
    else {
        Warn2 "backend venv not found at $py — skipping tests"
    }
}

$releaseTitle = if ($Title) { $Title } else { "openMemo $tag" }

Write-Host ""
Write-Host "  $old  ->  $new  ($Bump)" -ForegroundColor Cyan
Write-Host "  title: $releaseTitle"
Write-Host ""

# ── Write phase (rollback on any failure) ────────────────────────────────────

$touched = @($ChangelogPath, "macOS/package-lock.json") + ($VersionFiles | ForEach-Object { $_.Path })

function Undo-Writes {
    Warn2 "rolling back working tree..."
    git checkout -- $touched 2>&1 | Out-Null
}

try {
    # 1. Promote [Unreleased] to this version, and leave a fresh [Unreleased]
    #    scaffold behind. The scaffold matters: it gives the next change a
    #    heading to append under, which is what stops an edit from replacing a
    #    RELEASED heading by accident (that happened on 2026-08-03 and merged
    #    3.3.0's notes into Unreleased).
    $cl = Get-Content $ChangelogPath -Raw
    # Drop the scaffold hint first. It belongs to the EMPTY Unreleased section
    # as a prompt for whoever writes the next entry — carrying it into a
    # published release (and into the tag body, and into the profile changelog)
    # would be leaking a note-to-self to every reader.
    $cl = [regex]::Replace($cl, '(?m)^<!-- Add entries here[^\n]*-->\r?\n(\r?\n)?', '', 1)

    $unreleasedRx = [regex]'(?m)^##\s*\[Unreleased\].*$'
    $scaffold = @"
## [Unreleased]

<!-- Add entries here as work lands: ### Added / ### Changed / ### Fixed -->

---
## [$new] - $Date
"@
    $cl = $unreleasedRx.Replace($cl, $scaffold, 1)
    Set-Content $ChangelogPath $cl -NoNewline
    Step "changelog: [Unreleased] -> [$new] - $Date (+ fresh Unreleased scaffold)"

    # 2. Bump the simple pattern files.
    foreach ($f in $VersionFiles) {
        if (-not (Test-Path $f.Path)) { Die "Missing version file: $($f.Path)" }
        $content = Get-Content $f.Path -Raw
        $replacement = & $f.Replace $new
        $updated = [regex]::Replace($content, $f.Pattern, $replacement, 1)
        if ($content -eq $updated) { Die "Version pattern did not match in $($f.Path)" }
        Set-Content $f.Path $updated -NoNewline
        Step "bumped: $($f.Path)"
    }

    # 3. The npm lockfile keeps the root version TWICE, and a blanket
    #    "version" replace would rewrite every nested dependency version too.
    #    Both root occurrences are anchored precisely (see $LockTopRx).
    $lockPath = "macOS/package-lock.json"
    $lockRaw = Get-Content $lockPath -Raw
    $lockNew = $LockTopRx.Replace($lockRaw, { param($m) "$($m.Groups[1].Value)$new$($m.Groups[3].Value)" }, 1)
    $lockNew = $LockRootRx.Replace($lockNew, { param($m) "$($m.Groups[1].Value)$new$($m.Groups[3].Value)" }, 1)
    if ($lockNew -eq $lockRaw) { Die "Version pattern did not match in $lockPath" }
    Set-Content $lockPath $lockNew -NoNewline
    Step "bumped: $lockPath (root + packages[''])"

    # 4. Post-conditions: the files agree, and the promoted section is real.
    Assert-VersionsAgree $new "after bumping"
    $section = Get-ChangelogSection $new
    if (-not $section -or $section.Trim() -eq "") { Die "The [$new] changelog section came out empty." }
    Ok "all version files now say $new"

    # The tag body: headline first (release.yml reads line 1 as the release
    # name), then the full changelog section verbatim. The tag is then a
    # complete record even for someone with no network.
    $tagBody = "$releaseTitle`n`n$section`n"
}
catch {
    Undo-Writes
    throw
}

if ($DryRun) {
    Write-Host ""
    Write-Host "  ── DRY RUN — tag body that would be created ──" -ForegroundColor Yellow
    Write-Host ""
    $tagBody -split "`n" | Select-Object -First 24 | ForEach-Object { Write-Host "  | $_" -ForegroundColor DarkGray }
    if (($tagBody -split "`n").Count -gt 24) { Write-Host "  | … $((($tagBody -split "`n").Count) - 24) more lines" -ForegroundColor DarkGray }
    Write-Host ""
    Write-Host "  ── files that would change ──" -ForegroundColor Yellow
    git --no-pager diff --stat -- $touched | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Undo-Writes
    Write-Host ""
    Ok "dry run complete — nothing was committed, tagged or pushed"
    Write-Host ""
    return
}

# ── Commit, tag, push ────────────────────────────────────────────────────────

try {
    git add -- $touched
    git commit -q -m "release: v$new"
    Ok "committed release: v$new"
}
catch {
    Undo-Writes
    throw
}

$tagBodyFile = Join-Path ([System.IO.Path]::GetTempPath()) "openmemo-tag-$new.txt"
try {
    Set-Content $tagBodyFile $tagBody -NoNewline -Encoding utf8
    # --cleanup=verbatim or the changelog loses its own headings. git tag
    # defaults to 'strip', which deletes every line starting with '#' as a
    # comment -- and the body here is markdown, so "## [3.9.1]" and "### Fixed"
    # were being silently eaten. The tag is meant to be a complete record on its
    # own, and release.yml reads it for the GitHub Release body, so a stripped
    # annotation ships a headingless release. Verbatim keeps the file as written.
    git tag -a $tag --cleanup=verbatim -F $tagBodyFile
    Ok "tagged $tag (annotation carries the full changelog)"
}
catch {
    Warn2 "tagging failed — undoing the release commit"
    git reset --hard HEAD~1 | Out-Null
    throw
}
finally {
    Remove-Item $tagBodyFile -ErrorAction SilentlyContinue
}

# Push the branch FIRST. If this is rejected (branch protection, a race), the
# tag must not go out: a tag pointing at a commit that is not on main is the
# messiest state to unpick, and it is exactly what happened on 2026-08-03.
Write-Host ""
Step "pushing main..."
git push origin main
git fetch --quiet origin main
if ((git rev-parse origin/main).Trim() -ne (git rev-parse HEAD).Trim()) {
    Die @"
main did NOT move on origin — the release commit is local only.
The tag has NOT been pushed, so nothing is public yet.

To undo locally:   git reset --hard HEAD~1; git tag -d $tag
Or open a PR for the release commit, merge it, then push the tag:
                   git push origin $tag
"@
}
Ok "origin/main now at the release commit"

Step "pushing $tag..."
git push origin $tag
Ok "tag pushed"

# ── Verify what actually got published ───────────────────────────────────────

Write-Host ""
# The workflow queues, verifies the tag against every version file, creates the
# release and then announces it — comfortably more than a couple of minutes on
# a cold runner. Waiting too briefly and printing a warning about a release
# that is simply still building is worse than waiting.
$deadline = (Get-Date).AddMinutes(10)
Step "waiting for the release workflow (up to 10 min)..."
$release = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 10
    $json = & $gh release view $tag --json tagName, name, body, isDraft, url 2>$null
    if ($LASTEXITCODE -eq 0 -and $json) { $release = $json | ConvertFrom-Json; break }
    # Surface a failed run immediately instead of waiting out the clock.
    $runState = & $gh run list --workflow=release.yml --limit 1 --json conclusion -q '.[0].conclusion' 2>$null
    if ($runState -eq "failure") {
        Warn2 "the release workflow FAILED — see: gh run list --workflow=release.yml --limit 1"
        break
    }
}

if (-not $release) {
    Warn2 "the GitHub Release for $tag has not appeared yet."
    Warn2 "check: gh run list --workflow=release.yml --limit 3"
    Warn2 "the tag and commit are pushed, so re-running the workflow is safe."
    return
}

# The body must be the hand-written changelog section. An empty or
# auto-generated body means release.yml failed to find the section.
$bodyLines = ($release.body -split "`n").Count
if ($release.body -notmatch [regex]::Escape("## [$new]")) {
    Warn2 "the release body does not contain the '## [$new]' heading — check release.yml"
}
else {
    Ok "release published with the changelog body ($bodyLines lines)"
}
Write-Host "       $($release.name)"
Write-Host "       $($release.url)"

# The profile-repo announcement is NOT dispatched from here. release.yml has a
# dependent `notify` job that does it, because `release: published` never fires
# for a release created by GITHUB_TOKEN. Dispatching notify-changelog.yml here
# as well produced a SECOND identical entry in izored/izored on 2026-08-14, and
# there is no de-duplication on the receiving end. So this step verifies rather
# than announces.
Write-Host ""
Step "checking the profile repo received $tag..."
$profileJson = & $gh api repos/izored/izored/contents/CHANGELOG.json --jq '.content' 2>$null
if ($LASTEXITCODE -ne 0 -or -not $profileJson) {
    Warn2 "could not read izored/izored CHANGELOG.json to confirm the announcement"
}
else {
    $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($profileJson -replace '\s', '')))
    $hits = ([regex]::Matches($decoded, '"version"\s*:\s*"' + [regex]::Escape($tag) + '"')).Count
    if ($hits -eq 1) { Ok "izored/izored has exactly one entry for $tag" }
    elseif ($hits -eq 0) {
        Warn2 "izored/izored has NO entry for $tag yet. release.yml's notify job may still be running, or it failed."
        Warn2 "check: gh run list --workflow=release.yml --limit 1"
    }
    else { Warn2 "izored/izored has $hits entries for $tag. One is a duplicate and should be removed by hand." }
}

Write-Host ""
Write-Host "  Released $tag" -ForegroundColor Green
Write-Host "  Next: rebuild the containers so the running app reports $new —" -ForegroundColor DarkGray
Write-Host "        docker compose build openmemo-api openmemo-web; docker compose up -d openmemo-api openmemo-web" -ForegroundColor DarkGray
Write-Host ""
