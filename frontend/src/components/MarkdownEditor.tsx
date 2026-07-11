import { useRef, useState, useCallback, useEffect } from 'react';
import { MDXEditor, type MDXEditorMethods } from '@mdxeditor/editor';
import {
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  frontmatterPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  InsertTable,
  InsertCodeBlock,
  InsertThematicBreak,
  Separator,
} from '@mdxeditor/editor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import '@mdxeditor/editor/style.css';

// CommonMark collapses a lone newline into a space, so single line breaks in
// notes/lyrics/poems vanish on render even though the editor shows them. Turn a
// soft break between two plain paragraph lines into a markdown hard break (two
// trailing spaces) so what you typed is what you see (OPNMMO-0042). Block
// constructs (headings, lists, quotes, tables, fences, rules) are left untouched,
// and fenced code is skipped wholesale.
function preserveLineBreaks(md: string): string {
  if (!md) return md;
  const isBlock = (s?: string) =>
    !s || /^\s*$/.test(s) || /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||`{3,}|~{3,}|-{3,}|\*{3,}|_{3,})/.test(s);
  return md
    // Normalize CRLF/CR → LF first; a stray \r before the hard-break spaces
    // would otherwise split each line into its own paragraph.
    .replace(/\r\n?/g, '\n')
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // fenced code block — leave as-is
      const lines = seg.split('\n');
      return lines
        .map((line, idx) => {
          const next = lines[idx + 1];
          if (line && next && !isBlock(line) && !isBlock(next) && !/ {2}$/.test(line)) {
            return line + '  ';
          }
          return line;
        })
        .join('\n');
    })
    .join('');
}

interface MarkdownEditorProps {
  value: string;
  onSave?: (value: string) => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  /** Compact toolbar (inline notes scratchpad). Default false = full toolbar. */
  compact?: boolean;
  /**
   * Start as rendered ReactMarkdown. Click enters MDXEditor edit mode.
   * Blur auto-saves and returns to rendered view.
   */
  viewFirst?: boolean;
}

export function MarkdownEditor({
  value,
  onSave,
  onChange,
  placeholder = 'Click to edit...',
  className,
  readOnly = false,
  compact = false,
  viewFirst = false,
}: MarkdownEditorProps) {
  const ref = useRef<MDXEditorMethods>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Only tracks explicit user click-to-edit. Derived `editing` below is the source of truth.
  const [clickedToEdit, setClickedToEdit] = useState(false);
  const [focused, setFocused] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  // Editor chrome follows the app theme (MDXEditor ships light by default, so it
  // looked white-on-dark). Any non-light theme → dark-theme class (OPNMMO).
  const theme = useAppStore((s) => s.tweaks.theme);
  const isDark = theme !== 'light';
  const lastSyncedRef = useRef<string>(value ?? '');
  const dirtyRef = useRef(false);
  const justClickedRef = useRef(false);
  const valueRef = useRef(value);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror so click-to-edit reads the latest value synchronously
  valueRef.current = value;

  // When viewFirst flips back to true (e.g. global edit mode off), return to rendered view.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- return to rendered view when viewFirst flips back on
    if (viewFirst) setClickedToEdit(false);
  }, [viewFirst]);

  // editing is derived — cannot be accidentally flipped by effects on mount.
  // viewFirst=false → always in edit mode. viewFirst=true → only if user clicked.
  const editing = !viewFirst || clickedToEdit;

  // Auto-focus MDXEditor when user clicks into view mode
  useEffect(() => {
    if (editing && justClickedRef.current && ref.current) {
      justClickedRef.current = false;
      ref.current.focus();
    }
  }, [editing]);

  const handleChange = useCallback(
    (md: string) => {
      if (focused) dirtyRef.current = true;
      onChange?.(md);
    },
    [onChange, focused]
  );

  // Sync external value into editor when not focused (late-loading async data).
  useEffect(() => {
    if (!ref.current || focused || !editing) return;
    const current = ref.current.getMarkdown();
    if (current !== value) {
      ref.current.setMarkdown(value ?? '');
    }
    lastSyncedRef.current = value ?? '';
    dirtyRef.current = false;
  }, [value, focused, editing]);

  const saveIfDirty = useCallback(() => {
    if (!onSave || !ref.current) return;
    if (!dirtyRef.current) return;
    const current = ref.current.getMarkdown();
    if (current === lastSyncedRef.current) return;
    onSave(current);
    lastSyncedRef.current = current;
    dirtyRef.current = false;
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }, [onSave]);

  // Focus moving into an MDXEditor portal (the block-type dropdown, link dialog,
  // table popover) lives OUTSIDE the wrapper, so a naive blur handler would
  // collapse the editor the instant the user opens the BlockTypeSelect
  // (OPNMMO). Treat focus that lands inside the wrapper OR any MDXEditor portal
  // as "still editing" and skip the collapse; only save+collapse on a real exit.
  const focusStillInEditor = useCallback((next: Element | null) => {
    if (!next) return false;
    if (wrapperRef.current?.contains(next)) return true;
    // Portaled MDXEditor surfaces use stable module class fragments; match them
    // (plus the Radix listbox/dialog roles) so any popover keeps the editor open.
    return !!next.closest(
      '[class*="selectContainer"],[class*="SelectContainer"],[class*="selectContent"],[class*="selectItem"],[class*="SelectItem"],[class*="popupContainer"],[class*="popoverContent"],[class*="PopoverContent"],[class*="dialogContent"],[class*="DialogContent"],[role="listbox"],[role="dialog"]'
    );
  }, []);

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // `relatedTarget` is where focus is heading; on some interactions it is
      // null, so fall back to a deferred activeElement check next frame.
      if (focusStillInEditor(e.relatedTarget as Element | null)) return;
      requestAnimationFrame(() => {
        if (focusStillInEditor(document.activeElement)) return;
        setFocused(false);
        saveIfDirty();
        if (viewFirst) setClickedToEdit(false);
      });
    },
    [focusStillInEditor, saveIfDirty, viewFirst]
  );

  // Intercept paste in MDXEditor: treat plain-text paste as markdown so syntax (#, **, >, lists)
  // becomes proper nodes instead of being escaped as literal text.
  useEffect(() => {
    if (!editing || readOnly) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const text = cd.getData('text/plain');
      if (!text || !ref.current) return;
      // Always treat clipboard plain text as markdown so syntax (#, **, fenced code, tables)
      // becomes proper nodes instead of literal text.
      e.preventDefault();
      e.stopPropagation();
      // Focus first so the editor has a definite selection range, otherwise
      // insertMarkdown() can be a no-op or insert at an unexpected location
      // when the wrapper receives the paste before the contenteditable has
      // taken focus (e.g. paste via menu, paste right after click).
      try {
        ref.current.focus();
      } catch {
        /* focus is best-effort */
      }
      try {
        ref.current.insertMarkdown(text);
      } catch {
        // Defensive fallback: if insertMarkdown throws (cursor not set, plugin
        // error), append the pasted content to the document so the user does
        // not lose the paste.
        const current = ref.current.getMarkdown();
        ref.current.setMarkdown(current + (current.endsWith('\n') ? '' : '\n\n') + text);
      }
      dirtyRef.current = true;
      onChange?.(ref.current.getMarkdown());
    };

    wrapper.addEventListener('paste', onPaste, true);
    return () => wrapper.removeEventListener('paste', onPaste, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange read via closure; re-subscribing the paste listener each render is undesirable
  }, [editing, readOnly]);

  const handleViewClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    if ((e.target as HTMLElement).closest('a')) return;
    lastSyncedRef.current = valueRef.current ?? '';
    dirtyRef.current = false;
    justClickedRef.current = true;
    setClickedToEdit(true);
  };

  // View ↔ edit crossfade (OPNMMO): one AnimatePresence holds both states so
  // opening the editor eases in instead of snapping. popLayout keeps the editor
  // in document flow the instant it mounts, so the click-to-edit auto-focus
  // still lands. initial={false} skips the animation on first paint.
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {viewFirst && !clickedToEdit ? (
        <motion.div
          key="md-view"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn('relative', className)}
          onClick={handleViewClick}
        >
          {value ? (
            <div className="om-prose max-w-none cursor-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{preserveLineBreaks(value)}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-[var(--text-4)] italic cursor-text px-1 py-2">{placeholder}</p>
          )}
          {savedFlash && (
            <div className="absolute bottom-2 right-3 text-[11px] font-medium text-[var(--color-status)] animate-in fade-in slide-in-from-bottom-1 duration-300">
              Saved ✓
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="md-edit"
          ref={wrapperRef}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className={cn(
            'relative rounded-2xl transition-[border-color,background-color] om-md-editor',
            focused
              ? 'border border-[var(--border)] bg-[var(--surface)]'
              : 'border border-transparent bg-transparent',
            className
          )}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          tabIndex={-1}
        >
      <MDXEditor
        ref={ref}
        className={cn('om-mdx', isDark && 'dark-theme')}
        markdown={value}
        onChange={handleChange}
        placeholder={placeholder}
        readOnly={readOnly}
        contentEditableClassName="om-prose max-w-none min-h-[240px] px-4 py-3 outline-none"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          tablePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: 'txt' }),
          codeMirrorPlugin({
            // Unknown languages render as plain monospace instead of
            // crashing the editor. Aliases (py->python, sh->bash, etc.) keep
            // pasted fenced blocks from showing as "unsupported".
            codeBlockLanguages: {
              txt: 'Plain Text',
              plaintext: 'Plain Text',
              text: 'Plain Text',
              js: 'JavaScript',
              javascript: 'JavaScript',
              jsx: 'JSX',
              ts: 'TypeScript',
              typescript: 'TypeScript',
              tsx: 'TSX',
              python: 'Python',
              py: 'Python',
              bash: 'Bash',
              sh: 'Shell',
              shell: 'Shell',
              zsh: 'Zsh',
              fish: 'Fish',
              powershell: 'PowerShell',
              ps1: 'PowerShell',
              bat: 'Batch',
              cmd: 'Batch',
              json: 'JSON',
              jsonc: 'JSON',
              yaml: 'YAML',
              yml: 'YAML',
              toml: 'TOML',
              ini: 'INI',
              html: 'HTML',
              htm: 'HTML',
              xml: 'XML',
              svg: 'SVG',
              css: 'CSS',
              scss: 'SCSS',
              sass: 'Sass',
              less: 'Less',
              sql: 'SQL',
              md: 'Markdown',
              markdown: 'Markdown',
              go: 'Go',
              rust: 'Rust',
              rs: 'Rust',
              java: 'Java',
              kotlin: 'Kotlin',
              kt: 'Kotlin',
              swift: 'Swift',
              c: 'C',
              cpp: 'C++',
              cxx: 'C++',
              cc: 'C++',
              csharp: 'C#',
              cs: 'C#',
              fsharp: 'F#',
              fs: 'F#',
              ruby: 'Ruby',
              rb: 'Ruby',
              php: 'PHP',
              perl: 'Perl',
              pl: 'Perl',
              lua: 'Lua',
              r: 'R',
              dart: 'Dart',
              elixir: 'Elixir',
              ex: 'Elixir',
              erlang: 'Erlang',
              haskell: 'Haskell',
              hs: 'Haskell',
              julia: 'Julia',
              jl: 'Julia',
              scala: 'Scala',
              clojure: 'Clojure',
              clj: 'Clojure',
              vim: 'Vim Script',
              dockerfile: 'Dockerfile',
              docker: 'Dockerfile',
              makefile: 'Makefile',
              make: 'Makefile',
              nginx: 'Nginx',
              graphql: 'GraphQL',
              gql: 'GraphQL',
              proto: 'Protobuf',
              protobuf: 'Protobuf',
              tex: 'LaTeX',
              latex: 'LaTeX',
              vue: 'Vue',
              svelte: 'Svelte',
              diff: 'Diff',
              patch: 'Diff',
            },
          }),
          frontmatterPlugin(),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
                {compact ? (
                  <BoldItalicUnderlineToggles />
                ) : (
                  <>
                    <UndoRedo />
                    <Separator />
                    <BlockTypeSelect />
                    <Separator />
                    <BoldItalicUnderlineToggles />
                    <Separator />
                    <ListsToggle />
                    <Separator />
                    <CreateLink />
                    <InsertTable />
                    <InsertCodeBlock />
                    <InsertThematicBreak />
                  </>
                )}
              </div>
            ),
          }),
        ]}
      />

      {savedFlash && (
        <div className="absolute bottom-2 right-3 text-[11px] font-medium text-[var(--color-status)] animate-in fade-in slide-in-from-bottom-1 duration-300">
          Saved ✓
        </div>
      )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
