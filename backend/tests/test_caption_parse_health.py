"""Notice the day openMemo stops being able to read an Instagram caption.

Today's reader depends on Instagram writing its page title as

    Author on Instagram: "the caption"

Meta changes that kind of thing without saying so. When it does, every save
loses its words, the memo is filed under "@someone", and nothing anywhere
raises a hand — which is precisely how the last silent Instagram failure ran
for six weeks.

The trap is that a post with no caption produces the same memo. So the signal
cannot be "how many memos have no words": in a real library about one post in
twelve genuinely has none, measured 2026-09-09 at 21 of 244 on the best tier.

What separates them is the author. If the page named one, the post was visible
and readable; a caption pattern that then matches nothing has stopped matching.
"""
import pytest

from backend.core import extractor
from backend.core.extractor import _instagram_text_from_og, caption_parse_health

CAPTION = "Never thought I would be a capri girl"
GOOD_TITLE = f'Anna Louise Gille on Instagram: "{CAPTION}"'
GOOD_DESC = f'3,416 likes, 79 comments - annalouisegille on August 21, 2026: "{CAPTION}". '

# The same post if Meta reworded its tags. Each of these was checked against
# the live pattern on 2026-09-09 and yields an empty caption.
REWORDED = [
    pytest.param(f'Anna Louise Gille on Instagram: "{CAPTION}" | Instagram', id="suffix"),
    pytest.param(f'Anna Louise Gille on Instagram "{CAPTION}"', id="no-colon"),
    pytest.param(f"Anna Louise Gille on Instagram: {CAPTION}", id="no-quotes"),
    pytest.param(f'Anna Louise Gille on Instagram: "{CAPTION}…', id="ellipsis"),
]


@pytest.fixture(autouse=True)
def clean_counter():
    extractor._IG_CAPTION_READS.clear()
    yield
    extractor._IG_CAPTION_READS.clear()


class TestTheSignal:
    def test_a_caption_that_reads_is_not_a_failure(self):
        got = _instagram_text_from_og(GOOD_TITLE, GOOD_DESC)
        assert got["caption"] == CAPTION
        assert got["parse_failed"] is False

    @pytest.mark.parametrize("title", REWORDED)
    def test_a_rewording_is_reported_rather_than_swallowed(self, title):
        got = _instagram_text_from_og(title, "")
        assert got["caption"] == ""
        assert got["username"], "the author is still readable, which is the point"
        assert got["parse_failed"] is True

    def test_a_post_that_simply_has_no_caption_is_not_a_failure(self):
        # Instagram's own wording for a captionless post: an author, no quotes,
        # and nothing to read. About one post in twelve. Must never count.
        got = _instagram_text_from_og("", "3 likes, 0 comments - someone on May 1, 2026")
        assert got["caption"] == ""
        assert got["username"] == "someone"
        assert got["parse_failed"] is False

    def test_a_page_that_named_nobody_is_not_a_failure_either(self):
        # A login wall or a dead post. We could not read the page at all, which
        # is a different problem with its own tier.
        assert _instagram_text_from_og("", "")["parse_failed"] is False
        assert _instagram_text_from_og("Instagram", "")["parse_failed"] is False


class TestTheCounter:
    def test_it_stays_quiet_on_a_healthy_run(self):
        for _ in range(10):
            _instagram_text_from_og(GOOD_TITLE, GOOD_DESC)
        health = caption_parse_health()
        assert health["checked"] == 10 and health["failed"] == 0
        assert health["broken"] is False

    def test_it_calls_it_broken_once_every_read_fails(self):
        for _ in range(6):
            _instagram_text_from_og(f'Someone on Instagram: {CAPTION}', "")
        health = caption_parse_health()
        assert health["failed"] == health["checked"] == 6
        assert health["broken"] is True

    def test_one_odd_post_is_not_a_platform_change(self):
        for _ in range(9):
            _instagram_text_from_og(GOOD_TITLE, GOOD_DESC)
        _instagram_text_from_og("Someone on Instagram: no quotes here", "")
        assert caption_parse_health()["broken"] is False

    def test_too_few_reads_to_judge_says_nothing(self):
        for _ in range(3):
            _instagram_text_from_og("Someone on Instagram: no quotes here", "")
        health = caption_parse_health()
        assert health["failed"] == 3
        assert health["broken"] is False, "three saves is not evidence of anything"

    def test_captionless_posts_never_dilute_or_trip_it(self):
        for _ in range(20):
            _instagram_text_from_og("", "3 likes - someone on May 1, 2026")
        assert caption_parse_health()["checked"] == 0

    def test_it_forgets_the_distant_past(self):
        for _ in range(30):
            _instagram_text_from_og(GOOD_TITLE, GOOD_DESC)
        assert caption_parse_health()["checked"] == extractor._IG_CAPTION_WINDOW
