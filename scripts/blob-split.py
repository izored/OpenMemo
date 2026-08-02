"""Measure how much of the library is re-derivable vs. must cross the wire.

Backs the numbers in Specs/device-sync.md §1. A blob whose memo has a
source_url can be refetched by any device from the original source; one without
has no other copy in existence and must transfer peer to peer.

Run from the repo root:  python scripts/blob-split.py
"""
import os
import sqlite3
import sys
from pathlib import Path

DB = Path("data/openmemo.db")
FILES = Path("files")
GB = 1e9


def main() -> int:
    if not DB.exists():
        print(f"no database at {DB} — run from the repo root", file=sys.stderr)
        return 1

    # One pass over the tree; memo file_path columns hold absolute paths from
    # whichever environment wrote them, so match on basename only.
    index: dict[str, Path] = {}
    for f in FILES.rglob("*"):
        if f.is_file():
            index.setdefault(f.name, f)

    def size_of(stored: str | None) -> int:
        if not stored:
            return 0
        f = index.get(os.path.basename(str(stored).replace("\\", "/")))
        try:
            return f.stat().st_size if f else 0
        except OSError:
            return 0

    conn = sqlite3.connect(DB)
    rows = conn.execute(
        "select source_url, file_path from memos "
        "where is_deleted = 0 and file_path is not null and file_path != ''"
    ).fetchall()

    derivable = local = 0
    n_derivable = n_local = 0
    for source_url, file_path in rows:
        size = size_of(file_path)
        if source_url:
            derivable += size
            n_derivable += 1
        else:
            local += size
            n_local += 1

    total = sum(f.stat().st_size for f in FILES.rglob("*") if f.is_file())
    thumbs = sum(f.stat().st_size for f in (FILES / "thumbs").rglob("*") if f.is_file())
    db_size = DB.stat().st_size

    # Covers live in data/, NOT files/ — which is why the first version of this
    # script missed them entirely, and why the sync design nearly did too. They
    # have no source to refetch from, so every byte here must cross the wire.
    covers = 0
    n_covers = 0
    for folder in ("space_covers", "playlist_covers"):
        d = Path("data") / folder
        if d.exists():
            for f in d.rglob("*"):
                if f.is_file():
                    covers += f.stat().st_size
                    n_covers += 1

    must_cross = local + covers

    print(f"RE-DERIVABLE  {n_derivable:5d} files  {derivable/GB:6.2f} GB   magnet, refetch from source")
    print(f"LOCAL-ONLY    {n_local:5d} files  {local/GB:6.2f} GB   must transfer peer to peer")
    print(f"COVERS        {n_covers:5d} files  {covers/GB:6.2f} GB   no source; structural, sent first")
    print(f"THUMBS                     {thumbs/GB:6.2f} GB   regenerate locally")
    print(f"UNACCOUNTED                {(total-thumbs-derivable-local)/GB:6.2f} GB   gallery, extracted, orphans")
    print(f"DISK TOTAL                 {total/GB:6.2f} GB   (excludes covers, which live in data/)")
    print(f"DATABASE                   {db_size/GB:6.4f} GB   the actual sync")
    print()
    if total:
        print(f"must cross the wire: {must_cross/GB:.2f} GB "
              f"({must_cross/(total + covers)*100:.1f}% of everything)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
