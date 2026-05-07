import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Sparkles,
  Loader2,
  ExternalLink,
  Pencil,
  X,
  ChevronDown,
  ChevronUp,
  Save,
  Tag,
  Folder,
} from 'lucide-react';
import { BackButton } from '@/components/BackButton';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { memoApi, collectionApi } from '@/lib/api';
import { AskMemoPanel } from '@/components/AskMemoPanel';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Memo, Collection } from '@/types';

function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      return u.searchParams.get('v');
    }
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1);
    }
  } catch {
    return null;
  }
  return null;
}

export function MemoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [noteEditMode, setNoteEditMode] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [showExtracted, setShowExtracted] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editSourceUrl, setEditSourceUrl] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [editCollectionIds, setEditCollectionIds] = useState<string[]>([]);

  const { data: memo, isLoading } = useQuery({
    queryKey: ['memo', id],
    queryFn: () => memoApi.get(id!),
    enabled: !!id,
  });

  const { data: related = [] } = useQuery<Memo[]>({
    queryKey: ['memo-related', id],
    queryFn: () => memoApi.related(id!),
    enabled: !!id,
  });

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  // Initialize edit form when memo loads
  useEffect(() => {
    if (memo) {
      setEditTitle(memo.title || '');
      setEditSourceUrl(memo.source_url || '');
      setEditContent(memo.content_raw || memo.content_text || '');
      setEditNotes(memo.notes || '');
      setEditTags(memo.tags || []);
      setEditCollectionIds(memo.collections?.map((c: { id: string }) => c.id) || []);
    }
  }, [memo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleGenerateSummary = async () => {
    if (!id) return;
    setGeneratingSummary(true);
    try {
      await memoApi.summary(id);
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await memoApi.update(id, {
        title: editTitle,
        source_url: editSourceUrl,
        content_raw: editContent,
        notes: editNotes,
        tags: editTags,
        collection_ids: editCollectionIds,
      });
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      setIsEditing(false);
    } catch (e) {
      console.error(e);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const t = editTagInput.trim().toLowerCase();
    if (t && !editTags.includes(t)) {
      setEditTags([...editTags, t]);
    }
    setEditTagInput('');
  };

  const removeTag = (tag: string) => {
    setEditTags(editTags.filter((t) => t !== tag));
  };

  const toggleCollection = (cid: string) => {
    if (editCollectionIds.includes(cid)) {
      setEditCollectionIds(editCollectionIds.filter((c) => c !== cid));
    } else {
      setEditCollectionIds([...editCollectionIds, cid]);
    }
  };

  // Debounced notes auto-save when not in edit mode
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);

  useEffect(() => {
    if (memo?.notes !== undefined) setNotesDraft(memo.notes || ''); // eslint-disable-line react-hooks/set-state-in-effect
  }, [memo?.notes]);

  const saveNotes = useCallback(async () => {
    if (!id || isEditing) return;
    if (notesDraft === (memo?.notes || '')) return;
    setNotesSaving(true);
    try {
      await memoApi.update(id, { notes: notesDraft });
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
    } catch (e) {
      console.error(e);
    } finally {
      setNotesSaving(false);
    }
  }, [id, notesDraft, memo?.notes, isEditing, queryClient]);

  useEffect(() => {
    const timer = setTimeout(saveNotes, 1000);
    return () => clearTimeout(timer);
  }, [notesDraft, saveNotes]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--color-brand)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--color-text-secondary)]">Memo not found</p>
      </div>
    );
  }

  const youtubeId = memo.type === 'video' && memo.source_url ? getYouTubeVideoId(memo.source_url) : null;
  const isWebType = memo.type === 'article' || memo.type === 'link';

  return (
    <div className="h-full flex">
      {/* Content pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 pl-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3 flex-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{memo.type}</span>
          </div>
          <div className="flex items-center gap-1">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
              >
                <Pencil size={14} />
                Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-text-active)] bg-[var(--color-bg-active)] rounded-full transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
                >
                  <X size={14} />
                  Cancel
                </button>
              </>
            )}
            {memo.source_url && !isEditing && (
              <a
                href={memo.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
              >
                <ExternalLink size={14} />
                Open Original
              </a>
            )}
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`p-2 rounded-full transition-colors ${chatOpen ? 'bg-[var(--color-brand-light)] text-[var(--color-brand)]' : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]'}`}
            >
              <MessageSquare size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto">
            {/* Title */}
            {/* Back button */}
            <div className="mb-3">
              <BackButton />
            </div>

            {isEditing ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full text-2xl font-bold text-[var(--color-text)] mb-2 tracking-tight bg-transparent border-b-2 border-[var(--color-border)] focus:border-[var(--color-text)] outline-none pb-2"
              />
            ) : (
              <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2 tracking-tight">{memo.title}</h1>
            )}

            {/* Meta */}
            <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)] mb-6 flex-wrap">
              <span className="font-mono text-[11px]">{new Date(memo.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              {memo.source_domain && !isEditing && (
                <>
                  <span>•</span>
                  <a
                    href={memo.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-[var(--color-brand)] transition-colors link-dotted"
                  >
                    {memo.source_favicon && <img src={memo.source_favicon} alt="" className="w-4 h-4 rounded-full" />}
                    {memo.source_domain}
                    <ExternalLink size={12} />
                  </a>
                </>
              )}
              {isEditing && (
                <>
                  <span>•</span>
                  <input
                    value={editSourceUrl}
                    onChange={(e) => setEditSourceUrl(e.target.value)}
                    placeholder="Source URL"
                    className="flex-1 min-w-[200px] bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-text)] outline-none text-sm"
                  />
                </>
              )}
              {!isEditing && memo.tags?.length > 0 && (
                <>
                  <span>•</span>
                  <div className="flex gap-1 flex-wrap">
                    {memo.tags.map((tag: string) => (
                      <span key={tag} className="px-2 py-0.5 bg-[var(--color-bg-hover)] rounded-full text-[11px] font-semibold uppercase tracking-wide">{tag}</span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Edit: Tags */}
            {isEditing && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Tag size={14} className="text-[var(--color-text-muted)]" />
                  <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Tags</span>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  {editTags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--color-bg-hover)] rounded-full text-xs font-semibold">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="hover:text-[var(--color-brand)]"><X size={12} /></button>
                    </span>
                  ))}
                  <input
                    value={editTagInput}
                    onChange={(e) => setEditTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    placeholder="Add tag..."
                    className="px-2 py-1 text-xs border border-[var(--color-border)] rounded-full outline-none focus:border-[var(--color-text)]"
                  />
                </div>
              </div>
            )}

            {/* Edit: Collections */}
            {isEditing && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Folder size={14} className="text-[var(--color-text-muted)]" />
                  <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Collections</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {collections.map((col: Collection) => (
                    <button
                      key={col.id}
                      onClick={() => toggleCollection(col.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                        editCollectionIds.includes(col.id)
                          ? 'bg-[var(--color-bg-active)] text-[var(--color-text-active)]'
                          : 'bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
                      }`}
                    >
                      {col.emoji} {col.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* AI Summary */}
            {!isEditing && (
              <>
                {memo.ai_summary ? (
                  <div className="mb-6 p-5 rounded-2xl border border-[#ea2804]/20 bg-[var(--color-brand-light)]">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles size={16} className="text-[var(--color-brand)]" />
                      <span className="text-sm font-semibold text-[var(--color-text)]">AI Summary</span>
                    </div>
                    <div className="text-sm text-[var(--color-text)] prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.ai_summary}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleGenerateSummary}
                    disabled={generatingSummary}
                    className="mb-6 flex items-center gap-2 px-5 py-2 border border-[var(--color-text)] text-[var(--color-text)] rounded-full text-sm font-semibold hover:bg-[var(--color-bg-hover)] disabled:opacity-40 transition-colors"
                  >
                    {generatingSummary ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Generate AI Summary
                  </button>
                )}
              </>
            )}

            {/* Thumbnail / Image */}
            {memo.type === 'image' && memo.file_path && !isEditing && (
              <div className="mb-6 rounded-2xl overflow-hidden border border-[var(--color-border)]">
                <img src={`/api/files/${memo.file_path}`} alt={memo.title} className="w-full" />
              </div>
            )}

            {/* Video */}
            {youtubeId && !isEditing && (
              <div className="mb-6 aspect-video rounded-2xl overflow-hidden bg-[var(--color-bg-active)]">
                <iframe
                  src={`https://www.youtube.com/embed/${youtubeId}`}
                  className="w-full h-full"
                  allowFullScreen
                  title={memo.title}
                />
              </div>
            )}

            {/* Rich Web Preview for article/link */}
            {isWebType && !isEditing && (
              <div className="mb-6">
                {/* Rich preview card */}
                <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] overflow-hidden shadow-sm">
                  {memo.thumbnail_path && (
                    <div className="aspect-[16/9] overflow-hidden">
                      <img src={memo.thumbnail_path} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-3">
                      {memo.source_favicon ? (
                        <img src={memo.source_favicon} alt="" className="w-5 h-5 rounded-full" />
                      ) : (
                        <GlobeIcon size={18} className="text-[var(--color-text-muted)]" />
                      )}
                      <span className="text-sm font-semibold text-[var(--color-text-secondary)]">{memo.source_domain || 'Website'}</span>
                    </div>
                    <h2 className="text-lg font-bold text-[var(--color-text)] mb-2">{memo.title}</h2>
                    {memo.description && (
                      <p className="text-sm text-[var(--color-text-secondary)] line-clamp-3 mb-4">{memo.description}</p>
                    )}
                    <a
                      href={memo.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-bg-active)] text-[var(--color-text-active)] rounded-full text-sm font-semibold hover:bg-[var(--color-text)] transition-colors"
                    >
                      Open Original
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>

                {/* Collapsible extracted content */}
                {(memo.content_text || memo.content_raw) && (
                  <div className="mt-4">
                    <button
                      onClick={() => setShowExtracted(!showExtracted)}
                      className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                    >
                      {showExtracted ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {showExtracted ? 'Hide extracted content' : 'Show extracted content'}
                    </button>
                    {showExtracted && (
                      <div className="mt-3 p-5 bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] prose prose-sm max-w-none text-[var(--color-text)]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                          code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) => (
                            inline ? (
                              <code className="bg-[var(--color-bg-code)] text-white px-1 py-0.5 rounded text-[11px] font-mono">{children}</code>
                            ) : (
                              <pre className="bg-[var(--color-bg-code)] text-white p-4 rounded-xl overflow-x-auto font-mono text-[12px] my-3">
                                <code>{children}</code>
                              </pre>
                            )
                          )
                        }}>{memo.content_raw || memo.content_text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Content body for note — rendered view by default, click to edit */}
            {memo.type === 'note' && !isEditing && (
              <div className="mb-6">
                {noteEditMode ? (
                  <div>
                    <div className="flex items-center justify-end gap-2 mb-2">
                      <button
                        onClick={async () => {
                          await memoApi.update(memo.id, { content_raw: noteDraft, content_text: noteDraft });
                          queryClient.invalidateQueries({ queryKey: ['memo', id] });
                          queryClient.invalidateQueries({ queryKey: ['memos'] });
                          setNoteEditMode(false);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-text-active)] bg-[var(--color-bg-active)] rounded-full transition-colors"
                      >
                        <Save size={14} />
                        Done
                      </button>
                      <button
                        onClick={() => setNoteEditMode(false)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
                      >
                        <X size={14} />
                        Cancel
                      </button>
                    </div>
                    <MarkdownEditor
                      value={memo.content_raw || memo.content_text || ''}
                      onChange={(val) => setNoteDraft(val)}
                      placeholder="Write your note in markdown..."
                    />
                  </div>
                ) : (
                  <div className="group relative">
                    <button
                      onClick={() => {
                        setNoteDraft(memo.content_raw || memo.content_text || '');
                        setNoteEditMode(true);
                      }}
                      className="absolute top-0 right-0 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] rounded-full transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                    {memo.content_raw || memo.content_text ? (
                      <div className="prose prose-lg dark:prose-invert max-w-none text-[var(--color-text)]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                          code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) => (
                            inline ? (
                              <code className="bg-[var(--color-bg-code)] text-white px-1 py-0.5 rounded text-[12px] font-mono">{children}</code>
                            ) : (
                              <pre className="bg-[var(--color-bg-code)] text-white p-4 rounded-xl overflow-x-auto font-mono text-[12px] my-3">
                                <code>{children}</code>
                              </pre>
                            )
                          ),
                          table: ({ children }: { children?: React.ReactNode }) => (
                            <div className="overflow-x-auto my-4">
                              <table className="min-w-full border-collapse border border-[var(--color-border)]">{children}</table>
                            </div>
                          ),
                          th: ({ children }: { children?: React.ReactNode }) => (
                            <th className="border border-[var(--color-border)] bg-[var(--color-bg-hover)] px-3 py-2 text-left font-semibold">{children}</th>
                          ),
                          td: ({ children }: { children?: React.ReactNode }) => (
                            <td className="border border-[var(--color-border)] px-3 py-2">{children}</td>
                          ),
                        }}>{memo.content_raw || memo.content_text}</ReactMarkdown>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setNoteDraft('');
                          setNoteEditMode(true);
                        }}
                        className="w-full text-left px-4 py-6 text-[var(--color-text-muted)] italic border border-dashed border-[var(--color-border)] rounded-2xl hover:bg-[var(--color-bg-hover)] transition-colors"
                      >
                        Click to write your note...
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {memo.type === 'document' && !isEditing && memo.content_text && (
              <div className="prose prose-sm max-w-none text-[var(--color-text)]">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                  code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) => (
                    inline ? (
                      <code className="bg-[var(--color-bg-code)] text-white px-1 py-0.5 rounded text-[11px] font-mono">{children}</code>
                    ) : (
                      <pre className="bg-[var(--color-bg-code)] text-white p-4 rounded-xl overflow-x-auto font-mono text-[12px] my-3">
                        <code>{children}</code>
                      </pre>
                    )
                  )
                }}>{memo.content_raw || memo.content_text}</ReactMarkdown>
              </div>
            )}

            {/* Edit: Content textarea */}
            {isEditing && (
              <div className="mb-6">
                <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2 block">Content</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={12}
                  className="w-full p-4 rounded-2xl border border-[var(--color-border)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-text)] resize-y font-mono"
                />
              </div>
            )}

            {/* Notes section */}
            <div className="mt-8 pt-6 border-t border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Pencil size={16} className="text-[var(--color-text-muted)]" />
                  <h3 className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-wider">My Notes</h3>
                </div>
                {notesSaving && <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" />}
              </div>
              <MarkdownEditor
                value={isEditing ? editNotes : notesDraft}
                onChange={isEditing ? (val) => setEditNotes(val) : (val) => setNotesDraft(val)}
                onSave={(val) => {
                  if (isEditing) return;
                  memoApi.update(memo.id, { notes: val });
                }}
                placeholder="Click to add your thoughts, annotations, or highlights..."
              />
            </div>

            {/* Related memos */}
            {!isEditing && related.length > 0 && (
              <div className="mt-10 pt-6 border-t border-[var(--color-border)]">
                <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Related Memos</h3>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {related.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => navigate(`/memo/${r.id}`)}
                      className="flex-shrink-0 w-48 p-3 border border-[var(--color-border)] rounded-2xl hover:border-[var(--color-text)] text-left transition-colors"
                    >
                      <p className="text-sm font-semibold text-[var(--color-text)] line-clamp-2">{r.title}</p>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-1 font-mono">{r.source_domain || r.type}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat pane */}
      {chatOpen && (
        <div className="w-96 border-l border-[var(--color-border)] flex flex-col">
          <AskMemoPanel memoId={id!} />
        </div>
      )}
    </div>
  );
}

function GlobeIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size || 24}
      height={size || 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
