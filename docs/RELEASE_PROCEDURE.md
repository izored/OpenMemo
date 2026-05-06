# OpenMemo Release Procedure

## Flow

1. Write `TEMP_CHANGELOG_vX.Y.Z.md` in repo root with release notes
2. Run `.\bump-version.ps1 <patch|minor|major> -Title "short description"`
3. Verify

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
3. Prepends `## [X.Y.Z] - date — Title` + notes to `docs/CHANGELOG.md`
4. Commits `release: vX.Y.Z - Title`, creates annotated tag (local only)
5. Creates GitHub Release from TEMP_CHANGELOG (before push — safe to retry on failure)
6. Pushes `main` + tags
7. Deletes TEMP_CHANGELOG

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

**If `gh release create` fails** (commit + tag are local, not pushed):

```powershell
gh release create vX.Y.Z --title "OpenMemo vX.Y.Z — Title" --notes-file TEMP_CHANGELOG_vX.Y.Z.md
git push origin main --tags
Remove-Item TEMP_CHANGELOG_vX.Y.Z.md
```

**If push fails** after release was created:

```powershell
git push origin main --tags
```
