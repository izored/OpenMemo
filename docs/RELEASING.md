# Releasing openMemo

One command cuts a release. Everything else is a guard rail around it.

```powershell
.\bump-version.ps1 minor -Title "Instagram reels and carousels save properly again"
```

`major` / `minor` / `patch` picks the bump. `-DryRun` shows exactly what would
happen and changes nothing. `-SkipTests` skips the local test run when CI is
already green on the commit you are tagging.

## Before you run it

Write this release's entries under `## [Unreleased]` in `docs/CHANGELOG.md` as
the work lands, not at release time. The script promotes that section verbatim
into the release, so whatever is written there is what the world reads.

The script leaves a fresh empty `## [Unreleased]` behind after every release,
so there is always a heading to append under.

## What the script does

**Refuses to start** unless: you are on `main`, the tracked tree is clean,
local `main` is exactly `origin/main`, the tag does not already exist locally
or on the remote, every version file already agrees, `[Unreleased]` has real
entries, and the backend tests pass.

**Then it writes:** promotes `[Unreleased]` to `[X.Y.Z] - <date>`, adds a fresh
`[Unreleased]` scaffold, and bumps the version in

| File | What reads it |
|---|---|
| `backend/config.py` | the API, the app footer |
| `chrome-extension/manifest.json` | the extension listing |
| `macOS/package.json` | the macOS About panel |
| `macOS/package-lock.json` (root + `packages[""]`) | `npm ci` in the macOS build |
| `README.md` badge | the repo front page |

If any write fails, the working tree is rolled back.

**Then it commits, tags and pushes.** The tag annotation is the headline on
line 1 followed by the full changelog section, so the tag is a complete record
on its own. `main` is pushed **first** and verified to have actually moved
before the tag goes out — a tag pointing at a commit that never reached `main`
is the messiest state to unpick.

**Then it verifies:** waits for the GitHub Release, checks the published body
really contains the `## [X.Y.Z]` heading, and dispatches the profile-repo
announcement.

## What CI enforces

- `backend/tests/test_version_consistency.py` fails any pull request where the
  version files disagree, where a changelog heading appears twice, or where the
  newest section is not at the top. Add a new place that names the version and
  you add it to that test in the same commit.
- `release.yml` re-checks all of it against the tag before publishing, and
  refuses to create the release on a mismatch.

## After a release

Rebuild the containers so the running app reports the new version:

```bash
docker compose build openmemo-api openmemo-web && docker compose up -d openmemo-api openmemo-web
```

## Recovering from a bad tag

A tag is public the moment it lands, so prefer fixing forward with another
patch release. If the tag was pushed within the last few minutes and nobody has
pulled it:

```bash
git push origin :refs/tags/vX.Y.Z
git tag -d vX.Y.Z
gh release delete vX.Y.Z --yes
git reset --hard HEAD~1
```

## Announcing an older release that was missed

The profile-repo announcement runs inside the release workflow. To backfill a
tag that predates that (v3.2.0 and v3.3.0 were missed while the announcement
depended on an event GitHub never fired):

```bash
gh workflow run notify-changelog.yml -f tag=vX.Y.Z
```

## Why the announcement is a job and not a workflow

`release: published` does **not** fire when the release is created by a
workflow using `GITHUB_TOKEN` — which is how `release.yml` creates ours. A
separate workflow listening for that event therefore never runs. The
announcement is a dependent job in the same run instead, so it cannot be
silently skipped. `notify-changelog.yml` remains for manual backfills and for
releases published by hand through the GitHub UI, where the event does fire.
