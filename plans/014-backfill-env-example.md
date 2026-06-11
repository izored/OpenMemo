# Plan 014: `.env.example` documents every configurable setting, not half of them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/config.py backend/.env.example`
> If either file changed since this plan was written, re-derive the setting
> list from `backend/config.py` before proceeding.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but if `plans/004` landed, include `EXTENSION_ORIGIN` too)
- **Category**: dx
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

`backend/config.py` defines ~25 settings but `backend/.env.example` documents only
about a dozen. The undocumented ones are exactly the knobs a user most wants to
tune — Whisper speech-to-text (`WHISPER_MODEL`/`DEVICE`/`COMPUTE_TYPE`/`BEAM_SIZE`),
RAG retrieval (`RAG_TOP_K`, `RAG_MAX_DISTANCE`), chunking (`CHUNK_SIZE`,
`CHUNK_OVERLAP`), and the Ollama context window (`OLLAMA_NUM_CTX`). Today they're
discoverable only by reading source. Filling out `.env.example` is pure docs, no
code change.

## Current state

- `backend/config.py` Settings fields (with their defaults), confirmed at
  `d847160`:
  ```python
  # backend/config.py (Settings)
  OLLAMA_HOST: str = "http://localhost:11434"
  OLLAMA_HOSTS: list[str] | str = ["http://localhost:11434", "http://localhost:11435",
                                   "http://host.docker.internal:11434", "http://host.docker.internal:11435"]
  EMBED_MODEL: str = "nomic-embed-text"
  DEFAULT_CHAT_MODEL: str = "qwen2.5:7b"
  DEFAULT_VISION_MODEL: str = "gemma3:4b"
  CHROMA_PERSIST_DIR: str = ".../data/chroma"
  CHROMA_COLLECTION: str = "memos"
  CHUNK_SIZE: int = 384
  CHUNK_OVERLAP: int = 64
  WHISPER_MODEL: str = "small"          # tiny|base|small|medium|large-v3
  WHISPER_DEVICE: str = "auto"          # auto|cpu|cuda
  WHISPER_COMPUTE_TYPE: str = "auto"    # auto|int8|float16|float32
  WHISPER_BEAM_SIZE: int = 1
  RAG_TOP_K: int = 8
  RAG_MAX_DISTANCE: float = 0.80
  OLLAMA_NUM_CTX: int = 8192
  HOST: str = "0.0.0.0"
  PORT: int = 8000
  CORS_ORIGINS: list[str] | str = [ ... ]
  DATABASE_URL: str = "sqlite+aiosqlite:///.../data/openmemo.db"
  FILES_DIR / DATA_DIR / BASE_DIR  (path settings, derived)
  APP_NAME / VERSION  (constants — NOT user-config)
  ```
- `backend/.env.example` currently documents only:
  `OLLAMA_HOST, OLLAMA_HOSTS, EMBED_MODEL, DEFAULT_CHAT_MODEL, DEFAULT_VISION_MODEL,
   DATABASE_URL, CHROMA_PERSIST_DIR, FILES_DIR, HOST, PORT, CORS_ORIGINS`.
- Missing from the example: `CHROMA_COLLECTION, CHUNK_SIZE, CHUNK_OVERLAP,
  WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE, WHISPER_BEAM_SIZE,
  RAG_TOP_K, RAG_MAX_DISTANCE, OLLAMA_NUM_CTX`.

## Commands you will need

| Purpose | Command (from project root) | Expected on success |
|---------|-----------------------------|---------------------|
| List config fields | `grep -nE "^\s+[A-Z_]+:" backend/config.py` | shows all settings |
| Confirm app still boots | `python -c "from backend.main import app; print('OK')"` | prints `OK` |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/.env.example` (additions only)

**Out of scope**:
- `backend/config.py` — do NOT change defaults or add settings here.
- The real `backend/.env` — never read or print its values; never commit it.
- Any code.

## Git workflow

- Branch: `advisor/014-backfill-env-example`
- One commit, conventional style:
  `docs(config): document Whisper, RAG, chunking and context settings in .env.example`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Re-derive the authoritative setting list

Run `grep -nE "^\s+[A-Z_]+:" backend/config.py` and treat its output as the source
of truth (the plan's list above may have drifted). Exclude pure constants
(`APP_NAME`, `VERSION`) and derived path settings (`BASE_DIR`, `DATA_DIR` — keep
`FILES_DIR`/`DATABASE_URL` since they're already in the example and are legitimately
overridable).

**Verify**: you have a complete list of user-overridable settings.

### Step 2: Append the missing settings with commented defaults + one-line guidance

Add the missing keys to `backend/.env.example`, grouped with brief section
comments, each as a commented-out line showing the default and a one-line purpose.
Match the existing file's comment style. Voice for the comments follows the project
brand (short, plain, no em dashes — use periods/commas/parentheses). Example block
to add:

```bash
# ── Speech-to-text (faster-whisper) ──
# Model size. tiny|base|small|medium|large-v3. Bigger = better, slower.
# WHISPER_MODEL=small
# Device. auto|cpu|cuda.
# WHISPER_DEVICE=auto
# Precision. auto|int8|float16|float32. int8 = fastest on CPU.
# WHISPER_COMPUTE_TYPE=auto
# Beam width. 1 is fastest; higher can improve accuracy.
# WHISPER_BEAM_SIZE=1

# ── RAG retrieval ──
# How many chunks to pull into the prompt.
# RAG_TOP_K=8
# Max cosine distance for a chunk to count as relevant (0..2, lower = stricter).
# RAG_MAX_DISTANCE=0.80

# ── Chunking ──
# Tokens per chunk. Must fit the embed model's context minus its task prefix.
# CHUNK_SIZE=384
# Token overlap between chunks.
# CHUNK_OVERLAP=64

# ── Ollama ──
# Context window passed to the chat model.
# OLLAMA_NUM_CTX=8192

# ── ChromaDB ──
# Vector collection name.
# CHROMA_COLLECTION=memos
```

Keep every added line commented (a `.env.example` is a template; uncommenting is
the user's choice). Use the exact default values from `config.py` as confirmed in
Step 1 — do not invent different numbers.

**Verify**: `grep -c "WHISPER_MODEL\|RAG_TOP_K\|CHUNK_SIZE\|OLLAMA_NUM_CTX\|CHROMA_COLLECTION" backend/.env.example`
→ returns 5 (all present).

### Step 3: Sanity-check no real secret leaked in and the app still boots

Confirm you only edited `.env.example` (never `.env`), and the example contains no
real tokens/values (it shouldn't — everything is a default).

**Verify**: `git status` shows only `backend/.env.example` modified.
`python -c "from backend.main import app; print('OK')"` → `OK`.

## Test plan

- No automated test (docs-only). Verification is the greps above and that the app
  still imports.

## Done criteria

ALL must hold:

- [ ] Every user-overridable setting from `config.py` appears in `backend/.env.example`
- [ ] Added lines are commented-out with correct default values and a one-line note each
- [ ] Comments contain no em dashes (project brand rule)
- [ ] `git status` shows ONLY `backend/.env.example` changed
- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `config.py`'s settings differ materially from the list above (use the live grep,
  not this plan's snapshot — but if there are brand-new settings whose meaning is
  unclear, report rather than guessing a description).
- The real `backend/.env` is the only env file present and there is no
  `.env.example` to edit — report (creating one fresh is fine, but flag it).

## Maintenance notes

- Add a CI or pre-commit check later that diffs `config.py` setting names against
  `.env.example` keys so they can't drift again (out of scope here, worth a
  follow-up `plans/` entry).
- If `plans/004` (CORS) landed first, also document its new `EXTENSION_ORIGIN`
  setting here.
- Reviewer should confirm no real `.env` content was copied in.
