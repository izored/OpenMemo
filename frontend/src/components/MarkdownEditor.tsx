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
}

export function MarkdownEditor({
  value,
  onSave,
  onChange,
  placeholder = 'Click to edit...',
  className,
  readOnly = false,
  compact = false,
}: MarkdownEditorProps) {
  const ref = useRef<MDXEditorMethods>(null);
  const [focused, setFocused] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  // Track the markdown the editor was last seeded with so blur can tell whether
  // the user actually changed anything. Without this, blur re-serializes via
  // MDXEditor's markdown emitter and accumulates `\*`, `\#`, `&#x20;` escapes
  // each visit — corrupting saved content on every page open.
  const lastSyncedRef = useRef<string>(value ?? '');
  const dirtyRef = useRef(false);

  const handleChange = useCallback(
    (md: string) => {
      if (focused) dirtyRef.current = true;
      onChange?.(md);
    },
    [onChange, focused]
  );

  // Sync external value changes into the editor (e.g. when memo loads async after mount).
  // MDXEditor's `markdown` prop only seeds initial state — without this, late-arriving
  // data leaves the editor empty and pasted/saved markdown never re-renders on revisit.
  useEffect(() => {
    if (!ref.current || focused) return;
    const current = ref.current.getMarkdown();
    if (current !== value) {
      ref.current.setMarkdown(value ?? '');
    }
    lastSyncedRef.current = value ?? '';
    dirtyRef.current = false;
  }, [value, focused]);

  const handleBlur = useCallback(() => {
    setFocused(false);
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
        contentEditableClassName="prose dark:prose-invert max-w-none text-[var(--color-text)] min-h-[120px] px-4 py-3 outline-none"
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
