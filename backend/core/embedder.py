"""Embedding pipeline - chunks text and stores in ChromaDB."""
import asyncio
from backend.config import settings
from backend.core.ollama_client import ollama_client
from backend.core.chunker import chunk_text
from backend.db.chroma_client import get_collection


# nomic-embed models (v1 and v2-moe) are trained with task-instruction prefixes
# and retrieval quality collapses without them: documents and queries land in
# different regions of the embedding space, so nearest-neighbour search returns
# near-random chunks. The prefix is prepended for EMBEDDING ONLY — the stored
# chunk text stays clean. Other embed models get no prefix.
# https://docs.nomic.ai/atlas/models/text-embedding
def _task_prefixes() -> tuple[str, str]:
    """(document_prefix, query_prefix) for the active EMBED_MODEL."""
    if "nomic" in settings.EMBED_MODEL.lower():
        return "search_document: ", "search_query: "
    return "", ""


def build_embed_text(memo) -> str:
    """All searchable text for a memo, combined into one blob for embedding.

    The write-path bug (OPNMMO-0058): only `content_text` was embedded. For a
    video/audio memo the platform blurb lives in `video_description` and the
    spoken words in `content_text` (the transcript, once it exists) — different
    fields. So a video with a description but no transcript embedded NOTHING and
    was unretrievable, and a keyword hit on it fed the model an empty body. Ask
    then called such memos "just links".

    Combine title + description + body + AI summary + notes so every memo is
    retrievable by anything it actually holds, and its chunks carry enough
    context to answer from. Returns "" for a title-only memo (a fresh song, an
    un-pulled link) so callers still skip embedding nothing but a title.
    """
    desc = (getattr(memo, "video_description", None) or getattr(memo, "description", None) or "").strip()
    body = (getattr(memo, "content_text", None) or getattr(memo, "content_raw", None) or "").strip()
    summ = (getattr(memo, "ai_summary", None) or "").strip()
    notes = (getattr(memo, "notes", None) or "").strip()
    if not (desc or body or summ):
        return ""  # only a title so far — nothing worth indexing yet

    parts: list[str] = []
    title = (getattr(memo, "title", None) or "").strip()
    if title:
        parts.append(title)
    # For media before transcription content_text == video_description (the
    # extractor seeds it), so dedupe to avoid embedding the blurb twice.
    if desc and desc != body:
        parts.append(desc)
    if body:
        parts.append(body)
    if summ and summ not in (body, desc):
        parts.append(summ)
    if notes:
        parts.append(f"--- Notes ---\n{notes}")
    return "\n\n".join(parts)


def _build_where(filters: dict) -> dict | None:
    """Chroma `where` from {field: value}. Multiple conditions need an explicit
    $and — a flat multi-key dict is rejected by current Chroma versions."""
    clauses = [{k: v} for k, v in filters.items() if v is not None and v != ""]
    if not clauses:
        return None
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


async def embed_memo(
    memo_id: str,
    text: str,
    metadata: dict,
) -> list[str]:
    """Chunk text, generate embeddings, store in ChromaDB.

    Replaces any previous chunks for the memo (a shorter re-embed must not
    leave stale tail chunks behind). Returns list of chunk IDs stored.
    """
    if not text or not text.strip():
        return []

    chunks = chunk_text(text)
    if not chunks:
        return []

    doc_prefix, _ = _task_prefixes()
    embeddings = await ollama_client.embed_batch([doc_prefix + c for c in chunks])

    collection = get_collection()

    # Drop existing chunks first — upsert alone leaves orphans when the new
    # text yields fewer chunks than the old one.
    existing = await asyncio.to_thread(collection.get, where={"memo_id": memo_id})
    if existing["ids"]:
        await asyncio.to_thread(collection.delete, ids=existing["ids"])

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

    await asyncio.to_thread(
        collection.upsert,
        ids=ids,
        documents=chunks,
        embeddings=embeddings,
        metadatas=metadatas,
    )

    return ids


async def delete_memo_embeddings(memo_id: str):
    """Remove all chunks for a memo from ChromaDB."""
    collection = get_collection()
    # Get all chunks for this memo (blocking I/O)
    results = await asyncio.to_thread(
        collection.get,
        where={"memo_id": memo_id},
    )
    if results["ids"]:
        await asyncio.to_thread(collection.delete, ids=results["ids"])


async def _collection_memo_ids(collection_id: str) -> list[str]:
    """Live memo IDs belonging to an app collection (for scoped retrieval)."""
    from sqlalchemy import select
    from backend.db.database import AsyncSessionLocal
    from backend.db.models import Memo, memo_collections

    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(memo_collections.c.memo_id)
            .join(Memo, Memo.id == memo_collections.c.memo_id)
            .where(
                memo_collections.c.collection_id == collection_id,
                Memo.is_deleted == False,  # noqa: E712
            )
        )
        return [r[0] for r in rows.fetchall()]


async def search_similar(
    query: str,
    workspace_id: str | None = None,
    collection_id: str | None = None,
    memo_id: str | None = None,
    memo_ids: list[str] | None = None,
    n_results: int | None = None,
    max_distance: float | None = None,
) -> list[dict]:
    """Search ChromaDB for similar chunks.

    Scoping: memo_id pins to one memo; memo_ids pins to an explicit set (hybrid
    RAG pulls chunks for keyword-matched memos this way); collection_id
    resolves to that collection's live memos and filters with $in. Results
    farther than max_distance (cosine) are dropped — beyond it they're topic
    noise that only pollutes the model's context.
    """
    n_results = n_results or settings.RAG_TOP_K
    max_distance = max_distance if max_distance is not None else settings.RAG_MAX_DISTANCE

    _, query_prefix = _task_prefixes()
    query_embedding = await ollama_client.embed(query_prefix + query)

    collection = get_collection()

    filters: dict = {}
    if workspace_id:
        filters["workspace_id"] = workspace_id
    if memo_id:
        filters["memo_id"] = memo_id
    elif memo_ids:
        filters["memo_id"] = {"$in": memo_ids}
    elif collection_id:
        ids = await _collection_memo_ids(collection_id)
        if not ids:
            return []  # empty collection — nothing to retrieve from
        filters["memo_id"] = {"$in": ids}

    kwargs = {
        "query_embeddings": [query_embedding],
        "n_results": n_results,
    }
    where = _build_where(filters)
    if where:
        kwargs["where"] = where

    results = await asyncio.to_thread(collection.query, **kwargs)

    items = []
    if results and results["ids"] and results["ids"][0]:
        for i, doc_id in enumerate(results["ids"][0]):
            distance = results["distances"][0][i] if results["distances"] else 0
            if max_distance and distance > max_distance:
                continue
            items.append({
                "id": doc_id,
                "document": results["documents"][0][i] if results["documents"] else "",
                "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                "distance": distance,
            })

    return items
