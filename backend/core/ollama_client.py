"""Ollama HTTP client for embeddings, chat, and vision with multi-host fallback."""
import asyncio
import httpx
import time
from typing import AsyncGenerator

from backend.config import settings


class OllamaClient:
    def __init__(self):
        self.hosts = settings.OLLAMA_HOSTS if settings.OLLAMA_HOSTS else [settings.OLLAMA_HOST]
        self.timeout = httpx.Timeout(180.0, connect=10.0)
        self._working_host: str | None = None
        self._host_cache_time: float = 0.0
        self._host_cache_ttl: float = 30.0

    async def _get_working_host(self) -> str:
        """Return the first responsive Ollama host, with caching."""
        now = time.monotonic()
        if self._working_host and (now - self._host_cache_time) < self._host_cache_ttl:
            # Verify cached host is still alive
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0)) as client:
                    resp = await client.get(f"{self._working_host}/api/tags")
                    if resp.status_code == 200:
                        return self._working_host
            except Exception:
                pass

        for host in self.hosts:
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0)) as client:
                    resp = await client.get(f"{host}/api/tags")
                    if resp.status_code == 200:
                        self._working_host = host
                        self._host_cache_time = now
                        print(f"[OllamaClient] Using host: {host}")
                        return host
            except Exception:
                continue

        # Fallback to first host even if none respond (will fail loudly on next request)
        print(f"[OllamaClient] WARNING: No Ollama host reachable. Falling back to {self.hosts[0]}")
        return self.hosts[0]

    async def health_check(self) -> bool:
        try:
            host = await self._get_working_host()
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{host}/api/tags")
                return resp.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{host}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            return data.get("models", [])

    async def embed(self, text: str, model: str | None = None) -> list[float]:
        model = model or settings.EMBED_MODEL
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{host}/api/embed",
                json={"model": model, "input": text},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["embeddings"][0]

    async def embed_batch(self, texts: list[str], model: str | None = None) -> list[list[float]]:
        model = model or settings.EMBED_MODEL
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{host}/api/embed",
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
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{host}/api/chat",
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
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{host}/api/chat",
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
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{host}/api/chat",
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
