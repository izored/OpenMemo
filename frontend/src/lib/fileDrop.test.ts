// Drag-and-drop payload reading (OPNMMO-0052). The regression these cover: a
// drag out of a browser carries no File at all, only strings, and openMemo only
// ever looked for `Files` — so dropping a link from a web page did nothing.
import { describe, it, expect } from 'vitest';
import { dragHasFiles, dragHasText, isAllImageUrls, payloadFromDataTransfer, resolveDropTarget } from './fileDrop';

// Minimal DataTransfer stand-in: `types` plus a string map, which is all these
// helpers touch. jsdom's own DataTransfer cannot be populated from a test.
function dt(data: Record<string, string>, extraTypes: string[] = []): DataTransfer {
  return {
    types: [...Object.keys(data), ...extraTypes],
    getData: (t: string) => data[t] ?? '',
  } as unknown as DataTransfer;
}

describe('dragHasFiles / dragHasText', () => {
  it('reads a Finder drag as files, not text', () => {
    const d = dt({ 'text/plain': 'photo.jpg' }, ['Files']);
    expect(dragHasFiles(d)).toBe(true);
    // A file drag also carries a text/plain filename on some platforms. It must
    // not also count as a link drag, or one drop would ingest twice.
    expect(dragHasText(d)).toBe(false);
  });

  it('reads a browser link drag as text', () => {
    const d = dt({ 'text/uri-list': 'https://example.com/a' });
    expect(dragHasFiles(d)).toBe(false);
    expect(dragHasText(d)).toBe(true);
  });

  it('ignores a drag carrying neither', () => {
    expect(dragHasText(dt({}))).toBe(false);
    expect(dragHasText(null)).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });
});

describe('payloadFromDataTransfer', () => {
  it('takes the link from a dragged anchor', () => {
    const p = payloadFromDataTransfer(dt({
      'text/uri-list': 'https://example.com/article',
      'text/html': '<a href="https://example.com/article">Read this</a>',
      'text/plain': 'https://example.com/article',
    }));
    expect(p.urls).toEqual(['https://example.com/article']);
    expect(p.text).toBe('');
    expect(p.isImage).toBe(false);
  });

  it('prefers the img src over the page a dragged image sits on', () => {
    // Dragging a picture out of a gallery: uri-list points at the PAGE, the
    // markup holds the actual file. Saving the page would lose the picture.
    const p = payloadFromDataTransfer(dt({
      'text/uri-list': 'https://shop.example.com/product/9',
      'text/html': '<img src="https://cdn.example.com/p/9.jpg" alt="">',
    }));
    expect(p.urls[0]).toBe('https://cdn.example.com/p/9.jpg');
    expect(p.isImage).toBe(true);
  });

  it('skips comment lines in a uri-list', () => {
    const p = payloadFromDataTransfer(dt({
      'text/uri-list': '# a comment\r\nhttps://example.com/one\r\nhttps://example.com/two',
    }));
    expect(p.urls).toEqual(['https://example.com/one', 'https://example.com/two']);
  });

  it('falls back to links found in plain text', () => {
    const p = payloadFromDataTransfer(dt({
      'text/plain': 'see https://example.com/x and https://example.com/y.',
    }));
    expect(p.urls).toEqual(['https://example.com/x', 'https://example.com/y']);
  });

  it('keeps a dragged selection as text when it holds no link', () => {
    const p = payloadFromDataTransfer(dt({ 'text/plain': 'a paragraph worth keeping' }));
    expect(p.urls).toEqual([]);
    expect(p.text).toBe('a paragraph worth keeping');
  });

  it('never returns the same link twice', () => {
    const p = payloadFromDataTransfer(dt({
      'text/uri-list': 'https://example.com/a',
      'text/html': '<a href="https://example.com/a">a</a>',
      'text/plain': 'https://example.com/a',
    }));
    expect(p.urls).toEqual(['https://example.com/a']);
  });

  it('survives markup it cannot parse and an empty transfer', () => {
    expect(payloadFromDataTransfer(null).urls).toEqual([]);
    expect(payloadFromDataTransfer(dt({ 'text/html': '<<<' })).urls).toEqual([]);
  });
});

describe('isAllImageUrls', () => {
  it('routes a set of picture links to the carousel path', () => {
    expect(isAllImageUrls(['https://a/1.jpg', 'https://a/2.PNG?v=2'])).toBe(true);
  });
  it('leaves a mixed set to one memo per link', () => {
    expect(isAllImageUrls(['https://a/1.jpg', 'https://a/post'])).toBe(false);
    expect(isAllImageUrls([])).toBe(false);
  });
});

describe('resolveDropTarget', () => {
  // Untested until now, which is how the rule below survived unexamined: a
  // drop on the dashboard opened a form instead of saving, and the dashboard
  // is where you land.
  const base = { activeSpace: null, activeCollection: null };

  it('saves instantly wherever you drop, including the bare library', () => {
    for (const pathname of ['/', '/spaces', '/collections', '/memo/abc', '/ask']) {
      const t = resolveDropTarget({ ...base, pathname });
      expect(t.mode, `${pathname} should save, not ask`).toBe('instant');
      expect(t.scope).toBe('library');
      expect(t.label).toBe('your library');
    }
  });

  it('files into the collection you are looking at', () => {
    const t = resolveDropTarget({
      ...base,
      pathname: '/collection/c1',
      activeCollection: 'c1',
      collections: [{ id: 'c1', name: 'Fitness', emoji: '🏋️' }],
    });
    expect(t).toMatchObject({ mode: 'instant', scope: 'collection', collectionId: 'c1' });
    expect(t.label).toContain('Fitness');
  });

  it('files into the Space you are in when no collection is open', () => {
    const t = resolveDropTarget({
      ...base,
      pathname: '/space/s1',
      activeSpace: 's1',
      spaceName: 'Work',
      spaceEmoji: '💼',
    });
    expect(t).toMatchObject({ mode: 'instant', scope: 'space', workspaceId: 's1' });
    expect(t.label).toContain('Work');
  });

  it('a collection inside a Space carries both', () => {
    const t = resolveDropTarget({
      pathname: '/space/s1/collection/c1',
      activeSpace: 's1',
      activeCollection: 'c1',
      collections: [{ id: 'c1', name: 'Reading', emoji: '📚' }],
    });
    expect(t).toMatchObject({ scope: 'collection', collectionId: 'c1', workspaceId: 's1' });
  });

  it('the Music page takes audio through its own path', () => {
    expect(resolveDropTarget({ ...base, pathname: '/music' })).toMatchObject({
      mode: 'instant',
      scope: 'music',
    });
  });

  it('never asks anywhere, for anything', () => {
    // The one drop that still opens the panel is a text selection with no link
    // in it, and that is decided in the layer rather than here.
    const everywhere = ['/', '/music', '/spaces', '/collection/c1', '/space/s1', '/ask', '/memo/x'];
    for (const pathname of everywhere) {
      expect(resolveDropTarget({ ...base, pathname }).mode).toBe('instant');
    }
  });
});
