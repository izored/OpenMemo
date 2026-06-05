from pydantic_settings import BaseSettings
from pydantic import field_validator
from pathlib import Path


class Settings(BaseSettings):
    APP_NAME: str = "OpenMemo"
    VERSION: str = "2.2.0"
    
    # Paths
    BASE_DIR: Path = Path(__file__).parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    FILES_DIR: Path = BASE_DIR / "files"
    
    # Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{Path(__file__).parent.parent / 'data' / 'openmemo.db'}"
    
    # Ollama
    OLLAMA_HOST: str = "http://localhost:11434"
    OLLAMA_HOSTS: list[str] = ["http://localhost:11434", "http://localhost:11435", "http://host.docker.internal:11434", "http://host.docker.internal:11435"]
    EMBED_MODEL: str = "nomic-embed-text"
    DEFAULT_CHAT_MODEL: str = "qwen2.5:7b"
    DEFAULT_VISION_MODEL: str = "gemma3:4b"
    
    # ChromaDB
    CHROMA_PERSIST_DIR: str = str(Path(__file__).parent.parent / "data" / "chroma")
    CHROMA_COLLECTION: str = "memos"
    
    # Chunking
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 50

    # Speech-to-text (faster-whisper). Multilingual, runs locally. Override via
    # env (e.g. WHISPER_MODEL=large-v3) — see docs. On CPU, "small" is a good
    # accuracy/speed balance; "medium"/"large-v3" need a GPU to stay snappy.
    WHISPER_MODEL: str = "small"          # tiny|base|small|medium|large-v3
    WHISPER_DEVICE: str = "auto"          # auto|cpu|cuda
    WHISPER_COMPUTE_TYPE: str = "auto"    # auto|int8|float16|float32
    WHISPER_BEAM_SIZE: int = 1
    
    # RAG
    RAG_TOP_K: int = 8
    
    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://localhost:80",
        "http://localhost:8091",
        "http://localhost",

    ]
    
    @field_validator("OLLAMA_HOSTS", "CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_comma_separated_list(cls, v):
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
