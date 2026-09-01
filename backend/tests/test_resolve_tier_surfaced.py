"""`resolve_tier` has to reach the API, or the ladder is invisible again.

The column exists because a tier ladder degrades silently: every tier returns a
memo, so a lapsed session looks exactly like success until you notice reels
arriving as stills. The resolvers set it, `repull_memo_task` persists it, and
`/api/settings/instagram/health` reads the column straight out of SQL.

What none of that covers is the memo itself. Both memo routes hand-build their
response dict, so a column that nobody typed into those two literals is simply
absent from every read - persisted, correct, and unreadable. A Threads carousel
re-pulled to `threads:browser-scope` came back with no tier at all, which reads
as "never resolved" rather than "resolved well".
"""
import uuid
from datetime import datetime

from fastapi.testclient import TestClient
import pytest

from backend.core.threads import THREADS_TIER_SCOPED
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


async def _memo_on_tier(tier: str, title: str) -> str:
    memo_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        db.add(Memo(
            id=memo_id,
            workspace_id="default",
            type="image",
            title=title,
            source_url="https://www.threads.com/share/BAW0Di4fps/",
            resolve_tier=tier,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ))
        await db.commit()
    return memo_id


async def test_the_detail_route_reports_the_tier(client):
    memo_id = await _memo_on_tier(THREADS_TIER_SCOPED, "ztier detail")

    body = client.get(f"/api/memos/{memo_id}").json()
    assert body["resolve_tier"] == THREADS_TIER_SCOPED


async def test_the_list_route_reports_the_tier(client):
    """The list query uses `load_only`, so the column needs naming twice: once
    to be fetched and once to be serialized. Missing either one reads as null."""
    await _memo_on_tier(THREADS_TIER_SCOPED, "ztierlist carousel")

    items = client.get("/api/memos", params={"search": "ztierlist"}).json()["items"]
    assert [m["resolve_tier"] for m in items] == [THREADS_TIER_SCOPED]


async def test_a_memo_that_was_never_resolved_reports_null(client):
    """Null has to keep meaning "no tier recorded". If an unresolved memo and a
    fallback save both read as null, the health surface cannot tell them apart."""
    memo_id = await _memo_on_tier(None, "ztier untagged")

    assert client.get(f"/api/memos/{memo_id}").json()["resolve_tier"] is None
