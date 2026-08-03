"""Every place that states openMemo's version must agree.

The version lives in six files. Nothing checked that they matched, and
`macOS/package-lock.json` had been stale since 2.2.0 — eight releases of drift
that no test, build or release step noticed. A mismatch is not cosmetic: the
app's footer, the extension's store listing, the macOS About panel and the
README badge are what a user reads to know what they are running, and
`release.yml` publishes notes for whatever `docs/CHANGELOG.md` says is newest.

This is the contract. If you add a new place that names the version, add it
here too, so the next drift fails a pull request instead of shipping.
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def _backend_version() -> str:
    text = (ROOT / "backend" / "config.py").read_text(encoding="utf-8")
    m = re.search(r'VERSION: str = "(\d+\.\d+\.\d+)"', text)
    assert m, "backend/config.py has no parsable VERSION"
    return m.group(1)


def _json_version(rel: str) -> str:
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))["version"]


def _readme_badge() -> str:
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    m = re.search(r"version-(\d+\.\d+\.\d+)", text)
    assert m, "README.md has no version badge"
    return m.group(1)


def _changelog_latest() -> str:
    text = (ROOT / "docs" / "CHANGELOG.md").read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("## ["):
            m = re.match(r"^## \[(\d+\.\d+\.\d+)\]", line)
            if m:
                return m.group(1)
            # An "## [Unreleased]" heading above the newest release is fine —
            # that is where in-flight work is written down. Keep looking.
            continue
    pytest.fail("docs/CHANGELOG.md has no released version heading")


def test_backend_version_is_semver():
    assert SEMVER.match(_backend_version())


def test_every_file_states_the_same_version():
    backend = _backend_version()
    stated = {
        "backend/config.py": backend,
        "chrome-extension/manifest.json": _json_version("chrome-extension/manifest.json"),
        "macOS/package.json": _json_version("macOS/package.json"),
        # The lockfile's ROOT version, the one npm keeps in step with
        # package.json. Nested dependency versions are theirs, not ours.
        "macOS/package-lock.json": _json_version("macOS/package-lock.json"),
        "README.md badge": _readme_badge(),
        "docs/CHANGELOG.md": _changelog_latest(),
    }
    wrong = {k: v for k, v in stated.items() if v != backend}
    assert not wrong, (
        f"version drift — backend/config.py says {backend}, but: {wrong}. "
        f"bump-version.ps1 updates every one of these; if you added a new "
        f"place that names the version, add it to this test too."
    )


def test_lockfile_root_package_matches_its_manifest():
    # npm stores the root version twice: top level and under packages[""].
    lock = json.loads((ROOT / "macOS" / "package-lock.json").read_text(encoding="utf-8"))
    root_pkg = (lock.get("packages") or {}).get("")
    assert root_pkg, "macOS/package-lock.json has no root package entry"
    assert root_pkg.get("version") == lock["version"], (
        "macOS/package-lock.json disagrees with itself: the top-level version "
        "and packages[''].version must both track package.json"
    )


def _key(v: str) -> tuple:
    return tuple(int(p) for p in v.split("."))


def _changelog_versions() -> list[str]:
    text = (ROOT / "docs" / "CHANGELOG.md").read_text(encoding="utf-8")
    return re.findall(r"^## \[(\d+\.\d+\.\d+)\]", text, re.M)


def test_no_changelog_heading_appears_twice():
    # The bug this catches: an edit that REPLACES a version heading instead of
    # inserting above it merges two releases into one section, and release.yml
    # then publishes the wrong notes for a tag. It happened on 2026-08-03 —
    # adding an Unreleased section ate the 3.3.0 heading, and the mistake was
    # invisible until someone read the file.
    versions = _changelog_versions()
    assert versions, "no released version headings in the changelog"
    dupes = sorted({v for v in versions if versions.count(v) > 1})
    assert not dupes, f"duplicate changelog headings: {dupes}"


def test_the_newest_release_is_at_the_top():
    # Deliberately not a full ordering assertion: the 1.8.x block from May is
    # genuinely out of order in the file's history, and rewriting it would be
    # noise. What matters is that the section a reader (and a release) sees
    # first really is the newest one.
    versions = _changelog_versions()
    assert versions[0] == max(versions, key=_key), (
        f"the top changelog section is {versions[0]}, but the highest version "
        f"present is {max(versions, key=_key)}"
    )
