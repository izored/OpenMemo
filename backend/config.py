from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator
from pathlib import Path


class Settings(BaseSettings):
    APP_NAME: str = "OpenMemo"
    VERSION: str = "3.9.0"
    
    # Paths
    BASE_DIR: Path = Path(__file__).parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    FILES_DIR: Path = BASE_DIR / "files"
    
    # Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{Path(__file__).parent.parent / 'data' / 'openmemo.db'}"
    
    # Ollama
    OLLAMA_HOST: str = "http://localhost:11434"
    # `| str` keeps pydantic-settings from hard-failing on a non-JSON env value
    # (it falls through to the comma-split validator below), so both
    # OLLAMA_HOSTS='["http://a","http://b"]' and OLLAMA_HOSTS=http://a,http://b work.
    OLLAMA_HOSTS: list[str] | str = ["http://localhost:11434", "http://localhost:11435", "http://host.docker.internal:11434", "http://host.docker.internal:11435"]
    EMBED_MODEL: str = "nomic-embed-text"
    DEFAULT_CHAT_MODEL: str = "qwen2.5:7b"
    DEFAULT_VISION_MODEL: str = "gemma3:4b"
    
    # ChromaDB
    CHROMA_PERSIST_DIR: str = str(Path(__file__).parent.parent / "data" / "chroma")
    CHROMA_COLLECTION: str = "memos"
    
    # Chunking. CHUNK_SIZE must leave headroom inside the embedding model's
    # context window (nomic-embed v1/v2: 512 tokens) for the task prefix
    # ("search_document: ") — chunks that overflow get their tail silently
    # truncated by Ollama, so they embed as if the lost text never existed.
    CHUNK_SIZE: int = 384
    CHUNK_OVERLAP: int = 64

    # Speech-to-text (faster-whisper). Multilingual, runs locally. Override via
    # env (e.g. WHISPER_MODEL=large-v3) — see docs. On CPU, "small" is a good
    # accuracy/speed balance; "medium"/"large-v3" need a GPU to stay snappy.
    WHISPER_MODEL: str = "small"          # tiny|base|small|medium|large-v3
    WHISPER_DEVICE: str = "auto"          # auto|cpu|cuda
    WHISPER_COMPUTE_TYPE: str = "auto"    # auto|int8|float16|float32
    WHISPER_BEAM_SIZE: int = 1
    
    # RAG
    RAG_TOP_K: int = 8
    # Cosine-distance ceiling for retrieved chunks (0 = identical, 2 = opposite).
    # Chunks farther than this are noise and are dropped instead of being fed to
    # the model. Lenient by default — tighten per-corpus if answers drift.
    RAG_MAX_DISTANCE: float = 0.80

    # Library RAG (Ask Memo over the whole library) retrieves a chunk POOL, then
    # collapses it to distinct memos so the citation list is one card per memo —
    # not eight chunks of the same memo (OPNMMO-0053). Pool wide enough that
    # dedup still yields several distinct memos; per-memo chunk cap keeps a
    # dominant memo from crowding the model's context.
    RAG_CANDIDATE_K: int = 16    # chunks pulled before dedup
    RAG_MAX_SOURCES: int = 5     # distinct memos shown + cited
    RAG_CHUNKS_PER_MEMO: int = 2 # chunks per memo fed to the model

    # Context window requested from Ollama for chat/summary calls. Ollama's own
    # default (4096) silently truncates long RAG contexts and transcripts.
    OLLAMA_NUM_CTX: int = 8192

    # External ffmpeg binary used for video thumbnails + HLS/DASH muxing
    # (backend/core/video.py, localize_media.py). Bare "ffmpeg" resolves via
    # PATH on Windows/Docker/brew installs; the packaged macOS .app overrides
    # this with FFMPEG_BIN=<bundled arm64 ffmpeg> so it works without a system
    # install.
    FFMPEG_BIN: str = "ffmpeg"

    # When set to the built frontend dir, the backend serves the SPA from its
    # own origin (single process, no nginx/Vite). The packaged macOS .app sets
    # this so the Electron window can load http://127.0.0.1:<port>/ and every
    # relative /api URL, upload, and SSE stream works same-origin. Empty = off
    # (Docker keeps nginx; dev keeps the Vite proxy) — see backend/main.py.
    FRONTEND_DIST: str = ""

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: list[str] | str = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://localhost:80",
        "http://localhost:8091",
        # macOS app / single-process: the SPA is served same-origin on :8099, so
        # CORS isn't strictly needed, but allow it for a browser opened there too.
        "http://localhost:8099",
        "http://127.0.0.1:8099",
        "http://localhost",

    ]
    # Exact origin of the OpenMemo browser extension, e.g.
    # "chrome-extension://abcdefghijklmnopabcdefghijklmnop" (the ID shown on
    # chrome://extensions). Empty keeps the broad chrome-extension:// fallback.
    EXTENSION_ORIGIN: str = ""

    @field_validator("OLLAMA_HOSTS", "CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_comma_separated_list(cls, v):
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @model_validator(mode="after")
    def _anchor_writable_state_to_data_dir(self):
        """Re-anchor the DB, Chroma store, and files dir under DATA_DIR — but
        only when DATA_DIR was explicitly overridden (e.g. the packaged macOS
        app sets DATA_DIR=~/Library/Application Support/OpenMemo, where the code
        lives in a read-only .app bundle).

        Existing Windows dev and Docker leave DATA_DIR at its default and set the
        dependent paths themselves, so this is a no-op for them — their behavior
        is byte-identical. An explicit override of any individual path still wins
        (only fields NOT sourced from env are re-derived).
        """
        if "DATA_DIR" not in self.model_fields_set:
            return self
        data = Path(self.DATA_DIR)
        if "DATABASE_URL" not in self.model_fields_set:
            self.DATABASE_URL = f"sqlite+aiosqlite:///{data / 'openmemo.db'}"
        if "CHROMA_PERSIST_DIR" not in self.model_fields_set:
            self.CHROMA_PERSIST_DIR = str(data / "chroma")
        if "FILES_DIR" not in self.model_fields_set:
            self.FILES_DIR = data / "files"
        return self

    class Config:
        # Anchored to backend/.env regardless of CWD. The old relative ".env"
        # only loaded when uvicorn was started from backend/ — started from the
        # repo root (the documented dev command), the file was silently skipped
        # and the API ran with code defaults (wrong embed/chat models).
        env_file = (Path(__file__).parent / ".env", ".env")
        env_file_encoding = "utf-8"


settings = Settings()
