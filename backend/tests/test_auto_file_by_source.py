"""A memo files itself into the collection its source belongs to.

Nine temu.com memos sat in no collection at all, on a dashboard the Temu
collection had deliberately been hidden from. Saving from a shop you use often
should not mean tidying up afterwards.

The rules are the user's: a list of {domain, collection_id} edited in Settings.
Collections are referenced by ID rather than name, so renaming one does not
quietly break the rule pointing at it, and a rule whose collection was deleted
is shown as broken rather than silently doing nothing.
"""
import pytest

from backend.api.ingest import auto_file_collection_id, normalize_rule_domain
from backend.api.settings import _clean_auto_file_rules


class _Memo:
    def __init__(self, domain=None, url=None):
        self.source_domain = domain
        self.source_url = url


@pytest.fixture
def rules(monkeypatch):
    """Point the lookup at a rule set without touching the real settings file."""
    state = {"auto_file_by_source": True, "auto_file_rules": []}

    def fake():
        return state

    monkeypatch.setattr("backend.core.app_settings.get_settings", fake)
    return state


# ------------------------------------------------- what the domain matches


@pytest.mark.parametrize(
    "domain,expected",
    [
        ("temu.com", "coll-temu"),
        ("www.temu.com", "coll-temu"),      # www is not a subdomain anyone means
        ("TEMU.COM", "coll-temu"),
        ("temu.com:443", "coll-temu"),
        ("us.temu.com", None),              # a subdomain is somebody else's to hand out
        ("shop.temu.com", None),
        ("faketemu.com", None),
        ("temu.com.co", None),
        # Any stranger can register evil.io and point this at anything they
        # like. A rule matching on "contains" or "ends with" would file their
        # page into the user's collection, so the host has to BE the site.
        ("temu.com.evil.io", None),
        ("youtube.com", None),
        ("", None),
        (None, None),
    ],
)
def test_the_host_has_to_be_the_site(rules, domain, expected):
    rules["auto_file_rules"] = [{"domain": "temu.com", "collection_id": "coll-temu"}]
    assert auto_file_collection_id(_Memo(domain)) == expected


def test_the_url_answers_when_the_domain_column_is_empty(rules):
    rules["auto_file_rules"] = [{"domain": "temu.com", "collection_id": "coll-temu"}]
    assert auto_file_collection_id(_Memo("", "https://www.temu.com/x?y=1")) == "coll-temu"


def test_no_rules_means_nothing_is_filed(rules):
    assert auto_file_collection_id(_Memo("temu.com")) is None


def test_the_master_switch_turns_every_rule_off(rules):
    rules["auto_file_rules"] = [{"domain": "temu.com", "collection_id": "coll-temu"}]
    rules["auto_file_by_source"] = False
    assert auto_file_collection_id(_Memo("temu.com")) is None


def test_a_malformed_rule_is_stepped_over_rather_than_raising(rules):
    """The list is user-editable and reaches here straight from JSON."""
    rules["auto_file_rules"] = [
        "not a dict",
        {"domain": None},
        {"collection_id": "orphan"},
        {"domain": "temu.com", "collection_id": "coll-temu"},
    ]
    assert auto_file_collection_id(_Memo("temu.com")) == "coll-temu"


# --------------------------------------------- what the user is allowed to type


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("https://www.example.com/product/123?x=1", "example.com"),
        ("example.com/path", "example.com"),
        ("  EXAMPLE.COM  ", "example.com"),
        ("http://user:pw@shop.example.com:8443/x", "shop.example.com"),
        ("a.co", "a.co"),
        ("not a domain", None),
        ("localhost", None),          # no dot, so it cannot be a site rule
        ("example..com", None),
        ("", None),
    ],
)
def test_a_pasted_link_becomes_the_host_it_will_match(raw, expected):
    """People paste what they have, which is a whole product URL. Accepting only
    a bare hostname would mean a rule that silently never fires."""
    assert normalize_rule_domain(raw) == expected


# ------------------------------------------------- what gets stored


def test_rules_are_normalized_and_de_duplicated_before_they_are_stored():
    """Normalized on the way IN, so the row shown in Settings is exactly the
    host that will be matched later. First rule for a domain wins."""
    cleaned = _clean_auto_file_rules([
        {"domain": "https://www.temu.com/x", "collection_id": "c1"},
        {"domain": "temu.com", "collection_id": "c2"},      # duplicate, dropped
        {"domain": "bad domain", "collection_id": "c3"},    # unusable, dropped
        {"domain": "example.com", "collection_id": ""},     # no collection, dropped
        {"domain": "example.com", "collection_id": "c4"},
        "junk",
    ])
    assert cleaned == [
        {"domain": "temu.com", "collection_id": "c1"},
        {"domain": "example.com", "collection_id": "c4"},
    ]


def test_an_empty_rule_list_is_kept_as_empty():
    """None means "never configured" and reseeds; [] means the user cleared it
    and must be left alone. Reseeding what somebody deleted would be rude."""
    assert _clean_auto_file_rules([]) == []


def test_the_default_is_unconfigured_rather_than_empty():
    from backend.core.app_settings import _DEFAULTS

    assert _DEFAULTS["auto_file_rules"] is None
    assert _DEFAULTS["auto_file_by_source"] is True


# ------------------------------------------------- and what it never does


def test_an_explicit_choice_is_never_overruled():
    """The rule only runs when no collection was asked for. A chosen collection
    is an instruction, and an id that does not resolve is a mistake worth
    leaving visible rather than papering over with a guess."""
    import inspect

    from backend.api import ingest

    src = inspect.getsource(ingest._attach_collection)
    assert "if collection_id:" in src
    assert src.index("if collection_id:") < src.index("auto_file_collection_id")
