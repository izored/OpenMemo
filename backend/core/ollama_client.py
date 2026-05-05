"""Ollama HTTP client for embeddings, chat, and vision."""
import httpx
from typing import AsyncGenerator

from backend.config import settings


class OllamaClient:
    def __init__(self):
        self.base_url = settings.OLLAMA_HOST
        self.timeout = httpx.Timeout(120.0, connect=10.0)

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                return resp.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{self.base_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            return data.get("models", [])

    async def embed(self, text: str, model: str | None = None) -> list[float]:
        model = model or settings.EMBED_MODEL
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/embed",
                json={"model": model, "input": text},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["embeddings"][0]

    async def embed_batch(self, texts: list[str], model: str | None = None) -> list[list[float]]:
        model = model or settings.EMBED_MODEL
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/embed",
                json={"model": model, "input": texts},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["embeddings"]

    async def chat(
        self,
        messages: list[dict],
        model: str | None = None,
        stream: bool = True,
    ) -> AsyncGenerator[str, None]:
        model = model or settings.DEFAULT_CHAT_MODEL
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json={"model": model, "messages": messages, "stream": stream},
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line:
                        import json
                        data = json.loads(line)
                        if "message" in data and "content" in data["message"]:
                            yield data["message"]["content"]
                        if data.get("done"):
                            break

    async def chat_sync(
        self,
        messages: list[dict],
        model: str | None = None,
    ) -> str:
        model = model or settings.DEFAULT_CHAT_MODEL
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/chat",
                json={"model": model, "messages": messages, "stream": False},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["message"]["content"]

    async def vision(
        self,
        image_base64: str,
        prompt: str = "Describe this image in detail. Extract any text visible.",
        model: str | None = None,
    ) -> str:
        model = model or settings.DEFAULT_VISION_MODEL
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt,
                            "images": [image_base64],
                        }
                    ],
                    "stream": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["message"]["content"]


ollama_client = OllamaClient()
