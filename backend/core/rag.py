"""RAG pipeline - retrieval-augmented generation for AskMemo."""
from typing import AsyncGenerator

from backend.core.embedder import search_similar
from backend.core.ollama_client import ollama_client


SYSTEM_PROMPT = """You are MemoAI, a helpful assistant that answers questions using ONLY the provided context from the user's saved memos (articles, notes, videos, documents, etc.).

Rules:
1. Answer based ONLY on the provided context. Do not use external knowledge.
2. Cite sources using [1], [2], etc. format, corresponding to the provided sources.
3. If the context doesn't contain enough information to answer, say so honestly.
4. Be concise and helpful. Provide structured answers when appropriate.
5. When multiple sources discuss the same topic, synthesize them into a coherent answer.
"""

GENERAL_SYSTEM_PROMPT = """You are MemoAI, a helpful general-purpose assistant. Answer the user's question to the best of your ability."""


def build_context_prompt(sources: list[dict]) -> str:
    """Build context block from retrieved chunks."""
    context_parts = []
    for i, source in enumerate(sources, 1):
        title = source["metadata"].get("title", "Untitled")
        domain = source["metadata"].get("source_domain", "")
        source_info = f"[{i}] {title}"
        if domain:
            source_info += f" ({domain})"
        context_parts.append(f"{source_info}\n{source['document']}\n")
    
    return "---\nCONTEXT FROM USER'S MEMOS:\n\n" + "\n".join(context_parts) + "\n---"


async def rag_chat(
    query: str,
    workspace_id: str | None = None,
    collection_id: str | None = None,
    memo_id: str | None = None,
    model: str | None = None,
    history: list[dict] | None = None,
    use_rag: bool = True,
) -> AsyncGenerator[dict, None]:
    """RAG chat pipeline with streaming response.
    
    Yields dicts: {"type": "sources", "data": [...]} then {"type": "token", "data": "..."}
    """
    sources = []
    
    if use_rag:
        # Retrieve relevant chunks
        sources = await search_similar(
            query=query,
            workspace_id=workspace_id,
            collection_id=collection_id,
            memo_id=memo_id,
        )
        
        # Yield sources first so frontend can display them
        yield {
            "type": "sources",
            "data": [
                {
                    "memo_id": s["metadata"].get("memo_id"),
                    "title": s["metadata"].get("title", "Untitled"),
                    "domain": s["metadata"].get("source_domain", ""),
                    "snippet": s["document"][:200],
                    "distance": s["distance"],
                }
                for s in sources
            ],
        }
        
        # Build messages
        context = build_context_prompt(sources)
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"{context}\n\nQuestion: {query}"},
        ]
    else:
        # Direct LLM query (no RAG)
        messages = [
            {"role": "system", "content": GENERAL_SYSTEM_PROMPT},
        ]
        # Add history if available
        if history:
            messages.extend(history[-6:])  # Last 3 exchanges
        messages.append({"role": "user", "content": query})
    
    # Stream response
    async for token in ollama_client.chat(messages=messages, model=model, stream=True):
        yield {"type": "token", "data": token}


async def generate_summary(text: str, model: str | None = None) -> str:
    """Generate AI summary for a memo."""
    prompt = (
        "Extract 3-5 key insights from the following content. "
        "Return as bullet points. Be concise and informative.\n\n"
        f"{text[:3000]}"  # Limit input
    )
    messages = [
        {"role": "system", "content": "You are a concise summarizer. Extract key points only."},
        {"role": "user", "content": prompt},
    ]
    return await ollama_client.chat_sync(messages=messages, model=model)
