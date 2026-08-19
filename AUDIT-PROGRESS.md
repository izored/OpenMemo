# Stale-file audit, 2026-08-19

Every root-level file was checked against what actually landed after its last
commit date. This tracks what has been changed, what is still queued, and what
is waiting on a decision.

Branch: `claude/interesting-ramanujan-f2aad6`

Legend: ✅ done and committed · 🔄 in progress · ⏳ queued · 🔒 waiting on sign-off

---

## Changed

| File | Was | Now |
|---|---|---|
| ✅ `DESIGN.md` | Replicate.com's design system, 105 days old | openMemo's real token system, read from `openmemo.css`, `typeset.css`, `fonts.css` and `appearance.ts` |
| ✅ `CONTRIBUTING.md` | 4 instructions that fail if followed | Correct ports, the uvicorn-from-root trap, `python -m pytest`, the secret guard, `bump-version.ps1` as the whole release process |
| ✅ `SECURITY.md` | Supported: `1.7.x` | Supported: `3.13.x`, with a line saying fixes land on the newest release rather than being backported |
| ✅ `.env.example` | 12 vars missing, 2 defaults contradicting compose and the README | Every var `backend/config.py` reads, plus the four runtime switches (`OPENMEMO_INSTALL`, `OPENMEMO_DISABLE_TELEGRAM`, `OPENMEMO_DISABLE_JOB_WORKERS`, `OPENMEMO_MESH_PORT`) that were documented nowhere |
| ✅ `README.md` | Content 14 days old, roadmap said v3.0 current, dev port wrong, docs list missed 20 of 33 files | Backups and offline sections added, roadmap says v3.13, dev port fixed with the two traps spelled out, full docs tree, issue links point at the current forms |
| ✅ `MEMORY.md` | 3 false decisions, stack table predating Mesh, Music, Spaces, Whisper and the job queue | Rewritten. Corrects the Tailwind claim, the `OLLAMA_HOSTS` claim and "no auth gate", and adds the traps that actually cost time |

---

## Queued

| File | Problem | Status |
|---|---|---|
| `architecture-map.html` | 43 backend modules missing, including all of Mesh, Music and Spaces | ⏳ |
| `docs/deployment.md` | 105 days old. Documents exposing the app publicly, which the compose file now forbids. Wrong ports throughout | ⏳ |
| `docs/faq.md` | 105 days old. Says 50MB upload cap, real default is 5GB | ⏳ |
| `Specs/ROADMAP.md` | Shipped list stops at v3.1.0, missing 3.2 through 3.13 | ⏳ |

---

## Waiting on sign-off

Nothing here is removed until you say so. These are all deletions.

| Item | What it is | Why it is dead |
|---|---|---|
| `cliff.toml` | git-cliff changelog config | No workflow invokes git-cliff. `release.yml:67` explicitly rejects auto-generated notes |
| `.mcp.json` | `{"mcpServers": {}}` | Empty object, untouched since the initial commit, carries a UTF-8 BOM |
| `chromadb` service in `docker-compose.yml` | A ChromaDB server container | `backend/db/chroma_client.py` uses `PersistentClient` on a local path. Nothing opens an HTTP client. The container bind-mounts the same `./data/chroma` the backend writes to directly |
| `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md` | The May Markdown templates | Superseded by the July `.yml` forms. Both sets are live, so GitHub offers four templates and the labels disagree (`type:bug` vs `bug`) |
| `.gitignore` line 20 | `docs/DESIGN_MIGRATION.md` | The file is tracked, and `.gitignore` is only consulted for untracked files. The line does nothing |

---

## Needs your call, not touched

- **`security@openmemo.app`**, the reporting address in `SECURITY.md` and
  `CODE_OF_CONDUCT.md`. Nothing else in the repo uses that domain; every other
  contact point is `dev@izo.red`. A security policy pointing at a mailbox that
  does not receive is worse than no policy. Changing a published security
  contact is your decision, so it is left as-is.

---

## Verified fine, no change needed

`LICENSE`, `NOTICE`, `.editorconfig`, `skills-lock.json`, `nginx.conf`,
`bump-version.ps1`, `.githooks/pre-commit`, `.github/workflows/*`, everything
under `macOS/`.
