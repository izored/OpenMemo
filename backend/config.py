from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    APP_NAME: str = "OpenMemo"
    VERSION: str = "1.0.0"
    
    # Paths
    BASE_DIR: Path = Path(__file__).parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    FILES_DIR: Path = BASE_DIR / "files"
    
    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/openmemo.db"
    
    # Ollama
    OLLAMA_HOST: str = "http://localhost:11434"
    EMBED_MODEL: str = "nomic-embed-text"
    DEFAULT_CHAT_MODEL: str = "qwen2.5:7b"
    DEFAULT_VISION_MODEL: str = "llava:13b"
    
    # ChromaDB
    CHROMA_PERSIST_DIR: str = "./data/chroma"
    CHROMA_COLLECTION: str = "memos"
    
    # Chunking
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 50
    
    # RAG
    RAG_TOP_K: int = 8
    
    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
