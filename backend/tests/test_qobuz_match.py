"""Picking the RIGHT recording out of a Qobuz search.

The resolver looks a track up by ISRC first and falls back to a plain
"title artist" search when that misses. The fallback used to take Qobuz's first
result, which is how a karaoke backing track or a tribute-band cover gets
downloaded, tagged with the real artist's name, and filed in the library as the
genuine article — silently, because nothing about it fails.

These pin the scoring ported from SpotiFLAC's scoreQobuzSearchCandidate.
"""
import pytest

from backend.core.spotiflac import _normalize_match_value, _score_qobuz_candidate


def _track(title, artist, album=None, *, depth=16, rate=44.1, hires=False):
    return {
        "id": 1,
        "title": title,
        "performer": {"name": artist},
        "album": {"title": album or "An Album", "artist": {"name": artist}},
        "maximum_bit_depth": depth,
        "maximum_sampling_rate": rate,
        "hires": hires,
    }


def _best(items, title, artist, album=None):
    return max(items, key=lambda t: _score_qobuz_candidate(t, title, artist, album))


# --------------------------------------------------------------------------- #
#  Normalisation
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("raw,expected", [
    ("Tom & Jerry", "tom and jerry"),
    ("Song feat. Someone", "song someone"),
    ("Song ft. Someone", "song someone"),
    ("Hip-Hop_Track/Remix", "hip hop track remix"),
    ("  SPACED   OUT  ", "spaced out"),
])
def test_values_fold_to_comparable_words(raw, expected):
    assert _normalize_match_value(raw) == expected


def test_none_is_not_a_crash():
    assert _normalize_match_value(None) == ""


# --------------------------------------------------------------------------- #
#  The cases that were actually going wrong
# --------------------------------------------------------------------------- #
def test_a_karaoke_version_never_wins_even_when_qobuz_ranks_it_first():
    items = [
        _track("Blinding Lights (Karaoke Version)", "Karaoke Crew"),
        _track("Blinding Lights", "The Weeknd"),
    ]
    assert _best(items, "Blinding Lights", "The Weeknd")["performer"]["name"] == "The Weeknd"


def test_a_tribute_cover_never_wins():
    items = [
        _track("Yesterday (In the Style of The Beatles)", "Tribute Players"),
        _track("Yesterday", "The Beatles"),
    ]
    assert _best(items, "Yesterday", "The Beatles")["performer"]["name"] == "The Beatles"


def test_the_wrong_artist_is_rejected_hard():
    """The -2000 that does the real work: same title, unrelated artist."""
    right = _score_qobuz_candidate(_track("Hallelujah", "Jeff Buckley"), "Hallelujah", "Jeff Buckley", None)
    wrong = _score_qobuz_candidate(_track("Hallelujah", "Some Other Singer"), "Hallelujah", "Jeff Buckley", None)
    assert wrong < 0 < right


def test_a_shared_word_is_enough_for_a_multi_artist_credit():
    """Spotify says "Artist A, Artist B"; Qobuz says "Artist A". Same track —
    it must not fall into the wrong-artist penalty."""
    assert _score_qobuz_candidate(
        _track("Track", "Artist A"), "Track", "Artist A, Artist B", None
    ) > 0


def test_searching_for_a_karaoke_track_still_finds_one():
    """The keyword penalty only applies to words the query did not ask for."""
    items = [
        _track("Wonderwall", "Oasis"),
        _track("Wonderwall (Karaoke Version)", "Karaoke Crew"),
    ]
    best = _best(items, "Wonderwall (Karaoke Version)", "Karaoke Crew")
    assert "Karaoke" in best["title"]


# --------------------------------------------------------------------------- #
#  Ordering preferences
# --------------------------------------------------------------------------- #
def test_an_exact_title_beats_a_partial_one():
    items = [
        _track("Everlong (Acoustic Version)", "Foo Fighters"),
        _track("Everlong", "Foo Fighters"),
    ]
    assert _best(items, "Everlong", "Foo Fighters")["title"] == "Everlong"


def test_the_album_breaks_a_tie_when_we_know_it():
    """Apple gives us an album name; it should steer between two pressings."""
    items = [
        _track("Come Together", "The Beatles", "Greatest Hits"),
        _track("Come Together", "The Beatles", "Abbey Road"),
    ]
    assert _best(items, "Come Together", "The Beatles", "Abbey Road")["album"]["title"] == "Abbey Road"


def test_hi_res_wins_an_otherwise_exact_tie():
    items = [
        _track("Song", "Artist", depth=16, rate=44.1),
        _track("Song", "Artist", depth=24, rate=96.0),
    ]
    assert _best(items, "Song", "Artist")["maximum_bit_depth"] == 24


def test_a_missing_artist_does_not_penalise_anything():
    """No artist known = no opinion, not a rejection."""
    assert _score_qobuz_candidate(_track("Song", "Whoever"), "Song", None, None) > 0
