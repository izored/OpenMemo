import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Maximize2, WrapText } from 'lucide-react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { loadLanguage } from '@/lib/codeLanguage';
import { cn } from '@/lib/utils';

/**
 * Syntax-highlighted read-only view for a `code` memo.
 *
 * An uploaded source file used to render through the markdown pipeline as a
 * plain fenced block: one colour, no line numbers, nothing to search. Fine for
 * a three-line snippet inside a note, useless for the 800-line file you
 * actually saved, which is the only thing that ever becomes a `code` memo
 * (uploads only, never a typed note).
 *
 * Built on CodeMirror 6 rather than a highlight-only library, for the reason
 * the roadmap gives: the viewer is phase one and a light in-place editor is
 * phase two, and every other option would be thrown away at that point. It was
 * already in the tree as a transitive dependency of the markdown editor; the
 * packages are declared directly now, because a feature that depends on
 * somebody else's dependency breaks the day they drop it.
 *
 * Read-only is enforced twice on purpose: `EditorState.readOnly` rejects
 * document changes, and `editable: false` also drops the contenteditable, so
 * the caret and the mobile keyboard never appear on something you cannot edit.
 *
 * Follows PdfViewer: lazy-loaded by the detail page, toolbar in `om-*` tokens,
 * theme from CSS variables so it tracks `[data-theme]` rather than shipping its
 * own light and dark palettes.
 */

/** Highlight colours as token roles, resolved from the theme's own variables.
 *
 *  Deliberately not a stock CodeMirror theme: those hardcode hex for a light or
 *  a dark background and would fight `[data-theme]`, which is the exact bug the
 *  repo's Tailwind ban exists to prevent. `--code-*` are defined once in
 *  openmemo.css per theme. */
const omHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: 'var(--code-keyword)' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: 'var(--code-name)' },
  { tag: [t.function(t.variableName), t.labelName], color: 'var(--code-function)' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: 'var(--code-constant)' },
  { tag: [t.definition(t.name), t.separator], color: 'var(--code-name)' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.self, t.namespace], color: 'var(--code-type)' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link], color: 'var(--code-operator)' },
  { tag: [t.meta, t.comment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.heading, fontWeight: 'bold', color: 'var(--code-name)' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: 'var(--code-constant)' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: 'var(--code-string)' },
  { tag: t.invalid, color: 'var(--code-invalid)' },
]);

const omTheme = EditorView.theme({
  '&': {
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontSize: '13px',
  },
  '.cm-content': {
    fontFamily: 'var(--font-code)',
    padding: '14px 0',
    caretColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-4)',
    border: 'none',
    fontFamily: 'var(--font-code)',
    paddingRight: '4px',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 14px', minWidth: '2.5ch' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-2)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--code-selection)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--code-selection)' },
  '.cm-searchMatch': { backgroundColor: 'var(--code-selection)', outline: '1px solid var(--border-2)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--code-selection)' },
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    borderTop: '1px solid var(--border)',
  },
  '.cm-panel input, .cm-panel button': {
    fontFamily: 'var(--font-ui)',
    background: 'var(--surface-3)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '2px 6px',
  },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.6' },
});

export function CodeViewer({
  code,
  filename,
  downloadHref,
  theater,
  onTheaterChange,
}: {
  code: string;
  /** Drives both the language pick and the toolbar label. */
  filename: string;
  downloadHref?: string;
  theater?: boolean;
  onTheaterChange?: (v: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [langExt, setLangExt] = useState<Extension | null>(null);
  const [langLabel, setLangLabel] = useState('Plain text');
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  const lineCount = useMemo(() => (code ? code.split('\n').length : 0), [code]);

  useEffect(() => {
    let cancelled = false;
    void loadLanguage(filename).then(({ ext, label }) => {
      if (cancelled) return;
      setLangExt(() => ext);
      setLangLabel(label);
    });
    return () => { cancelled = true; };
  }, [filename]);

  // One editor, rebuilt when the document or an extension actually changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of(searchKeymap),
      syntaxHighlighting(omHighlight),
      omTheme,
      // Both halves matter: readOnly refuses edits, editable:false also removes
      // the contenteditable so no caret and no phone keyboard appear.
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ];
    if (wrap) extensions.push(EditorView.lineWrapping);
    if (langExt) extensions.push(langExt);

    const view = new EditorView({
      state: EditorState.create({ doc: code, extensions }),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [code, langExt, wrap]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated and can simply refuse. The file is still
      // selectable, so this is a convenience that failed, not an error worth
      // interrupting anyone over.
    }
  }, [code]);

  return (
    <div className={cn('om-code', theater && 'theater')}>
      <div className="om-code-bar">
        <div className="om-code-bar-group">
          <span className="om-code-lang mono">{langLabel}</span>
          <span className="om-code-lines mono">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>

        <div className="om-code-bar-group om-code-bar-end">
          <button
            type="button"
            className={cn('om-code-btn', wrap && 'is-on')}
            onClick={() => setWrap((w) => !w)}
            title={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
            aria-pressed={wrap}
            aria-label="Wrap long lines"
          >
            <WrapText size={15} />
          </button>
          {onTheaterChange && (
            <button
              type="button"
              className="om-code-btn"
              onClick={() => onTheaterChange(!theater)}
              title={theater ? 'Exit theater (compact)' : 'Theater (full width)'}
              aria-label={theater ? 'Exit theater mode' : 'Theater mode'}
            >
              <Maximize2 size={15} />
            </button>
          )}
          {downloadHref && (
            <a
              className="om-code-btn"
              href={downloadHref}
              title={`Download ${filename}`}
              aria-label="Download the file"
            >
              <Download size={15} />
            </a>
          )}
          <button
            type="button"
            className={cn('om-code-btn', copied && 'is-done')}
            onClick={copy}
            title="Copy the whole file"
            aria-label="Copy the whole file"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
      </div>

      <div className="om-code-scroll" ref={hostRef} />
    </div>
  );
}

export default CodeViewer;
