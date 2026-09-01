# openMemo Release Procedure

## Prerequisites

All work for this release must be **merged to `main` via PR** first. Then:

```bash
git checkout main && git pull
```

## Flow

1. **Finalize the changelog first.** In `docs/CHANGELOG.md`, this release's
   entries must already be written under the literal heading `## [Unreleased]`.
   Leave that heading exactly as it is. The script searches for that string,
   promotes it to `## [X.Y.Z] - <date>` itself, and leaves a fresh `[Unreleased]`
   scaffold behind. Writing a versioned heading by hand, or a hybrid like
   `## [3.9.4] - Unreleased`, breaks the search and the script dies before it
   touches anything. This hand-written section IS the release body — the
   GitHub Release workflow extracts it verbatim.
2. **Rehearse it.** `.\bump-version.ps1 <patch|minor|major> -DryRun` runs every
   guard, prints the exact tag body, and rolls the working tree back. Nothing is
   committed, tagged or pushed. Add `-SkipTests` only when CI has already gone
   green on the very commit you are about to tag.
3. Run `.\bump-version.ps1 <patch|minor|major> -Title "<headline>"` — promotes
   the changelog, bumps the version files, commits `release: vX.Y.Z`, tags, and
   pushes `main` + the tag. `-Title` becomes the first line of the annotated tag,
   which is what names the GitHub Release.
4. The tag push triggers `.github/workflows/release.yml`, which extracts the
   matching `## [X.Y.Z]` section from `docs/CHANGELOG.md` and publishes it as the
   GitHub Release body. That body is then dispatched to `izored/izored` by
   `notify-changelog.yml`.
5. Verify the release page + the profile-repo changelog entry. The script polls
   for the published release and can time out, which silently skips the steps
   after it, so check rather than assume.

> The release body must carry the **full formatted changelog** for the version,
> verbatim — no summaries, no git-cliff auto-notes. The workflow reads the
> hand-written section so the source of truth is `docs/CHANGELOG.md`.

---

## Release Notes Format

The `## [Unreleased]` section of `docs/CHANGELOG.md` becomes the GitHub Release
body verbatim. There is no separate release-notes file: a `TEMP_CHANGELOG` was
documented here for a long time, is written by nothing and read by nothing, and
following that instruction only produces an untracked file that never reaches a
release.

```markdown
## 🎉 Section Name

- [unique emoji] **Feature name** — description
- [unique emoji] **Feature name** — description

## 🐛 Bug Fixes

- [unique emoji] **Fixed name** — root cause and fix

## ⬆️ Dependencies

- ⬆️ `package` `old` → `new` (reason)
```

**Section emoji** = category. **Each bullet** = its own unique emoji specific to that item (not the section emoji repeated).

---

## Emoji Reference

| Emoji | Category |
|-------|----------|
| ✨ | New features |
| 🎨 | UI/UX polish, theming, styling |
| ⚡ | Performance, animation, transitions |
| 🐛 | Bug fixes |
| 🗄️ | Backend, database, data layer |
| 🔒 | Security |
| 🏗️ | Build, Docker, CI/CD, infra |
| 📝 | Editor, markdown, content |
| 📐 | Layout, spacing, grid |
| 🔍 | Search |
| 🎴 | Cards, components |
| ⬆️ | Dependency upgrades |
| 🙏 | Credits, attribution |

---

## What the Script Does

Ten guards, in order, and every one that can run before anything is written
does: on main, clean tracked tree, local main exactly equal to `origin/main`,
the target tag free both locally and on the remote, an `[Unreleased]` section
with real entries in it, every version file already agreeing, and the backend
test suite passing. Then:

1. Promotes `## [Unreleased]` to `## [X.Y.Z] - <date>` and leaves a fresh
   `[Unreleased]` scaffold
2. Bumps the version in all five files listed below
3. Commits `release: vX.Y.Z`, creates the annotated tag `vX.Y.Z`
4. Pushes `main`, checks that origin really moved, and only then pushes the tag
5. Checks that the GitHub Release exists and its body is the changelog section

Anything that fails between the first write and the push rolls the working tree
back. Anything that fails after the push prints the exact recovery command.

The script does **not** create the GitHub Release itself — `release.yml` does,
triggered by the tag push. It does write the changelog heading, which older
copies of this document denied.

---

## Files Carrying Version

| File | Field |
|------|-------|
| `backend/config.py` | `VERSION: str = "X.Y.Z"` ← source of truth |
| `chrome-extension/manifest.json` | `"version": "X.Y.Z"` |
| `macOS/package.json` | `"version": "X.Y.Z"` |
| `macOS/package-lock.json` | `"version"` twice: top level, and `packages[""]` |
| `README.md` | `version-X.Y.Z` shields badge |

The script refuses to start when these disagree, so drift is caught before a
release adds more of it.

## Version Semantics

| Bump | When |
|------|------|
| `patch` | Bug fixes, small tweaks |
| `minor` | New features, UX changes |
| `major` | Breaking changes, architecture overhaul |

---

## Manual Fallback

**If the `release.yml` workflow fails** to create the GitHub Release after the
tag is pushed, create it by hand from the changelog section (extract the
`## [X.Y.Z]` block from `docs/CHANGELOG.md` into a temp file first):

```powershell
# Extract the section, then:
gh release create vX.Y.Z --title "openMemo vX.Y.Z" --notes-file release-body.md
```

**If the tag never pushed** (script failed mid-flow):

```powershell
git push origin main
git push origin vX.Y.Z
```
