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
  const [editing, setEditing] = useState(!viewFirst);
  const [focused, setFocused] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const lastSyncedRef = useRef<string>(value ?? '');
  const dirtyRef = useRef(false);
  const justClickedRef = useRef(false);
  // Always holds the latest value prop without needing it as a dep
  const valueRef = useRef(value);
  valueRef.current = value;

  // Sync editing state when viewFirst prop changes (global edit mode toggle)
  useEffect(() => {
    const shouldEdit = !viewFirst;
    setEditing(shouldEdit);
    if (shouldEdit) {
      lastSyncedRef.current = valueRef.current ?? '';
      dirtyRef.current = false;
    }
  }, [viewFirst]);

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
  // Guard on editing so this never runs in view mode (ref.current would be null anyway).
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
    if (viewFirst) setEditing(false);
  }, [saveIfDirty, viewFirst]);

  const handleViewClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    // Don't intercept link clicks
    if ((e.target as HTMLElement).closest('a')) return;
    lastSyncedRef.current = valueRef.current ?? '';
    dirtyRef.current = false;
    justClickedRef.current = true;
    setEditing(true);
  };

  // View mode: rendered ReactMarkdown, click to edit
  if (viewFirst && !editing) {
    return (
      <div className={cn('relative', className)} onClick={handleViewClick}>
        {value ? (
          <div className="prose prose-lg dark:prose-invert max-w-none text-[var(--color-text)] cursor-text">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code: ({ inline, children }: { inline?: boolean; children?: ReactNode }) =>
                  inline ? (
                    <code className="bg-[var(--color-bg-code)] text-white px-1 py-0.5 rounded text-[12px] font-mono">{children}</code>
                  ) : (
                    <pre className="bg-[var(--color-bg-code)] text-white p-4 rounded-xl overflow-x-auto font-mono text-[12px] my-3">
                      <code>{children}</code>
                    </pre>
                  ),
                table: ({ children }: { children?: ReactNode }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="min-w-full border-collapse border border-[var(--color-border)]">{children}</table>
                  </div>
                ),
                th: ({ children }: { children?: ReactNode }) => (
                  <th className="border border-[var(--color-border)] bg-[var(--color-bg-hover)] px-3 py-2 text-left font-semibold">{children}</th>
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
          <p className="text-[var(--color-text-muted)] italic cursor-text px-1 py-2">{placeholder}</p>
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
      className={cn(
        'relative rounded-2xl transition-all',
        focused
          ? 'border border-[var(--color-border)] bg-[var(--color-bg-card)]'
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
