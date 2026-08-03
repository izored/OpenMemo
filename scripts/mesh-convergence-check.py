"""Prove two REAL openMemo instances converge (ADR-024, handbook §7f).

The single biggest gap in the Mesh test suite: every unit test runs both
"devices" against one database in one process. That proves the merge logic and
the protocol, but it cannot prove the thing the feature actually claims — that
two independent libraries end up the same.

This script closes it. Two separate DATA_DIRs, two separate databases, two
separate uvicorn processes, one real WebSocket between them. Nothing is shared
except the twelve-word Mesh code.

    python scripts/mesh-convergence-check.py

Exit code 0 means they converged. Anything else means they did not, and the
output says which rows disagree.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PY = sys.executable

# Two devices, two ports, two data directories. The Mesh listener port matters
# as much as the API port: both instances run one, and they must not collide.
DEVICES = [
    {"name": "alpha", "api": 8811, "mesh": 8871},
    {"name": "beta", "api": 8812, "mesh": 8872},
]


def api(port: int, path: str, method: str = "GET", body: dict | None = None,
        timeout: float = 20.0) -> dict:
    url = f"http://127.0.0.1:{port}/api{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode()
    return json.loads(raw) if raw else {}


def wait_for(port: int, seconds: float = 60.0) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            api(port, "/ping", timeout=3)
            return
        except (urllib.error.URLError, OSError, TimeoutError):
            time.sleep(1)
    raise SystemExit(f"instance on :{port} never came up")


def start(device: dict, data_dir: Path) -> subprocess.Popen:
    env = dict(os.environ)
    env["DATA_DIR"] = data_dir.as_posix()
    env["DATABASE_URL"] = f"sqlite+aiosqlite:///{(data_dir / 'openmemo.db').as_posix()}"
    env["FILES_DIR"] = (data_dir / "files").as_posix()
    env["CHROMA_PERSIST_DIR"] = (data_dir / "chroma").as_posix()
    env["OPENMEMO_MESH_PORT"] = str(device["mesh"])
    return subprocess.Popen(
        [PY, "-m", "uvicorn", "backend.main:app",
         "--host", "127.0.0.1", "--port", str(device["api"]), "--log-level", "warning"],
        cwd=REPO, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def rows(data_dir: Path, table: str, cols: str) -> list[tuple]:
    con = sqlite3.connect(data_dir / "openmemo.db")
    try:
        return sorted(con.execute(f"SELECT {cols} FROM {table}").fetchall())
    finally:
        con.close()


def main() -> int:
    work = Path(tempfile.mkdtemp(prefix="mesh-converge-"))
    dirs = {d["name"]: work / d["name"] for d in DEVICES}
    for p in dirs.values():
        p.mkdir(parents=True)

    procs: list[subprocess.Popen] = []
    try:
        print("starting two independent instances…")
        for d in DEVICES:
            procs.append(start(d, dirs[d["name"]]))
        for d in DEVICES:
            wait_for(d["api"])
        print("  both up")

        for d in DEVICES:
            api(d["api"], "/settings", "PUT", {"mesh_enabled": True})
        print("  Mesh enabled on both")

        # One code, shared. This is the ONLY thing the two instances have in
        # common — no shared database, no shared files, no shared process.
        pair = api(DEVICES[0]["api"], "/mesh/pair/start", "POST")
        code = pair["code"]
        print(f"  alpha minted a code ({len(code.split())} words)")
        api(DEVICES[1]["api"], "/mesh/pair/join", "POST", {"code": code})
        print("  beta joined with it")

        # Divergent writes: each side creates something the other has never seen.
        api(DEVICES[0]["api"], "/memos", "POST",
            {"type": "note", "title": "written on alpha",
             "content_raw": "alpha wrote this"})
        api(DEVICES[1]["api"], "/memos", "POST",
            {"type": "note", "title": "written on beta",
             "content_raw": "beta wrote this"})
        print("  each side wrote a memo the other has never seen")

        before = {n: rows(p, "memos", "id, title") for n, p in dirs.items()}
        print(f"  alpha has {len(before['alpha'])}, beta has {len(before['beta'])}")
        if before["alpha"] == before["beta"]:
            print("!! the two libraries were already identical — the test proves nothing")
            return 2

        print("\nsyncing over a real socket…")
        result = api(DEVICES[1]["api"], "/mesh/sync", "POST",
                     {"host": "127.0.0.1", "port": DEVICES[0]["mesh"]}, timeout=90)
        print(f"  {result}")

        time.sleep(3)
        after = {n: rows(p, "memos", "id, title") for n, p in dirs.items()}
        print(f"\n  alpha now has {len(after['alpha'])}: "
              f"{[t for _, t in after['alpha']]}")
        print(f"  beta  now has {len(after['beta'])}: "
              f"{[t for _, t in after['beta']]}")

        if after["alpha"] != after["beta"]:
            only_a = set(after["alpha"]) - set(after["beta"])
            only_b = set(after["beta"]) - set(after["alpha"])
            print("\nFAILED — the libraries did not converge")
            if only_a:
                print(f"  only on alpha: {sorted(only_a)}")
            if only_b:
                print(f"  only on beta:  {sorted(only_b)}")
            return 1

        print("\nCONVERGED — two separate databases now hold the same memos.")
        return 0

    finally:
        for p in procs:
            p.terminate()
        for p in procs:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
