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

---

## Queued

| File | Problem | Status |
|---|---|---|
| `CONTRIBUTING.md` | 4 broken instructions: dev port `:8000` (real is `:8099`), Tailwind guidance, `RELEASE_NOTES.md` release steps for a file that does not exist, points at `MEMORY.md` for ADRs | ⏳ |
| `SECURITY.md` | Supported versions table says `1.7.x`, ships 3.13.0 | ⏳ |
| `MEMORY.md` | 3 stated decisions now false: Tailwind `@layer`, `OLLAMA_HOSTS` JSON-only, "no auth gate" | ⏳ |
| `architecture-map.html` | 43 backend modules missing, including all of Mesh, Music and Spaces | ⏳ |
| `.env.example` | 12 vars missing, `EMBED_MODEL` and `DEFAULT_CHAT_MODEL` contradict compose and README | ⏳ |
| `README.md` | Content 14 days old, misses 6 releases; roadmap says v3.0 current; dev port wrong; docs list misses 20 of 33 files | ⏳ |
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

## Verified fine, no change needed

`LICENSE`, `NOTICE`, `.editorconfig`, `skills-lock.json`, `nginx.conf`,
`bump-version.ps1`, `.githooks/pre-commit`, `.github/workflows/*`, everything
under `macOS/`.
