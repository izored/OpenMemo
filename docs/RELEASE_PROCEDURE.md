# OpenMemo Release Procedure

> One document to rule them all. Follow this exactly for every release.

---

## Overview

A "release" means **all of these happen in order**:

1. Version bumped in every file that carries it
2. `docs/CHANGELOG.md` updated
3. Everything committed with a release commit message
4. Git tag created (annotated)
5. **GitHub Release created** (not just a git tag)
6. Pushed to origin

---

## CRITICAL RULES

### GitHub Release notes = ONLY this version

The GitHub Release must contain **only the section for the version being released**. Never paste the entire `CHANGELOG.md` into a GitHub Release.

**Bad** (includes 1.7.0, 1.6.6, etc.):  
❌ `gh release create v1.7.1 --notes-file docs/CHANGELOG.md`

**Good** (only 1.7.1):  
✅ Script extracts `## [1.7.1] ...` section automatically

### Release Notes Format

Both `docs/CHANGELOG.md` **and** the GitHub Release use the same format. Every list item gets an emoji prefix that matches its category. Section headers also carry the category emoji.

Template:

```markdown
# OpenMemo v1.7.1 — Short Title

## 🐛 Bug Fixes

- 🐛 **Fixed X** — what broke and how it was fixed
- 🐛 **Fixed Y** — root cause and solution

## ⬆️ Dependencies

- ⬆️ `package` `old` → `new` (reason)

## 🎨 UX Polish

- 🎨 **Changed X** — what and why
```

Rules:
- **Every bullet starts with an emoji** — not just the section title
- Emoji categories (use consistently):
  - 🐛 Bug fixes
  - ✨ New features
  - 🎨 UI/UX polish, theming, styling
  - ⚡ Performance, animation, transitions
  - 🏗️ Build, bundler, Docker, CI
  - 🔒 Security
  - 📝 Editor, markdown, content
  - 📐 Layout, spacing, grid
  - 🔍 Search
  - 🎴 Cards, components
  - 🗄️ Backend, database, data layer
  - ⬆️ Dependency upgrades
  - 🙏 Credits, attribution
- Section header repeats the emoji (`## 🐛 Bug Fixes`)
- **Bold** for the item name, em-dash `—` for the explanation
- Code backticks for filenames, functions, routes, package names
- One blank line between sections
- One blank line between the section header and first bullet

---

## Prerequisites

- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated (`gh auth status`)
- PowerShell 7+ (script uses modern syntax)
- You are on `main` with a clean working tree (no uncommitted changes)

---

## Step-by-Step

### 1. Finish all code changes

All features, fixes, and polish for this version must be merged to `main` first.

### 2. Write the working draft

Create `TEMP_CHANGELOG_vX.Y.Z.md` (or edit the existing one) with the emoji-section release notes format described above. This is your source of truth for what goes into the GitHub Release.

### 3. Copy into docs/CHANGELOG.md

Translate the working draft into Keep a Changelog format and paste it into `docs/CHANGELOG.md` under the correct `## [X.Y.Z] - YYYY-MM-DD` heading. The bump script prepends this heading automatically.

```markdown
## [1.7.1] - 2026-05-06

### Fixed

- 🐛 **Fixed `Prism is not defined` fatal error** — Vite 8's Rolldown bundler wrapped `prismjs` in an IIFE, scoping `var Prism` locally. `@lexical/code` referenced bare `Prism` as a free variable, causing a `ReferenceError` that killed the entire JS bundle before React could mount. Downgraded `vite` to 7.3.2 and `@vitejs/plugin-react` to 4.7.0 to restore Rollup-based bundling
- 🐛 **Fixed Ollama `/api/embed` 404 on older versions** — Added automatic fallback from modern `/api/embed` to legacy `/api/embeddings` endpoint in `ollama_client.py`. `embed()` and `embed_batch()` both retry with the legacy endpoint on 404
- 🐛 **Fixed memo sort 422 error** — `PUT /api/memos/{id}/sort` expected `sort_order` as a query parameter, but the frontend sent it in the JSON body. Changed the endpoint to accept a `SortUpdate` Pydantic model from the request body
- 🎨 **Removed all blur effects** — Removed `backdrop-blur-sm` from `MemoCard.tsx` drag handle per user preference (no blur anywhere)

### Changed

- ⬆️ `vite` 8.0.10 → 7.3.2 (bundler regression fix)
- ⬆️ `@vitejs/plugin-react` 6.0.1 → 4.7.0 (Vite 7 compatibility)
```

### 4. Run the bump script

```powershell
.\bump-version.ps1 patch -Title "fix blank page, Ollama fallback, memo sort"
```

This script:
- Reads current version from `backend/config.py` (single source of truth)
- Computes the new semver version
- Updates version strings in **all** tracked files
- Prepends a blank section to `docs/CHANGELOG.md` (skip with `-SkipChangelog` if you already wrote it)
- Commits everything with message `release: vX.Y.Z - <title>`
- Creates an annotated git tag `vX.Y.Z`
- **Extracts only the `## [X.Y.Z]` section** from `docs/CHANGELOG.md` for the GitHub Release
- Creates the **GitHub Release** with that single section
- Pushes `main` + tags to origin

### 5. Verify

| Check | Command |
|-------|---------|
| Tag exists locally | `git tag -l "vX.Y.Z"` |
| Tag exists on remote | `git ls-remote --tags origin \| grep vX.Y.Z` |
| Release exists on GitHub | `gh release view vX.Y.Z` |
| Release has only this version | `gh release view vX.Y.Z --json body -q .body \| head -5` |
| Version API returns correctly | `curl http://openmemo.local/api/health` |

---

## Files That Carry Version

These are updated automatically by `bump-version.ps1`:

| File | Pattern |
|------|---------|
| `backend/config.py` | `VERSION: str = "X.Y.Z"` |
| `chrome-extension/manifest.json` | `"version": "X.Y.Z"` |
| `README.md` | `version-X.Y.Z` (shields badge) |
| `docs/CHANGELOG.md` | Prepended new `## [X.Y.Z] - YYYY-MM-DD` section |

---

## Commit & Tag Convention

- **Commit message:** `release: vX.Y.Z - <short description>`
- **Tag:** Annotated (`git tag -a`), message: `OpenMemo vX.Y.Z`
- **GitHub Release title:** `OpenMemo vX.Y.Z`
- **GitHub Release notes:** Only the `## [X.Y.Z]` section from `docs/CHANGELOG.md`

---

## Manual Fallback (if script breaks)

If the PowerShell script fails mid-flight, run the remaining steps manually.

**Extract only the current version from CHANGELOG:**

```powershell
$v = "1.7.1"
$notes = [regex]::Match((Get-Content docs/CHANGELOG.md -Raw), "## \[$v\].*?(?=\n## \[\d+\.\d+\.\d+\]|\z)", [System.Text.RegularExpressions.RegexOptions]::Singleline).Value.Trim()
$temp = [System.IO.Path]::GetTempFileName()
Set-Content $temp -Value $notes -NoNewline
```

Then:

```bash
# 1. Stage everything
git add -A

# 2. Commit
git commit -m "release: v1.7.1 - fix blank page, Ollama fallback, memo sort"

# 3. Annotated tag
git tag -a v1.7.1 -m "OpenMemo v1.7.1"

# 4. Push
git push origin main --tags

# 5. Build release notes (emoji format, one version only)
$v = "1.7.1"
$notes = [regex]::Match((Get-Content docs/CHANGELOG.md -Raw), "## \[$v\].*?(?=\n## \[\d+\.\d+\.\d+\]|\z)", [System.Text.RegularExpressions.RegexOptions]::Singleline).Value.Trim() -replace '\r?\n---\s*$', ''
$temp = [System.IO.Path]::GetTempFileName()
Set-Content $temp -Value $notes -NoNewline

# 6. GitHub Release
gh release create v1.7.1 --title "OpenMemo v1.7.1" --notes-file "$temp"
```

---

## Version Semantics

| Bump | When |
|------|------|
| `patch` | Bug fixes, small tweaks (1.7.0 → 1.7.1) |
| `minor` | New features, UX changes (1.7.x → 1.8.0) |
| `major` | Breaking changes, architecture overhaul (1.x → 2.0.0) |

---

## Post-Release

1. **Docker rebuild** (if code changed): `docker-compose build --no-cache openmemo-web openmemo-api && docker-compose up -d`
2. **Browser hard-refresh** to verify the new version loads
3. **Delete `TEMP_CHANGELOG_vX.Y.Z.md`** — it is gitignored and not needed after release
4. Update `MEMORY.md` roadmap if needed
