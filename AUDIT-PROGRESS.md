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
| ✅ `docs/deployment.md` | 105 days old. Told you to expose the app publicly, wrong ports throughout | Correct port table, the loopback-only reason spelled out, Mesh named as the supported answer, a tunnel now requires auth in front of it |
| ✅ `docs/faq.md` | 105 days old. Claimed a 50MB upload cap | 5GB default and how to uncap it, plus Mesh, phone capture, backups, offline, and the WAL lockout recovery |
| ✅ `Specs/ROADMAP.md` | Shipped list stopped at v3.1.0 | 3.2 through 3.13 written into Shipped, the Mesh milestone flipped from IN PROGRESS to shipped, and a note that the lower sections are not in version order |
| ✅ `architecture-map.html` | 44 nodes, frozen 29 May, missing 43 backend modules | 99 nodes and 134 edges. Three new clusters (Mesh, Media/music/capture, Integrity/backups/locks), every backend module and every frontend page now present, plus filter chips for Mesh, Music, Phone capture, Job queue, Backups and Spaces |
| ✅ `MEMORY.md` | 3 false decisions, stack table predating Mesh, Music, Spaces, Whisper and the job queue | Rewritten. Corrects the Tailwind claim, the `OLLAMA_HOSTS` claim and "no auth gate", and adds the traps that actually cost time |

### Commits on this branch

- `17c6590` docs(changelog): the stale-file sweep under [Unreleased]
- `cdad84f` docs: architecture map covers the whole backend again
- `b8c934c` docs: deployment, FAQ and roadmap match what shipped
- `22ada45` docs: env example and README describe 3.13, not 3.0
- `6fb39f0` docs: contributor docs match how the project actually runs
- `484b95d` docs: DESIGN.md describes openMemo, not Replicate

---

## Queued

Nothing. Every file in the audit that could be updated has been.

---

## Waiting on sign-off

Nothing. Every item is resolved.

### Removed on sign-off, round two (2026-08-19)

| Item | Outcome |
|---|---|
| `chromadb` service in `docker-compose.yml` | Removed after two independent reviews, both read-only against the live install, both finding no argument against it. The exact block is preserved verbatim in ADR-026 for restoring |

The reviews corrected this audit on one point. The original finding said the
container bind-mounts the same `./data/chroma` the backend writes to, and called
that a corruption surface. The mount was wired but never took effect: the image
persists to `/data`, its own writable layer. The container held an empty 188KB
database with zero collections. No concurrent writing ever occurred, confirmed
by `pragma integrity_check`, the migration set matching the pinned client, and
the store not being in WAL mode. The real argument for removal was different and
better: a read-write mount of the live store into an unpinned `:latest` image.

They also found three things this audit missed:

- Section 5 of `Specs/worktree-dev-setup-issues.md` was misdiagnosed. The 404 on
  port 8001 was the ChromaDB container, and the `chroma-trace-id` header proved
  the opposite of what was concluded. Now closed with the root cause.
- `docs/INSTALL.md` described the container as existing for external inspection,
  which it never did, and documented a lock error that could not occur as
  described. Both corrected.
- `data/chroma` is in no backup scope. Acceptable, since it is derived and
  rebuildable through reindex, but now stated in ADR-026 rather than assumed.



### Removed on sign-off, round one

| Item | Why |
|---|---|
| `cliff.toml` | No workflow invokes git-cliff. `release.yml:67` explicitly rejects auto-generated notes |
| `.mcp.json` | Empty object, untouched since the initial commit, carried a UTF-8 BOM |
| `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md` | Superseded by the July `.yml` forms. Both sets were live, so GitHub offered four templates with disagreeing labels |
| `.gitignore` rule for `docs/DESIGN_MIGRATION.md` | The file is tracked, and `.gitignore` is only consulted for untracked files. The rule never did anything, and implied the file was private when it is published |

---

## Resolved

- **Security contact.** `dev@izo.red` confirmed correct by the owner on
  2026-08-19. `SECURITY.md` and `CODE_OF_CONDUCT.md` now use it instead of
  `security@openmemo.app`, which appeared nowhere else in the project.

---

## Verified fine, no change needed

`LICENSE`, `NOTICE`, `.editorconfig`, `skills-lock.json`, `nginx.conf`,
`bump-version.ps1`, `.githooks/pre-commit`, `.github/workflows/*`, everything
under `macOS/`.
