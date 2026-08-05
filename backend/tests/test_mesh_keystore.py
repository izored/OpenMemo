"""Mesh key material lives in an OS store, not in a settings file.

The root secret every Mesh key derives from used to sit in app_settings.json as
plain hex — and for a while `GET /api/settings` served it. Encryption at rest
only counts if it covers the whole secret, so the 12 words go with it: either
one reconstructs the Mesh.
"""
import pytest

from backend.core.mesh import keystore, pairing, secret


@pytest.fixture(autouse=True)
def clean():
    keystore.delete(secret.SECRET_KEY)
    keystore.delete(pairing._WORDS_KEY)
    yield
    keystore.delete(secret.SECRET_KEY)
    keystore.delete(pairing._WORDS_KEY)


def _settings_raw() -> dict:
    from backend.core.app_settings import _read

    return _read()


def test_a_secret_round_trips():
    assert keystore.put("probe", "hello") is True
    assert keystore.get("probe") == "hello"
    keystore.delete("probe")
    assert keystore.get("probe") is None


def test_the_backend_is_named_honestly():
    """Linux gets a file. Saying "keychain" everywhere would be the theatre this
    replaced."""
    assert keystore.backend() in ("keychain", "dpapi", "file")
    assert keystore.describe()


def test_a_new_root_never_touches_the_settings_file():
    from backend.core.app_settings import _LOCK, _read, _write_raw

    with _LOCK:
        current = _read()
        current.pop(secret.SECRET_KEY, None)
        _write_raw(current)

    root = secret.get_or_create_root()

    assert len(root) == 32
    assert secret.SECRET_KEY not in _settings_raw()
    assert keystore.get(secret.SECRET_KEY) == root.hex()


def test_a_legacy_plaintext_root_is_moved_and_removed():
    """A migration that copies without deleting leaves the exposure it was
    written to remove."""
    from backend.core.app_settings import _LOCK, _read, _write_raw

    legacy = "ab" * 32
    keystore.delete(secret.SECRET_KEY)
    with _LOCK:
        current = _read()
        current[secret.SECRET_KEY] = legacy
        _write_raw(current)

    root = secret.get_or_create_root()

    assert root.hex() == legacy                       # same Mesh, not a new one
    assert secret.SECRET_KEY not in _settings_raw()   # and gone from the file
    assert keystore.get(secret.SECRET_KEY) == legacy


def test_joining_a_mesh_clears_any_old_plaintext_root():
    from backend.core.app_settings import _LOCK, _read, _write_raw

    with _LOCK:
        current = _read()
        current[secret.SECRET_KEY] = "cd" * 32
        _write_raw(current)

    secret.set_root(bytes.fromhex("ef" * 32))

    assert secret.SECRET_KEY not in _settings_raw()
    assert keystore.get(secret.SECRET_KEY) == "ef" * 32


def test_the_words_go_to_the_keystore_too(monkeypatch):
    monkeypatch.setattr(pairing, "_keychain_set", lambda _v: False)
    monkeypatch.setattr(pairing, "_keychain_get", lambda: None)

    code = pairing.generate_code()
    pairing.store_code(code)

    assert pairing.reveal_code() == code
    assert pairing._WORDS_KEY not in _settings_raw()


def test_legacy_plaintext_words_are_moved_and_removed(monkeypatch):
    from backend.core.app_settings import _LOCK, _read, _write_raw

    monkeypatch.setattr(pairing, "_keychain_get", lambda: None)
    code = pairing.generate_code()
    keystore.delete(pairing._WORDS_KEY)
    with _LOCK:
        current = _read()
        current[pairing._WORDS_KEY] = code
        _write_raw(current)

    assert pairing.reveal_code() == code
    assert pairing._WORDS_KEY not in _settings_raw()
    assert keystore.get(pairing._WORDS_KEY) == code
