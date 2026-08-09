# Carousel from pasted links

Bundle several image links into **one** memo you swipe through, instead of one
memo per link.

Dropping a folder of files already makes a set (see
[ADR-023](ADR-023-DRAG-DROP.md)). This covers the other way pictures get
collected: one at a time, across different sites, where there is no file on disk
to drag. The links are the input.

---

## Using it

1. Open **New Memo → Link**.
2. Paste your links into the URL box, **one per line**. It is a textarea, so a
   multi-line paste stays readable instead of collapsing onto one line.
3. As soon as there is more than one link, the panel asks the only question that
   matters:

   | Choice | Result |
   |---|---|
   | **One carousel memo** (default) | A single `image` memo whose `gallery` holds every picture, in paste order |
   | **Separate memos** | One memo per link, saved the normal way (honours "don't pull") |

4. Save. The carousel branch lands you on the new memo.

`Enter` saves. `Shift+Enter` adds a line.

---

## What the backend does

**`POST /api/ingest/gallery`**

```jsonc
{
  "urls": ["https://…/a.jpg", "https://…/b.png"],
  "title": "Kitchen references",   // optional; defaults to "N images"
  "collection_id": "…",            // optional
  "workspace_id": "…"              // optional
}
```

Returns `{ id, title, type, status, slides, failed }`.

### Resolving one link to one picture

`_resolve_slide()` in `backend/api/ingest.py`, cheapest first:

1. **The URL is the file** — the path ends in `.jpg/.png/.webp/.gif/.avif/.bmp/.svg`.
   No network call at all.
2. **The URL serves an image** — no extension, but the response `Content-Type`
   is `image/*`. A `HEAD` first; CDNs that refuse `HEAD` get a streamed `GET`
   whose headers are read before any bytes are.
3. **The URL is a page about one** — resolved through the normal extractor
   ladder, which is what makes an Instagram, Pinterest, or article link work
   here too. A link that resolves to its *own* carousel contributes only its
   first slide: one memo, one flat list, no nesting.

A `.mp4`/`.mov`/`.webm` link becomes a `video` slide rather than a broken
picture.

### Rules

- **Paste order is carousel order.** The sequence is the user's editing.
- **Duplicates collapse.** The same link twice is one slide.
- **Dead links are named, not swallowed.** They come back in `failed`, and the
  panel puts them back in the box so you can see which one it was. One bad URL
  in a paste of eight never costs the other seven. All links failing is a `400`,
  not an empty memo.
- **One surviving slide is not a carousel.** `gallery` stays empty so the memo
  renders as the plain image it is, with no paging controls.
- **Ceiling of `MAX_GALLERY_SLIDES` (40).** An accidental paste of a hundred
  links is refused, not obeyed — every slide is downloaded and stored.

### After the save

`cache_gallery` downloads every slide into `files/thumbs/` and rewrites each
`gallery[i].url` to the local path, with slide 0 also becoming
`thumbnail_path`. That is the point of bundling here rather than keeping a list
of URLs: the memo survives the sources going away, and image CDN links
(Instagram's especially) are signed and expire.

The original links stay in `content_text`, so the memo still remembers where
each picture came from once the slides are local.

> **Note:** `cache_gallery` is registered in `core/job_handlers.py` as its own
> job kind (`KIND_GALLERY`), separate from `KIND_THUMBNAIL`. Both run for the
> same memo and the queue dedupes on `(kind, memo_id)`, so sharing one kind
> would silently drop the gallery pass.

---

## Rendering

Nothing new. A `gallery` of more than one item is the existing carousel shape
(Instagram sidecars have used it since the multi-image resolver landed), so
`MemoDetail` and `Lightbox` page through it with no extra work, and the
dashboard card shows slide 0 as the cover.
