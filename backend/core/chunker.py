"""Text chunking with token-aware splitting and overlap."""
import re
from backend.config import settings


def chunk_text(
    text: str,
    chunk_size: int | None = None,
    overlap: int | None = None,
) -> list[str]:
    """Split text into overlapping chunks based on approximate token count.
    
    Uses word-based splitting as a proxy for tokens (~1.3 words per token).
    """
    chunk_size = chunk_size or settings.CHUNK_SIZE
    overlap = overlap or settings.CHUNK_OVERLAP
    
    if not text or not text.strip():
        return []
    
    # Clean text
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()
    
    # Approximate tokens as words * 0.75
    words = text.split()
    words_per_chunk = int(chunk_size * 0.75)  # ~tokens to words ratio
    overlap_words = int(overlap * 0.75)
    
    if len(words) <= words_per_chunk:
        return [text]
    
    chunks = []
    start = 0
    
    while start < len(words):
        end = start + words_per_chunk
        chunk_words = words[start:end]
        chunk = " ".join(chunk_words)
        
        # Try to break at sentence boundary
        if end < len(words):
            last_period = chunk.rfind('. ')
            last_newline = chunk.rfind('\n')
            break_point = max(last_period, last_newline)
            if break_point > len(chunk) * 0.5:
                chunk = chunk[:break_point + 1]
                # Recalculate end based on actual chunk
                actual_words = len(chunk.split())
                end = start + actual_words
        
        chunks.append(chunk.strip())
        start = end - overlap_words
    
    return [c for c in chunks if c]
