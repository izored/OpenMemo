"""Embedding pipeline - chunks text and stores in ChromaDB."""
from backend.core.ollama_client import ollama_client
from backend.core.chunker import chunk_text
from backend.db.chroma_client import get_collection


async def embed_memo(
    memo_id: str,
    text: str,
    metadata: dict,
) -> list[str]:
    """Chunk text, generate embeddings, store in ChromaDB.
    
    Returns list of chunk IDs stored.
    """
    if not text or not text.strip():
        return []
    
    chunks = chunk_text(text)
    if not chunks:
        return []
    
    # Generate embeddings in batch
    embeddings = await ollama_client.embed_batch(chunks)
    
    # Store in ChromaDB
    collection = get_collection()
    ids = [f"memo_{memo_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas = [
        {
            "memo_id": memo_id,
            "workspace_id": metadata.get("workspace_id", ""),
            "type": metadata.get("type", ""),
            "title": metadata.get("title", ""),
            "source_domain": metadata.get("source_domain", ""),
            "chunk_index": i,
        }
        for i in range(len(chunks))
    ]
    
    collection.upsert(
        ids=ids,
        documents=chunks,
        embeddings=embeddings,
        metadatas=metadatas,
    )
    
    return ids


async def delete_memo_embeddings(memo_id: str):
    """Remove all chunks for a memo from ChromaDB."""
    collection = get_collection()
    # Get all chunks for this memo
    results = collection.get(
        where={"memo_id": memo_id},
    )
    if results["ids"]:
        collection.delete(ids=results["ids"])


async def search_similar(
    query: str,
    workspace_id: str | None = None,
    collection_id: str | None = None,
    memo_id: str | None = None,
    n_results: int = 8,
) -> list[dict]:
    """Search ChromaDB for similar chunks."""
    from backend.config import settings
    
    # Generate query embedding
    query_embedding = await ollama_client.embed(query)
    
    collection = get_collection()
    
    # Build where filter
    where = {}
    if workspace_id:
        where["workspace_id"] = workspace_id
    if memo_id:
        where["memo_id"] = memo_id
    
    kwargs = {
        "query_embeddings": [query_embedding],
        "n_results": n_results,
    }
    if where:
        kwargs["where"] = where
    
    results = collection.query(**kwargs)
    
    # Format results
    items = []
    if results and results["ids"] and results["ids"][0]:
        for i, doc_id in enumerate(results["ids"][0]):
            items.append({
                "id": doc_id,
                "document": results["documents"][0][i] if results["documents"] else "",
                "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                "distance": results["distances"][0][i] if results["distances"] else 0,
            })
    
    return items
