"""Preloaded hero images (OPNMMO-0055).

A client-rendered storefront sets og:title and og:description but no og:image,
so every product saved from one came back as a bare card. The picture is in the
plain-fetch HTML all along, as the LCP image the page preloads:

    <link rel="preload" as="image" fetchpriority="high" href="https://cdn/...">

No browser needed, and on the CDN that serves it there is no challenge. Temu
found this; the rule is host-agnostic on purpose.
"""
from bs4 import BeautifulSoup

from backend.core.extractor import _pick_image, _preload_image, _url_width_hint


def soup(body: str) -> BeautifulSoup:
    return BeautifulSoup(f"<html><head>{body}</head><body></body></html>", "html.parser")


def test_a_preloaded_hero_is_found():
    s = soup('<link rel="preload" as="image" fetchpriority="high" href="https://cdn/x.jpg">')
    assert _preload_image(s) == "https://cdn/x.jpg"


def test_only_image_preloads_count():
    s = soup(
        '<link rel="preload" as="font" href="https://cdn/f.woff2">'
        '<link rel="preload" as="script" href="https://cdn/a.js">'
        '<link rel="preload" as="style" href="https://cdn/a.css">'
    )
    assert _preload_image(s) == ""


def test_prefetch_and_stylesheet_links_are_not_preloads():
    s = soup(
        '<link rel="prefetch" as="image" href="https://cdn/later.jpg">'
        '<link rel="stylesheet" href="https://cdn/a.css">'
    )
    assert _preload_image(s) == ""


def test_high_fetch_priority_wins_over_a_wider_low_priority_one():
    """The page's own ranking beats ours. fetchpriority=high IS the hero."""
    s = soup(
        '<link rel="preload" as="image" href="https://cdn/banner.jpg?w=2000">'
        '<link rel="preload" as="image" fetchpriority="high" href="https://cdn/hero.jpg?w=800">'
    )
    assert _preload_image(s) == "https://cdn/hero.jpg?w=800"


def test_the_widest_variant_wins_within_one_priority():
    # Exactly the Temu shape: the same photo preloaded at two widths.
    s = soup(
        '<link rel="preload" as="image" fetchpriority="high"'
        ' href="https://img.kwcdn.com/product/open/abc-goods.jpeg?imageView2/2/w/500/q/70/format/webp">'
        '<link rel="preload" as="image" fetchpriority="high"'
        ' href="https://img.kwcdn.com/product/open/abc-goods.jpeg?imageView2/2/w/1300/q/90/format/webp">'
    )
    assert "w/1300" in _preload_image(s)


def test_a_data_uri_placeholder_is_skipped():
    s = soup(
        '<link rel="preload" as="image" href="data:image/gif;base64,R0lGOD">'
        '<link rel="preload" as="image" href="https://cdn/real.jpg">'
    )
    assert _preload_image(s) == "https://cdn/real.jpg"


def test_og_image_still_wins_when_the_page_publishes_one():
    """This is a fallback, not a promotion. A page that says which image it
    wants previewed must keep getting that one."""
    s = soup(
        '<meta property="og:image" content="https://cdn/declared.jpg">'
        '<link rel="preload" as="image" fetchpriority="high" href="https://cdn/hero.jpg">'
    )
    assert _pick_image(s, [], "https://example.com/") == "https://cdn/declared.jpg"


def test_the_preload_fills_in_when_there_is_no_og_image():
    s = soup(
        '<meta property="og:title" content="A product">'
        '<link rel="preload" as="image" fetchpriority="high" href="https://cdn/hero.jpg">'
    )
    assert _pick_image(s, [], "https://example.com/") == "https://cdn/hero.jpg"


def test_a_relative_preload_is_resolved_against_the_page():
    s = soup('<link rel="preload" as="image" href="/img/hero.jpg">')
    assert _pick_image(s, [], "https://shop.example.com/p/9") == "https://shop.example.com/img/hero.jpg"


def test_a_page_with_no_preload_is_unchanged():
    assert _preload_image(soup("<title>Nothing here</title>")) == ""


class TestWidthHint:
    """Only used to rank variants of one picture, so a miss costs a smaller
    thumbnail, never a wrong image. It must not invent widths."""

    def test_path_segment_width(self):
        assert _url_width_hint("https://cdn/x.jpg?imageView2/2/w/1300/q/90") == 1300

    def test_query_width(self):
        assert _url_width_hint("https://cdn/i.jpg?width=2048&q=80") == 2048

    def test_dimension_pair(self):
        assert _url_width_hint("https://cdn/a_1600x1600.jpg") == 1600

    def test_an_id_in_the_path_is_not_a_width(self):
        assert _url_width_hint("https://cdn/product/12345678/photo.jpg") == 0

    def test_absurd_numbers_are_ignored(self):
        assert _url_width_hint("https://cdn/i.jpg?width=99999") == 0
        assert _url_width_hint("https://cdn/i.jpg?w=4") == 0

    def test_no_width_at_all(self):
        assert _url_width_hint("https://cdn/photo.jpg") == 0
