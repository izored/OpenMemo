"""FTS5 escaper wiring (plans/001).

search_fts5 used to call an undefined `escape_fts5_query`, so every FTS5
search raised NameError and hybrid search silently fell back to ILIKE.
"""
from backend.db import fts5
from backend.core.security import escape_fts5_query


def test_search_fts5_uses_the_imported_escaper():
    # Regression: fts5.search_fts5 referenced an undefined `escape_fts5_query`.
    # The name must now resolve to the canonical escaper.
    assert fts5.escape_fts5_query is escape_fts5_query


def test_escaper_wraps_terms_and_strips_control_chars():
    assert escape_fts5_query("hello world") == '"hello" "world"'
    assert escape_fts5_query("") == ""
    # FTS5 control characters must not leak through into a MATCH expression.
    out = escape_fts5_query('foo* "bar"')
    assert "*" not in out
