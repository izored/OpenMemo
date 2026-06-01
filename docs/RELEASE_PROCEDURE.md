# openMemo Release Procedure

## Prerequisites

All work for this release must be **merged to `main` via PR** first. Then:

```bash
git checkout main && git pull
```

## Flow

1. **Finalize the changelog first.** In `docs/CHANGELOG.md`, the version section
   must already be written under `## [X.Y.Z] - <date>` (flip it from
   `Unreleased` to the release date). This hand-written section IS the release
   body — the GitHub Release workflow extracts it verbatim.
2. Run `.\bump-version.ps1 <patch|minor|major>` — bumps the version files,
   commits `release: vX.Y.Z`, tags, and pushes `main` + the tag.
3. The tag push triggers `.github/workflows/release.yml`, which extracts the
   matching `## [X.Y.Z]` section from `docs/CHANGELOG.md` and publishes it as the
   GitHub Release body. That body is then dispatched to `izored/izored` by
   `notify-changelog.yml`.
4. Verify the release page + the profile-repo changelog entry.

> The release body must carry the **full formatted changelog** for the version,
> verbatim — no summaries, no git-cliff auto-notes. The workflow reads the
> hand-written section so the source of truth is `docs/CHANGELOG.md`.

---

## Release Notes Format

`TEMP_CHANGELOG_vX.Y.Z.md` becomes the GitHub Release body verbatim.

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

1. Pre-flight — branch=main, clean tree, gh auth
2. Bumps version in `backend/config.py`, `chrome-extension/manifest.json`, `README.md`
3. Commits `release: vX.Y.Z`, creates annotated tag `vX.Y.Z`
4. Pushes `main` + the tag

The script does **not** write the changelog or create the GitHub Release. Those
are handled by `docs/CHANGELOG.md` (hand-written, ahead of time) and the
`release.yml` workflow (triggered by the tag push), respectively.

---

## Files Carrying Version

| File | Field |
|------|-------|
| `backend/config.py` | `VERSION: str = "X.Y.Z"` ← source of truth |
| `chrome-extension/manifest.json` | `"version": "X.Y.Z"` |
| `README.md` | `version-X.Y.Z` shields badge |

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
