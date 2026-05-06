import { useRef, useState, useCallback } from 'react';
import { MDXEditor, type MDXEditorMethods } from '@mdxeditor/editor';
import {
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
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
}

export function MarkdownEditor({
  value,
  onSave,
  onChange,
  placeholder = 'Click to edit...',
  className,
  readOnly = false,
}: MarkdownEditorProps) {
  const ref = useRef<MDXEditorMethods>(null);
  const [focused, setFocused] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const handleChange = useCallback(
    (md: string) => {
      onChange?.(md);
    },
    [onChange]
  );

  const handleBlur = useCallback(() => {
    setFocused(false);
    if (onSave && ref.current) {
      const current = ref.current.getMarkdown();
      onSave(current);
      // Flash saved indicator
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    }
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
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <div className="flex gap-1 px-2 py-1.5 border-b border-[var(--color-border)]">
                <BoldItalicUnderlineToggles />
              </div>
            ),
          }),
        ]}
      />

      {/* Saved indicator */}
      {savedFlash && (
        <div className="absolute bottom-2 right-3 text-[11px] font-medium text-[var(--color-status)] animate-in fade-in slide-in-from-bottom-1 duration-300">
          Saved ✓
        </div>
      )}
    </div>
  );
}
