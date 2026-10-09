import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MarkdownEditor } from './MarkdownEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real MarkdownEditor with the real @mdxeditor/editor + Lexical underneath,
// mounted in jsdom. This exists because the editor package is upgraded on its
// own (a major bump moved Lexical 0.35 -> 0.48) and nothing else in the suite
// imports it, so a break in markdown import/export would ship green. Nothing here
// reads source text: if the plugin set, the markdown pipeline or the paste path
// stopped working, the DOM assertions below fail.

let root: Root | null = null;
let container: HTMLDivElement | null = null;

// Lexical commits to the DOM on a microtask and CodeMirror mounts lazily, so
// give the editor a few ticks inside act() before reading the DOM.
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
}

async function mount(props: Partial<React.ComponentProps<typeof MarkdownEditor>> & { value: string }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MarkdownEditor {...props} />);
  });
  await settle();
  return container;
}

beforeEach(() => {
  // jsdom has no layout engine; Lexical and CodeMirror probe these.
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} } as DOMRect;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => rect;
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  }
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('MarkdownEditor on the upgraded @mdxeditor/editor', () => {
  it('imports markdown into the real block types the toolbar and CSS expect', async () => {
    const md = [
      '# Title',
      '',
      'plain with **bold** and _italic_',
      '',
      '- one',
      '- two',
      '',
      '> quoted',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```js',
      'const a = 1;',
      '```',
    ].join('\n');
    const el = await mount({ value: md });
    const ce = el.querySelector('[contenteditable="true"]');
    expect(ce, 'editable surface mounted').not.toBeNull();
    expect(ce!.querySelector('h1')?.textContent).toBe('Title');
    expect(ce!.querySelector('strong')?.textContent).toBe('bold');
    expect(ce!.querySelectorAll('ul > li').length).toBe(2);
    expect(ce!.querySelector('blockquote')?.textContent).toBe('quoted');
    expect(ce!.querySelector('table')).not.toBeNull();
    // Fenced code is a CodeMirror node (the theme overrides target .cm-editor).
    expect(el.querySelector('.cm-editor')).not.toBeNull();
  });

  it('keeps the class hooks openmemo.css and the blur handler select on', async () => {
    const el = await mount({ value: 'hello' });
    const root = el.querySelector('.mdxeditor');
    expect(root, '.mdxeditor root').not.toBeNull();
    // `om-mdx` + `dark-theme` are passed as className and feed the --base* remap.
    expect(root!.classList.contains('om-mdx')).toBe(true);
    // Toolbar and select trigger are matched by hashed-module-name fragments.
    expect(el.querySelector('[class*="_toolbarRoot"]'), 'toolbar').not.toBeNull();
    expect(el.querySelector('[class*="selectTrigger"]'), 'block type trigger').not.toBeNull();
  });

  it('renders the compact toolbar with only the inline toggles', async () => {
    const full = await mount({ value: 'x' });
    const fullButtons = full.querySelectorAll('[class*="_toolbarRoot"] button').length;
    act(() => root?.unmount());
    full.remove();

    const compact = await mount({ value: 'x', compact: true });
    const compactButtons = compact.querySelectorAll('[class*="_toolbarRoot"] button').length;
    expect(compactButtons).toBeGreaterThan(0);
    expect(compactButtons).toBeLessThan(fullButtons);
  });

  it('exports edits back to markdown through onChange (paste path uses insertMarkdown)', async () => {
    const onChange = vi.fn();
    // Empty note on purpose: with existing text, insertMarkdown merges the first
    // pasted block into the current paragraph (same on 3.55 and 4.x), which would
    // hide the heading. An empty note shows whether pasted syntax becomes nodes.
    const el = await mount({ value: '', onChange });
    const wrapper = el.querySelector('.om-md-editor') as HTMLElement;
    expect(wrapper, 'wrapper that owns the paste listener').not.toBeNull();

    // Same shape the component reads: clipboardData.getData('text/plain').
    const evt = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'clipboardData', {
      value: { getData: (t: string) => (t === 'text/plain' ? '## Pasted\n\n- a\n- b' : '') },
    });
    await act(async () => {
      wrapper.dispatchEvent(evt);
    });
    await settle();

    expect(evt.defaultPrevented, 'component took over the paste').toBe(true);
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as string;
    // Markdown syntax became real nodes (not escaped literal text) and round-tripped.
    expect(last).toContain('## Pasted');
    expect(last).toMatch(/[-*] a/);
    expect(last).not.toContain('\\#');
    const ce = el.querySelector('[contenteditable="true"]')!;
    expect(ce.querySelector('h2')?.textContent).toBe('Pasted');
  });

  it('pulls a late external value into the editor while unfocused', async () => {
    const el = await mount({ value: '' });
    await act(async () => {
      root!.render(<MarkdownEditor value={'# Arrived late'} />);
    });
    await settle();
    expect(el.querySelector('[contenteditable="true"] h1')?.textContent).toBe('Arrived late');
  });
});
