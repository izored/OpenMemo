// Pure helpers for the global drag-and-drop layer (ADR-023). No React, no
// store, no DOM side effects — just the decisions the FileDropLayer makes on a
// drop: what is being dragged, where does it land, and how is it routed.
//
// Two kinds of drag arrive here. A Finder/Explorer drag carries `Files`. A drag
// out of a BROWSER carries no file at all — dragging a link, an image or a
// selection hands over `text/uri-list`, `text/html` and `text/plain` strings
// instead. openMemo only ever looked for `Files`, so a drag from a web page
// fell through to the browser's own handler and navigated the app away from
// itself. Both shapes are first-class now (OPNMMO-0052).

import type { Collection } from '@/types';

// A drag carries OS files (as opposed to dnd-kit's internal card reorder, which
// is pointer-driven and carries no `Files` type). This one check is what keeps
// the veil from raising while a memo card is being dragged onto a collection.
export function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  // `types` is a DOMStringList in some browsers — normalize to a plain array.
  return Array.from(dt.types || []).includes('Files');
}

// Read the actual File objects off a drop's DataTransfer. Prefers `items`
// (filtered to kind === 'file') and falls back to `files` for older browsers.
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.items && dt.items.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
    if (out.length) return out;
  }
  return dt.files ? Array.from(dt.files) : [];
}

// A drag carries link/text payloads (a browser drag). `types` is all we can
// read during dragenter/dragover — the actual strings are unreadable until the
// drop event fires, by spec, so detection and extraction are separate steps.
export function dragHasText(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types || []);
  if (types.includes('Files')) return false; // a file drag, handled above
  return types.some((t) => t === 'text/uri-list' || t === 'text/html' || t === 'text/plain');
}

const _HTTP = /^https?:\/\//i;

// Everything that looks like an http(s) URL inside a blob of text, in order and
// deduped. Used for the plain-text fallback and for a multi-line selection.
function _urlsInText(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s<>"']+/)) {
    const cleaned = raw.replace(/[),.;]+$/, '');
    if (_HTTP.test(cleaned) && !out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

export interface DropPayload {
  // Links to ingest, most specific source first. Empty for a plain-text drag.
  urls: string[];
  // The dragged text when it is NOT a link (a selection out of an article).
  // Empty when the drag was a link/image.
  text: string;
  // True when the urls came from a dragged <img>, so the target is a picture
  // rather than a page. Drives the veil wording only.
  isImage: boolean;
}

// Read a browser drag's payload. Only valid inside the `drop` handler.
//
// Order matters. `text/uri-list` is the one type that means "this IS a link";
// `text/html` is the dragged node's markup (an <img> or an <a>), which is the
// only place a dragged image's real src survives on sites whose uri-list points
// at the wrapping page; `text/plain` is the last resort and is often the same
// URL again, or the selected prose.
export function payloadFromDataTransfer(dt: DataTransfer | null): DropPayload {
  const empty: DropPayload = { urls: [], text: '', isImage: false };
  if (!dt) return empty;

  const read = (type: string): string => {
    try {
      return dt.getData(type) || '';
    } catch {
      return '';
    }
  };

  const html = read('text/html');
  let isImage = false;
  const fromHtml: string[] = [];
  if (html) {
    // DOMParser, not a regex: a dragged node's markup is real HTML, and src
    // values routinely contain the quotes and entities a regex trips over.
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const img = doc.querySelector('img');
      const src = img?.getAttribute('src') || '';
      if (_HTTP.test(src)) {
        fromHtml.push(src);
        isImage = true;
      }
      for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
        const href = a.getAttribute('href') || '';
        if (_HTTP.test(href) && !fromHtml.includes(href)) fromHtml.push(href);
      }
    } catch {
      /* unparseable markup just means we fall through to the other types */
    }
  }

  const uriList = read('text/uri-list')
    .split(/\r?\n/)
    .map((l) => l.trim())
    // The uri-list format allows # comment lines.
    .filter((l) => l && !l.startsWith('#') && _HTTP.test(l));

  const plain = read('text/plain').trim();
  const fromPlain = _urlsInText(plain);

  // A dragged image wins: its <img src> is the picture itself, where uri-list
  // may only hold the page it sits on.
  const urls: string[] = [];
  for (const u of [...(isImage ? fromHtml : []), ...uriList, ...fromHtml, ...fromPlain]) {
    if (!urls.includes(u)) urls.push(u);
  }

  // Prose, not a link: the whole point of dragging a selection is to keep it.
  const text = urls.length === 0 && plain ? plain : '';
  return { urls, text, isImage };
}

// Filename-ish check on a URL, used to route several dropped image links into
// one carousel memo instead of one memo per link.
const _IMAGE_URL = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;

export function isAllImageUrls(urls: string[]): boolean {
  return urls.length > 0 && urls.every((u) => _IMAGE_URL.test(u));
}

export interface DropTarget {
  // 'instant' uploads straight to the resolved bucket; 'prefill' stages the
  // files into the New-Memo panel so the user picks a home first (ADR-023 §4).
  mode: 'instant' | 'prefill';
  // The bucket the files land in. 'music' routes audio through the album path.
  scope: 'collection' | 'space' | 'music' | 'library';
  collectionId?: string;
  workspaceId?: string;
  // Human label for the veil, e.g. "🗂️ Fitness" or "your library".
  label: string;
}

interface ResolveArgs {
  pathname: string;
  activeSpace: string | null;
  activeCollection: string | null;
  // The collections currently in scope (library or the open Space), used only
  // to name the target in the veil. Missing names degrade to a generic label.
  collections?: Pick<Collection, 'id' | 'name' | 'emoji'>[];
  spaceName?: string | null;
  spaceEmoji?: string | null;
}

// Tier-1 page-default targeting (ADR-023 §2). Reads where the user already is
// from the route + store and decides the bucket AND the commit mode. Clear
// buckets (a collection, a Space, the Music page) ingest instantly; ambiguous
// surfaces (bare library, lists, detail, ask) prefill the panel.
export function resolveDropTarget({
  pathname,
  activeSpace,
  activeCollection,
  collections = [],
  spaceName,
  spaceEmoji,
}: ResolveArgs): DropTarget {
  // Music page: audio goes through the album/playlist ingest. Instant.
  if (pathname.startsWith('/music')) {
    return { mode: 'instant', scope: 'music', workspaceId: activeSpace || undefined, label: 'your music' };
  }

  // Inside a collection (dashboard filter or a Space's collection view). Instant.
  if (activeCollection) {
    const c = collections.find((x) => x.id === activeCollection);
    const label = c ? `${c.emoji || '📁'} ${c.name}` : 'this collection';
    return {
      mode: 'instant',
      scope: 'collection',
      collectionId: activeCollection,
      workspaceId: activeSpace || undefined,
      label,
    };
  }

  // Inside a Space, no collection open. Instant into the Space.
  if (activeSpace) {
    const label = spaceName ? `${spaceEmoji || '🗂️'} ${spaceName}` : 'this Space';
    return { mode: 'instant', scope: 'space', workspaceId: activeSpace, label };
  }

  // Bare library / Spaces list / Collections list / memo detail / Ask — no
  // single bucket. Prefill the panel so the user chooses (ADR-023 §4).
  return { mode: 'prefill', scope: 'library', label: 'your library' };
}

// Type routing (ADR-023 §3): on the Music page a pure-audio drop becomes an
// auto-grouped album; everything else is one memo per file.
export function isAllAudio(files: File[]): boolean {
  return files.length > 0 && files.every((f) => f.type.startsWith('audio/'));
}
