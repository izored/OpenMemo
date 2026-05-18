import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
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
import { cn } from '@/lib/utils';
import '@mdxeditor/editor/style.css';

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
  const lastSyncedRef = useRef<string>(value ?? '');
  const dirtyRef = useRef(false);
  const justClickedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  // When viewFirst flips back to true (e.g. global edit mode off), return to rendered view.
  useEffect(() => {
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

  const handleBlur = useCallback(() => {
    setFocused(false);
    saveIfDirty();
    if (viewFirst) setClickedToEdit(false);
  }, [saveIfDirty, viewFirst]);

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
      ref.current.insertMarkdown(text);
      dirtyRef.current = true;
    };

    wrapper.addEventListener('paste', onPaste, true);
    return () => wrapper.removeEventListener('paste', onPaste, true);
  }, [editing, readOnly]);

  const handleViewClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    if ((e.target as HTMLElement).closest('a')) return;
    lastSyncedRef.current = valueRef.current ?? '';
    dirtyRef.current = false;
    justClickedRef.current = true;
    setClickedToEdit(true);
  };

  // View mode: rendered ReactMarkdown, click to edit
  if (viewFirst && !clickedToEdit) {
    return (
      <div className={cn('relative', className)} onClick={handleViewClick}>
        {value ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-[var(--color-text)] cursor-text prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2 prose-blockquote:my-2 prose-pre:my-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code: ({ children, className }: { children?: ReactNode; className?: string }) => (
                  <code className={cn('bg-[var(--surface-3)] text-white px-1 py-0.5 rounded text-[12px] font-mono', className)}>{children}</code>
                ),
                pre: ({ children }: { children?: ReactNode }) => (
                  <pre className="bg-[var(--surface-3)] text-white p-4 rounded-xl overflow-x-auto font-mono text-[12px] my-3 [&_code]:bg-transparent [&_code]:p-0">
                    {children}
                  </pre>
                ),
                table: ({ children }: { children?: ReactNode }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="min-w-full border-collapse border border-[var(--color-border)]">{children}</table>
                  </div>
                ),
                th: ({ children }: { children?: ReactNode }) => (
                  <th className="border border-[var(--color-border)] bg-[var(--surface-2)] px-3 py-2 text-left font-semibold">{children}</th>
                ),
                td: ({ children }: { children?: ReactNode }) => (
                  <td className="border border-[var(--color-border)] px-3 py-2">{children}</td>
                ),
              }}
            >
              {value}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-[var(--text-4)] italic cursor-text px-1 py-2">{placeholder}</p>
        )}
        {savedFlash && (
          <div className="absolute bottom-2 right-3 text-[11px] font-medium text-[var(--color-status)] animate-in fade-in slide-in-from-bottom-1 duration-300">
            Saved ✓
          </div>
        )}
      </div>
    );
  }

  // Edit mode: MDXEditor with toolbar
  return (
    <div
      ref={wrapperRef}
      className={cn(
        'relative rounded-2xl transition-all',
        focused
          ? 'border border-[var(--color-border)] bg-[var(--surface)]'
          : 'border border-transparent bg-transparent',
        className
      )}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
      tabIndex={-1}
    >
      <MDXEditor
        ref={ref}
        markdown={value}
        onChange={handleChange}
        placeholder={placeholder}
        readOnly={readOnly}
        contentEditableClassName="prose dark:prose-invert max-w-none text-[var(--color-text)] min-h-[240px] px-4 py-3 outline-none"
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
            codeBlockLanguages: {
              txt: 'Plain Text',
              js: 'JavaScript',
              jsx: 'JSX',
              ts: 'TypeScript',
              tsx: 'TSX',
              python: 'Python',
              py: 'Python',
              bash: 'Bash',
              sh: 'Shell',
              json: 'JSON',
              yaml: 'YAML',
              yml: 'YAML',
              html: 'HTML',
              css: 'CSS',
              sql: 'SQL',
              md: 'Markdown',
              go: 'Go',
              rust: 'Rust',
              java: 'Java',
              c: 'C',
              cpp: 'C++',
            },
          }),
          frontmatterPlugin(),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-[var(--color-border)]">
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
    </div>
  );
}
