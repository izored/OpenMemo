# Frequently Asked Questions

## Do I need a GPU?

**No.** OpenMemo works fine on CPU. A modern multi-core CPU can run 7B parameter models smoothly. A GPU (especially with 8GB+ VRAM) will make responses faster and enable larger models.

## Can I use this without Docker?

**Yes.** Docker is recommended because it handles the entire stack automatically, but you can run the backend and frontend directly. See `docs/deployment.md` for manual setup.

## Where is my data stored?

Everything is local:
- `data/openmemo.db` — SQLite database (memos, collections, tags)
- `data/chroma/` — Vector embeddings
- `files/` — Uploaded files and thumbnails

No data is sent to external APIs except the LLM inference through your local Ollama instance.

## How do I change the LLM model?

1. Pull a model via Ollama: `ollama pull llama3.1:8b`
2. Update the chat model in Settings → the dropdown reads from your local Ollama.

## Can multiple people use the same instance?

Currently OpenMemo is single-user. Multi-user support is on the roadmap.

## What file types can I upload?

- PDF, DOCX, XLSX, images (PNG, JPG), text files
- Max size: 50MB
- Files are scanned by magic bytes to validate type

## The search isn't finding my memos

Embeddings are generated in the background after ingestion. For large documents this can take 30-60 seconds. Keyword search (FTS5) works immediately.

## I get a CORS error

Add your origin to the `CORS_ORIGINS` environment variable in `.env`, then restart the API container:

```env
CORS_ORIGINS=http://localhost:3000,http://localhost,https://your-domain.com
```
