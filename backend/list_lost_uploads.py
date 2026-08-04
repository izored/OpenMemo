"""List the missing media that cannot be re-downloaded — the hand-search list.

Companion to `refetch_missing_media.py`, which handles everything with a
`source_url`. What is left are uploads: files that only ever existed on this
machine, so there is nowhere to fetch them from. The memo record survived, and
that is the whole point — for each one you still have the title you gave it,
the notes you wrote, its type, its collections and the date you added it. That
is what you search your other drives and your phone with.

The filename itself is an openMemo UUID and useless for searching. **Search by
type and date**, then confirm by opening the memo.

Read-only: it opens the database in SQLite's read-only mode and writes nothing
but the CSV checklist.

    python -m backend.list_lost_uploads
    python -m backend.list_lost_uploads --csv D:\\lost-uploads.csv

The CSV's last column, `found_at`, is yours to fill in as you find them.
"""
from __future__ import annotations

import argparse
import csv
import os
import sqlite3
import sys

from backend.config import settings
from backend.core.file_paths import resolve_memo_path


def _basename(p: str) -> str:
    return os.path.basename((p or "").replace("\\", "/").rstrip("/"))


def _default_db() -> str:
    return settings.DATABASE_URL.split("///")[-1]


def main() -> int:
    # Titles carry emoji, and a Windows console is cp1252 — without this the
    # whole listing dies on the first one instead of printing a "?".
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=_default_db(), help="database file (default: the app's own)")
    ap.add_argument("--csv", default="lost-uploads.csv", help="where to write the checklist")
    ap.add_argument(
        "--base-url",
        default="http://localhost:8091",
        help="so each row links to the memo, where your notes about it are",
    )
    args = ap.parse_args()

    if not os.path.isfile(args.db):
        print(f"Database not found: {args.db}")
        return 2

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    rows = [
        r
        for r in con.execute(
            """
            select id, type, title, file_path, created_at,
                   description, notes, audio_artist, audio_album
            from memos
            where (is_deleted = 0 or is_deleted is null)
              and file_path is not null and file_path <> ''
              and (source_url is null or source_url = '')
            order by type, created_at
            """
        )
        # A memo whose file is still on disk was never lost — only the gone ones.
        if resolve_memo_path(r["file_path"]) is None
    ]

    # Collections are another clue about what a file was for.
    colls: dict[str, list[str]] = {}
    try:
        for r in con.execute(
            "select mc.memo_id, c.name from memo_collections mc "
            "join collections c on c.id = mc.collection_id"
        ):
            colls.setdefault(r[0], []).append(r[1])
    except sqlite3.Error:
        pass
    con.close()

    if not rows:
        print("No missing uploads. Everything without a source URL is still on disk.")
        return 0

    print("=" * 100)
    print(f"  MISSING UPLOADS — {len(rows)} files that exist nowhere else")
    print("=" * 100)
    by_type: dict[str, int] = {}
    for r in rows:
        by_type[r["type"]] = by_type.get(r["type"], 0) + 1
    print("  " + "   ".join(f"{k}: {v}" for k, v in sorted(by_type.items())))

    current = None
    for r in rows:
        if r["type"] != current:
            current = r["type"]
            print(f"\n--- {current.upper()} " + "-" * (94 - len(current)))
        print(f"  {_basename(r['file_path'])}")
        print(f"      title      : {(r['title'] or '')[:80]}")
        print(f"      added      : {(r['created_at'] or '')[:10]}"
              f"    collections: {(', '.join(colls.get(r['id'], [])) or '-')[:50]}")
        extra = " ".join(x for x in (r["audio_artist"], r["audio_album"]) if x)
        if extra:
            print(f"      music      : {extra[:80]}")
        note = (r["notes"] or r["description"] or "").strip().replace("\n", " ")
        if note:
            print(f"      your notes : {note[:80]}")
        print(f"      open       : {args.base_url}/memo/{r['id']}")

    with open(args.csv, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["filename", "type", "title", "added", "collections",
                    "notes", "memo_url", "found_at"])
        for r in rows:
            w.writerow([
                _basename(r["file_path"]), r["type"], r["title"] or "",
                (r["created_at"] or "")[:10],
                ", ".join(colls.get(r["id"], [])),
                (r["notes"] or r["description"] or "").replace("\n", " ")[:200],
                f"{args.base_url}/memo/{r['id']}",
                "",   # yours to fill in
            ])

    print()
    print("=" * 100)
    print(f"  Checklist written to {args.csv}")
    print("  Search other drives by TYPE and DATE — the filenames are UUIDs.")
    print("  Note where you find each one in the 'found_at' column.")
    print("=" * 100)
    return 0


if __name__ == "__main__":
    sys.exit(main())
