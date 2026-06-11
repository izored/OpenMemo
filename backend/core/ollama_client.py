"""Ollama HTTP client for embeddings, chat, and vision with multi-host fallback."""
import asyncio
import httpx
import time
from typing import AsyncGenerator

from backend.config import settings


class OllamaModelMissing(Exception):
    """Raised when the requested model is not installed on any reachable host."""

    def __init__(self, model: str):
        self.model = model
        super().__init__(
            f"Model '{model}' is not installed in Ollama. "
            f"Pull it with `ollama pull {model}` or pick another model in Settings."
        )


class OllamaClient:
    def __init__(self):
        self.hosts = settings.OLLAMA_HOSTS if settings.OLLAMA_HOSTS else [settings.OLLAMA_HOST]
        self.timeout = httpx.Timeout(180.0, connect=10.0)
        self._working_host: str | None = None
        self._host_cache_time: float = 0.0
        self._host_cache_ttl: float = 30.0
        # Short-lived cache for the Settings reachability probe (see health_check).
        # Separate from the working-host cache: this also remembers a *negative*
        # result so a down Ollama isn't re-probed on every Settings render.
        self._status_cache_val: bool = False
        self._status_cache_time: float = 0.0
        self._status_ttl: float = 15.0
        # Installed-model-name cache for resolve_chat_model (60s — model installs
        # are rare; a stale miss just means one extra fallback hop).
        self._models_cache: list[str] = []
        self._models_cache_time: float = 0.0
        self._models_ttl: float = 60.0

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
        """Fast, cached Ollama reachability probe for the Settings UI.

        Short timeout (~1.5s connect) and a 15s result cache so a down Ollama
        never stalls the caller. This is NOT API liveness: the container
        healthcheck hits /api/ping, which has no external dependencies. Memos,
        search and browsing all work with Ollama offline, so it must never gate
        the API. (The old path used a 10s connect timeout and double-probed via
        _get_working_host, which is what made a down LLM cost ~13s.)
        """
        now = time.monotonic()
        if self._status_cache_time and (now - self._status_cache_time) < self._status_ttl:
            return self._status_cache_val

        reachable = False
        for host in self.hosts:
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(2.0, connect=1.5)) as client:
                    resp = await client.get(f"{host}/api/tags")
                    if resp.status_code == 200:
                        self._working_host = host
                        self._host_cache_time = now
                        reachable = True
                        break
            except Exception:
                continue

        self._status_cache_val = reachable
        self._status_cache_time = now
        return reachable

    async def list_models(self) -> list[dict]:
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{host}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            return data.get("models", [])

    async def installed_model_names(self) -> list[str]:
        """Installed model names, cached for 60s. Empty list when Ollama is down."""
        now = time.monotonic()
        if self._models_cache and (now - self._models_cache_time) < self._models_ttl:
            return self._models_cache
        try:
            models = await self.list_models()
            self._models_cache = [m.get("name", "") for m in models if m.get("name")]
            self._models_cache_time = now
        except Exception:
            self._models_cache = []
        return self._models_cache

    async def resolve_chat_model(self, requested: str | None = None) -> str:
        """Resolve a chat model that actually exists on the Ollama host.

        Resolution order (first installed candidate wins):
          1. the explicitly requested model (per-request override),
          2. the user's runtime default (Settings → app_settings.json `chat_model`),
          3. the env/static default (DEFAULT_CHAT_MODEL),
          4. any installed non-embedding model.
        Matching is case-insensitive ("Qwen2.5:3b" vs "qwen2.5:3b") and returns the
        canonical installed name. Raises OllamaModelMissing when an explicit request
        can't be honored, so the API can report WHICH model is absent instead of a
        bare 500. When Ollama is unreachable the requested/default name is returned
        as-is — the actual call will fail with a connection error, which is the
        truthful failure to surface.
        """
        from backend.core.app_settings import get_settings as get_app_settings

        installed = await self.installed_model_names()
        if not installed:
            return requested or settings.DEFAULT_CHAT_MODEL

        by_lower = {name.lower(): name for name in installed}

        def find(name: str | None) -> str | None:
            return by_lower.get(name.strip().lower()) if name and name.strip() else None

        if requested:
            hit = find(requested)
            if hit:
                return hit
            raise OllamaModelMissing(requested)

        runtime_default = (get_app_settings().get("chat_model") or "").strip()
        for candidate in (runtime_default, settings.DEFAULT_CHAT_MODEL):
            hit = find(candidate)
            if hit:
                return hit

        # Last resort: first installed model that isn't embedding-only.
        for name in installed:
            if "embed" not in name.lower():
                return name
        raise OllamaModelMissing(settings.DEFAULT_CHAT_MODEL)

    def _is_endpoint_not_found(self, resp: httpx.Response) -> bool:
        """True only when the route itself is missing, not when the model is missing."""
        if resp.status_code != 404:
            return False
        try:
            body = resp.json()
            msg = str(body.get("error", "")).lower()
            return not msg or "not found" not in msg or "model" not in msg
        except Exception:
            return True  # no JSON body → route missing

    async def embed(self, text: str, model: str | None = None) -> list[float]:
        model = model or settings.EMBED_MODEL
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{host}/api/embed",
                json={"model": model, "input": text},
            )
            if self._is_endpoint_not_found(resp):
                # Legacy Ollama — endpoint doesn't exist, try old API
                resp = await client.post(
                    f"{host}/api/embeddings",
                    json={"model": model, "prompt": text},
                )
                resp.raise_for_status()
                data = resp.json()
                return data["embedding"]
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
            if self._is_endpoint_not_found(resp):
                # Legacy Ollama — sequential single embeds
                results = []
                for text in texts:
                    r = await client.post(
                        f"{host}/api/embeddings",
                        json={"model": model, "prompt": text},
                    )
                    r.raise_for_status()
                    results.append(r.json()["embedding"])
                return results
            resp.raise_for_status()
            data = resp.json()
            return data["embeddings"]

    async def chat(
        self,
        messages: list[dict],
        model: str | None = None,
        stream: bool = True,
    ) -> AsyncGenerator[str, None]:
        model = await self.resolve_chat_model(model)
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{host}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": stream,
                    # Ollama defaults num_ctx to 4096 and SILENTLY truncates longer
                    # prompts — a full RAG context or a long transcript loses its
                    # tail without any error. Raise the window explicitly.
                    "options": {"num_ctx": settings.OLLAMA_NUM_CTX},
                },
            ) as resp:
                if resp.status_code == 404:
                    raise OllamaModelMissing(model)
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
        model = await self.resolve_chat_model(model)
        host = await self._get_working_host()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{host}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "options": {"num_ctx": settings.OLLAMA_NUM_CTX},
                },
            )
            if resp.status_code == 404:
                raise OllamaModelMissing(model)
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
            if resp.status_code == 404:
                raise OllamaModelMissing(model)
            resp.raise_for_status()
            data = resp.json()
            return data["message"]["content"]


ollama_client = OllamaClient()
