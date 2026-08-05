"""A Mesh code you can read again.

A Mesh started on Windows could never show its code a second time: `reveal_code`
read the macOS keychain and nothing else, so the panel rendered blank and the
second device could not be paired at all. `_keychain_set` even carried a comment
promising Windows "falls through to the file store below" — there was no file
store.
"""
import platform

import pytest

from backend.core.mesh import pairing


@pytest.fixture(autouse=True)
def clean_words():
    pairing._local_clear()
    yield
    pairing._local_clear()


def test_a_minted_code_can_be_read_again(monkeypatch):
    """The whole point: you mint on one machine and type it on the other, which
    may be a day later and a room away."""
    monkeypatch.setattr(pairing, "_keychain_set", lambda _v: False)
    monkeypatch.setattr(pairing, "_keychain_get", lambda: None)

    code = pairing.generate_code()
    result = pairing.store_code(code)

    assert result["stored"] == "file"
    assert pairing.reveal_code() == code


def test_it_says_where_the_words_went(monkeypatch):
    """The UI cannot be honest about recoverability unless it is told."""
    monkeypatch.setattr(pairing, "_keychain_set", lambda _v: True)
    result = pairing.store_code(pairing.generate_code())
    assert result["stored"] == "keychain"
    assert result["in_keychain"] is True


def test_the_keychain_wins_when_there_is_one(monkeypatch):
    """No second copy in a plain file when the OS offers a real store."""
    monkeypatch.setattr(pairing, "_keychain_set", lambda _v: True)
    pairing.store_code(pairing.generate_code())
    assert pairing._local_get() is None


def test_a_joined_device_has_nothing_to_reveal(monkeypatch):
    """Joining stores the seed, which is one-way. Blank is correct there, and
    the UI has to tell that apart from a failure."""
    monkeypatch.setattr(pairing, "_keychain_get", lambda: None)
    assert pairing.reveal_code() is None


def test_the_stored_words_are_the_real_code(monkeypatch):
    """Round-trip through validate: a stored value that no longer checksums
    would hand the user a code the other device rejects."""
    monkeypatch.setattr(pairing, "_keychain_set", lambda _v: False)
    monkeypatch.setattr(pairing, "_keychain_get", lambda: None)

    code = pairing.generate_code()
    pairing.store_code(code)
    assert pairing.validate(pairing.reveal_code()) == code.split()


@pytest.mark.skipif(platform.system() == "Darwin", reason="macOS has a real keychain")
def test_off_macos_the_keychain_is_honest_about_being_unavailable():
    assert pairing._keychain_set("abandon " * 11 + "about") is False
    assert pairing._keychain_get() is None
