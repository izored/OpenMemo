#!/usr/bin/env python3
"""Block personal data / secrets from reaching git.

Mandatory pre-commit comb-through (see docs/SECURITY-personal-data.md). Runs on
every commit via .githooks/pre-commit. Two layers:

  1. Secret FILE PATHS — a cookie jar, a database, the app-settings JSON, or
     anything under data/ must never be staged. This is the reliable signal
     (these are already gitignored; this catches a `git add -f` mistake).
  2. Secret CONTENT signatures — high-confidence patterns (private keys, a
     Netscape cookie jar header, an Instagram session cookie line, a Telegram
     bot token, AWS keys). Tuned to NOT trip on source code that merely mentions
     a cookie name as a string.

Usage:
  python scripts/check_secrets.py            # scan STAGED changes (pre-commit)
  python scripts/check_secrets.py --all      # scan every tracked file (audit)

Exit 0 = clean; exit 1 = a secret was found (commit is blocked).
"""
from __future__ import annotations

import re
import subprocess
import sys

# Files that are self-referential about secrets (they describe the patterns) —
# never flag them, or the scanner blocks its own docs.
_ALLOW_PATHS = {
    "scripts/check_secrets.py",
    "docs/SECURITY-personal-data.md",
}
_ALLOW_PREFIXES = (".claude/", ".githooks/")

# Staged paths that must never be committed (personal data / runtime state).
_FORBIDDEN_PATH_RES = [
    re.compile(r"(^|/)yt_cookies\.txt$", re.I),
    re.compile(r"(^|/)cookies.*\.txt$", re.I),
    re.compile(r"(^|/)ig_session.*\.json$", re.I),
    re.compile(r"(^|/)app_settings\.json$", re.I),
    re.compile(r"\.db$", re.I),
    re.compile(r"(^|/)data/", re.I),
    re.compile(r"(^|/)\.env$", re.I),
    re.compile(r"(^|/)secrets/", re.I),
]

# High-confidence content signatures. Each is (label, compiled regex).
_CONTENT_RES = [
    ("private key block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----")),
    # Line-anchored: a real jar starts with this header on its own line. Source
    # code that mentions the string (indented, quoted) never matches.
    ("Netscape cookie jar header", re.compile(r"^# Netscape HTTP Cookie File", re.M)),
    # A real cookie jar line for Instagram: 7 tab columns incl. sessionid/ds_user_id.
    ("Instagram session cookie line", re.compile(r"instagram\.com\t\S*\t\S*\t\S*\t\S*\t(?:sessionid|ds_user_id)\t\S+")),
    # An IG sessionid VALUE (userid%3Atoken%3An) — not the bare word in code.
    ("Instagram sessionid value", re.compile(r"sessionid=\d{4,}%3A[A-Za-z0-9%_-]{10,}")),
    ("Telegram bot token", re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b")),
    ("AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
]


def _run(args: list[str]) -> str:
    # Force UTF-8 decoding — the Windows locale (cp1252) chokes on emoji/UTF-8
    # content (e.g. the changelog), and a decode failure must never silently skip
    # a file from the scan. errors="replace" keeps every byte scannable.
    return subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8", errors="replace"
    ).stdout


def _staged_files() -> list[str]:
    out = _run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"])
    return [l.strip() for l in out.splitlines() if l.strip()]


def _tracked_files() -> list[str]:
    return [l.strip() for l in _run(["git", "ls-files"]).splitlines() if l.strip()]


def _content(path: str, staged: bool) -> str:
    if staged:
        return _run(["git", "show", f":{path}"])
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except OSError:
        return ""


def _allowed(path: str) -> bool:
    p = path.replace("\\", "/")
    return p in _ALLOW_PATHS or p.startswith(_ALLOW_PREFIXES)


def scan(all_tracked: bool) -> list[str]:
    files = _tracked_files() if all_tracked else _staged_files()
    findings: list[str] = []
    for path in files:
        norm = path.replace("\\", "/")
        if _allowed(norm):
            continue
        for rx in _FORBIDDEN_PATH_RES:
            if rx.search(norm):
                findings.append(f"  [path] {path} — personal/runtime file must never be committed")
                break
        # Only read text-ish files for content scanning (skip big binaries).
        if norm.rsplit(".", 1)[-1].lower() in {"png", "jpg", "jpeg", "webp", "gif", "avif", "mp4", "mp3", "zip", "db", "ico", "woff", "woff2"}:
            continue
        text = _content(path, staged=not all_tracked)
        if not text:
            continue
        for label, rx in _CONTENT_RES:
            if rx.search(text):
                findings.append(f"  [content] {path} — looks like a {label}")
    return findings


def main() -> int:
    all_tracked = "--all" in sys.argv[1:]
    findings = scan(all_tracked)
    scope = "tracked files" if all_tracked else "staged changes"
    if findings:
        print(f"\n[FAIL] Secret / personal-data check FAILED ({scope}):\n")
        print("\n".join(findings))
        print(
            "\nThis commit was blocked so your cookies / session / passwords / "
            "database never reach GitHub.\nIf a match is a false positive, add the "
            "path to _ALLOW_PATHS in scripts/check_secrets.py.\n"
        )
        return 1
    print(f"[OK] Secret check clean ({scope}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
