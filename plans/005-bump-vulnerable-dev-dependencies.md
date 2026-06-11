# Plan 005: Frontend dev dependencies with known CVEs are upgraded out of the vulnerable range

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- frontend/package.json frontend/package-lock.json`
> If any in-scope file changed since this plan was written, re-run `npm audit`
> in `frontend/` and compare against the advisories below before proceeding.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

`npm audit` on the frontend reports a known vulnerability in `vitest` below
`3.2.6` (arbitrary file read / code execution reachable when the Vitest UI server
is listening), plus moderate advisories in transitive `brace-expansion` and `ws`.
These are dev/build-time only (not shipped in the production bundle), but they are
real CVEs on a developer's machine and the fix is a routine upgrade. Doing it now
keeps CI's audit signal clean and avoids a developer accidentally exposing the
Vitest UI.

## Current state

- `frontend/package.json` devDependencies pin `vitest: "^3.0.0"` (resolves into the
  vulnerable `<3.2.6` range) and pull `brace-expansion` / `ws` transitively.
- The exact current advisories must be confirmed at execution time — versions move.
  Run `npm audit` first (read-only) and treat its output as the source of truth.

## Commands you will need

| Purpose | Command (from `frontend/`) | Expected on success |
|---------|----------------------------|---------------------|
| Audit (read-only) | `npm audit --omit=dev` and `npm audit` | lists advisories |
| Install | `npm ci` | exit 0 |
| Upgrade vitest | `npm install -D vitest@^3.2.6` | updates lockfile |
| Auto-fix transitive | `npm audit fix` | patches brace-expansion/ws |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Test | `npm test` | all pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

> NOTE for the executor: this plan **does** modify `package.json` and the
> lockfile, which the advisor skill normally forbids — that restriction applies to
> the advisor, not to you. You are executing an approved plan; running `npm install`
> to update dependencies is the whole point here.

## Scope

**In scope**:
- `frontend/package.json`
- `frontend/package-lock.json`

**Out of scope**:
- Any production `dependencies` (these are dev-only advisories). Do NOT bump React,
  Vite, or runtime libs as part of this plan.
- Backend `requirements.txt` — separate plan (see `plans/013-*`).
- Application source code — none should change.

## Git workflow

- Branch: `advisor/005-bump-vulnerable-dev-dependencies`
- One commit, conventional style:
  `chore(deps): bump vitest and patch transitive CVEs (brace-expansion, ws)`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Capture the baseline audit

From `frontend/`, run `npm audit` and record which advisories appear and their
severities. Confirm `vitest <3.2.6`, `brace-expansion`, and `ws` are among them.
If the set differs materially from this plan, note the difference (it is not a
STOP — proceed with whatever vulnerable dev deps are reported), but do not touch
production deps.

**Verify**: `npm audit` runs and prints a report (non-zero exit is normal when
advisories exist).

### Step 2: Upgrade vitest

From `frontend/`: `npm install -D vitest@^3.2.6`. If the project also has
`@vitest/ui` or `@vitest/coverage-*` packages, bump them to the matching major so
versions stay aligned (`grep -n "vitest" frontend/package.json` to check).

**Verify**: `grep -n "vitest" frontend/package.json` → shows `^3.2.6` or higher.

### Step 3: Patch the transitive advisories

From `frontend/`: `npm audit fix` (NOT `npm audit fix --force` — force can bump
majors and break the build). This should resolve `brace-expansion` and `ws`
without touching production majors.

**Verify**: `npm audit` → the previously-listed `vitest`, `brace-expansion`, and
`ws` advisories are gone (or only `--force`-requiring ones remain; if so, leave
them and note it — do not force).

### Step 4: Prove the toolchain still works

From `frontend/`, run the full CI-equivalent sequence:

**Verify**:
- `npm run lint` → exit 0
- `npm run build` → exit 0 (tsc + vite build succeed)
- `npm test` → all existing tests pass (vitest still runs)

## Test plan

- No new tests. The existing suite (`frontend/src/lib/*.test.ts`) running green on
  the upgraded vitest IS the verification that the upgrade didn't break the runner.
- Verification: `npm run lint && npm run build && npm test` all succeed (use `;`
  on PowerShell).

## Done criteria

ALL must hold:

- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm test` passes all existing tests
- [ ] `npm audit` no longer lists the `vitest <3.2.6` advisory
- [ ] No production `dependencies` versions changed (`git diff frontend/package.json` shows only devDependencies / lockfile)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `npm audit fix` (without `--force`) wants to change a production dependency major
  or `npm run build` fails after it — revert the lockfile (`git checkout frontend/package-lock.json frontend/package.json`) and report.
- Upgrading vitest breaks `npm test` (API change between 3.0 and 3.2) and the fix
  isn't a trivial config tweak — report the failure output.
- Remaining advisories require `--force` — do NOT force; report them for a
  human decision.

## Maintenance notes

- Add `npm audit --omit=dev` as a non-blocking CI step later if the team wants
  ongoing signal (not part of this plan).
- Reviewer should confirm the diff is dev-deps + lockfile only.
- `vitest` majors move fast; pin policy (`^`) is fine for a dev tool here.
