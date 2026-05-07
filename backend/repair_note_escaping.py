"""One-shot repair: undo MDXEditor escape accumulation in note content.

The pre-fix MarkdownEditor saved on every blur even when the user did not edit
anything. MDXEditor's `getMarkdown()` re-serialized the parsed content, which
escaped special characters (`\\*`, `\\#`, `\\-`, `\\|`, `\\\\`), encoded spaces
as `&#x20;`, and prefixed already-rendered headings with another `# `. After a
few visits the markdown became unreadable.

This script scans every memo's `content_text` and `content_raw` and applies
the inverse transforms. Idempotent: running it twice on already-clean content
is a no-op.

Run from project root:
    python -m backend.repair_note_escaping
    python -m backend.repair_note_escaping --dry-run
"""

import argparse
import asyncio
import re
import sys

from sqlalchemy import select

from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo


# Order matters. Apply the heading-double-prefix collapse last so we don't
# mistakenly merge `\#` (escaped hash) into a heading.
_TRANSFORMS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"&#x20;"), " "),
    (re.compile(r"&#xA;"), "\n"),
    (re.compile(r"\\\*"), "*"),
    (re.compile(r"\\#"), "#"),
    (re.compile(r"\\-"), "-"),
    (re.compile(r"\\\|"), "|"),
    (re.compile(r"\\_"), "_"),
    (re.compile(r"\\>"), ">"),
    (re.compile(r"\\\["), "["),
    (re.compile(r"\\\]"), "]"),
    (re.compile(r"\\`"), "`"),
    (re.compile(r"\\!"), "!"),
    (re.compile(r"^(#{1,6}) (#{1,6}) ", re.MULTILINE), r"\2 "),
]


def repair(text: str) -> str:
    if not text:
        return text
    out = text
    for pat, repl in _TRANSFORMS:
        out = pat.sub(repl, out)
    return out


async def main(dry_run: bool) -> int:
    fixed = 0
    skipped = 0
    async with AsyncSessionLocal() as session:
        # Only notes are edited via MarkdownEditor — articles, documents, etc. may
        # carry legitimate `\*`, `\[`, `\\` inside embedded JSON or code samples.
        result = await session.execute(select(Memo).where(Memo.type == "note"))
        memos = result.scalars().all()
        for m in memos:
            new_text = repair(m.content_text or "")
            new_raw = repair(m.content_raw or "")
            text_changed = new_text != (m.content_text or "")
            raw_changed = new_raw != (m.content_raw or "")
            if not text_changed and not raw_changed:
                skipped += 1
                continue
            print(f"  fix {m.id} | type={m.type} | title={m.title!r}")
            if not dry_run:
                if text_changed:
                    m.content_text = new_text
                if raw_changed:
                    m.content_raw = new_raw
            fixed += 1
        if not dry_run:
            await session.commit()
    print(f"\n{'DRY-RUN ' if dry_run else ''}done — repaired {fixed}, untouched {skipped}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.dry_run)))
