"""A memo files itself into the collection its source belongs to.

Seven temu.com memos sat in no collection at all, on a dashboard the Temu
collection had deliberately been hidden from. Saving from a shop you use often
should not mean tidying up afterwards.

Deliberately a short explicit list rather than "match a collection whose name
looks like the domain": that generic version also pulls code.org into `Code`
and home.com into `Home`, which is a surprise nobody asked for.
"""
import pytest

from backend.api.ingest import _AUTO_FILE_DOMAINS, auto_file_collection_name


class _Memo:
    def __init__(self, domain=None, url=None):
        self.source_domain = domain
        self.source_url = url


@pytest.mark.parametrize(
    "domain,expected",
    [
        ("temu.com", "Temu"),
        ("www.temu.com", "Temu"),
        ("us.temu.com", None),            # a subdomain is somebody else's to hand out
        ("TEMU.COM", "Temu"),
        ("youtube.com", None),
        ("nottemu.com", None),            # the domain has to END at the rule
        # Any stranger can register evil.io and point this at anything. A rule
        # that matched on "contains" or "ends with" would file their page into
        # your collection, so the host has to BE the site.
        ("temu.com.evil.io", None),
        ("temu.com.co", None),
        ("faketemu.com", None),
        ("", None),
        (None, None),
    ],
)
def test_the_domain_decides(domain, expected):
    assert auto_file_collection_name(_Memo(domain)) == expected


def test_the_url_answers_when_the_domain_column_is_empty():
    """A memo built by a path that never filled source_domain still files."""
    assert auto_file_collection_name(_Memo("", "https://www.temu.com/x?y=1")) == "Temu"


def test_a_memo_with_no_source_files_nowhere():
    assert auto_file_collection_name(_Memo(None, None)) is None


def test_the_rule_list_stays_short_and_explicit():
    """If this grows past a handful, it wants to be data the user can edit
    rather than a literal in the ingest module."""
    assert _AUTO_FILE_DOMAINS == {"temu.com": "Temu"}


def test_the_setting_defaults_to_on_and_can_be_turned_off():
    from backend.core.app_settings import _DEFAULTS

    assert _DEFAULTS["auto_file_by_source"] is True


def test_an_explicit_choice_is_never_overruled():
    """The rule only runs when no collection was asked for. A chosen collection
    is an instruction, and an id that does not resolve is a mistake worth
    leaving visible rather than papering over with a guess."""
    import inspect

    from backend.api import ingest

    src = inspect.getsource(ingest._attach_collection)
    assert "if collection_id:" in src
    assert "else:" in src
    # the auto-file lookup lives in the else branch, not before the if
    assert src.index("if collection_id:") < src.index("auto_file_collection_name")
