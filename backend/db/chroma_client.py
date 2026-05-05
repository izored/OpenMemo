import chromadb
from chromadb.config import Settings as ChromaSettings
from pathlib import Path

from backend.config import settings

# Ensure chroma directory exists
Path(settings.CHROMA_PERSIST_DIR).mkdir(parents=True, exist_ok=True)

chroma_client = chromadb.PersistentClient(
    path=settings.CHROMA_PERSIST_DIR,
    settings=ChromaSettings(anonymized_telemetry=False),
)


def get_collection():
    return chroma_client.get_or_create_collection(
        name=settings.CHROMA_COLLECTION,
        metadata={"hnsw:space": "cosine"},
    )
