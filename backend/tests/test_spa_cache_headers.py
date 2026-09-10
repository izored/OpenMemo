"""The desktop app must not load the previous build's shell from cache.

openMemo 3.21.0 shipped a new back control and a new sidebar toggle. The .dmg
was verified to contain them: the bundled `index.html` names
`assets/index-BiCUFzlu.js`, and that file carries `om-back-btn` and
`om-global-back`. The update installed and the UI did not change.

The reason is here, in the route that serves the SPA to the .app's window.
`FileResponse` sends `Last-Modified` and `ETag` and no `Cache-Control` at all,
and a response with no freshness directive is HEURISTICALLY cached — the
browser invents a lifetime from how old `Last-Modified` is and serves the file
without asking. Chromium's cache lives in userData, which survives replacing
OpenMemo.app entirely, so the window could load the OLD index.html, which names
the OLD asset hashes, which were cached too. A whole update, invisible.

Every asset Vite emits under `assets/` is fingerprinted, so those may be cached
forever. `index.html` is one URL whose content changes every build and must be
revalidated. So must the unfingerprinted files next to it (`favicon.svg`,
`icons.svg`, the pdfjs worker), which go stale in exactly the same way.

The route is registered at import time from `settings.FRONTEND_DIST`, which the
suite deliberately leaves empty, so this runs the real `backend.main` in a
subprocess with that set and a throwaway data directory.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

_PROBE = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
out = {}
for path in ("/", "/settings", "/assets/index-abc123.js", "/favicon.svg"):
    r = client.get(path)
    out[path] = {
        "status": r.status_code,
        "cache_control": r.headers.get("cache-control"),
        "etag": bool(r.headers.get("etag")),
    }
print("PROBE" + json.dumps(out))
"""


@pytest.fixture(scope="module")
def probe():
    """Boot the real app with a built-frontend directory and report its headers."""
    tmp = Path(tempfile.mkdtemp(prefix="openmemo-spa-"))
    dist = tmp / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(
        '<!doctype html><script src="/assets/index-abc123.js"></script>',
        encoding="utf-8",
    )
    (dist / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")

    data = tmp / "data"
    files = tmp / "files"
    data.mkdir()
    files.mkdir()

    repo_root = str(Path(__file__).resolve().parents[2])
    env = {
        **os.environ,
        "FRONTEND_DIST": str(dist),
        "DATA_DIR": str(data),
        "DATABASE_URL": f"sqlite+aiosqlite:///{(data / 'openmemo.db').as_posix()}",
        "FILES_DIR": str(files),
        "CHROMA_PERSIST_DIR": str(tmp / "chroma"),
        "OPENMEMO_DISABLE_JOB_WORKERS": "1",
    }
    run = subprocess.run(
        [sys.executable, "-c", _PROBE, repo_root],
        capture_output=True, text=True, timeout=300, env=env, cwd=repo_root,
    )
    line = next(
        (ln for ln in run.stdout.splitlines() if ln.startswith("PROBE")), None
    )
    if line is None:
        pytest.fail(f"probe did not report\nstdout:\n{run.stdout}\nstderr:\n{run.stderr}")
    return json.loads(line[len("PROBE"):])


def test_the_app_shell_is_revalidated_on_every_load(probe):
    """`no-cache` does not mean "do not store" — the copy stays on disk and the
    ETag still answers 304. What it removes is the browser's licence to skip
    the request, which is the licence that hid a whole release."""
    for path in ("/", "/settings"):
        assert probe[path]["status"] == 200
        assert probe[path]["cache_control"] == "no-cache", path


def test_a_fingerprinted_asset_is_cached_forever(probe):
    """The hash IS the cache key. Revalidating these would be pure cost."""
    asset = probe["/assets/index-abc123.js"]
    assert asset["status"] == 200
    assert asset["cache_control"] == "public, max-age=31536000, immutable"


def test_an_unfingerprinted_file_is_revalidated_too(probe):
    """favicon.svg, icons.svg and the pdfjs worker keep one name across builds,
    so caching them forever is the same bug with a smaller blast radius."""
    fav = probe["/favicon.svg"]
    assert fav["status"] == 200
    assert fav["cache_control"] == "no-cache"


def test_the_validator_survives(probe):
    """Revalidation is only cheap because the ETag is still there to answer it."""
    assert probe["/"]["etag"] is True
