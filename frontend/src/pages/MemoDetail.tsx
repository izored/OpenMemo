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
  const [noteContent, setNoteContent] = useState('');
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
      setNoteContent(memo.content_raw || memo.content_text || '');
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
      <div className="om-detail-loading">
        <div className="om-detail-spinner" />
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="om-detail-loading">
        <p className="om-detail-desc">Memo not found</p>
      </div>
    );
  }

  const youtubeId = memo.type === 'video' && memo.source_url ? getYouTubeVideoId(memo.source_url) : null;
  const isWebType = memo.type === 'article' || memo.type === 'link';

  return (
    <div className="om-detail-page">
      {/* Content pane */}
      <div className="om-detail-pane">
        {/* Header */}
        <header className="om-detail-top">
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="om-section-h">{memo.type}</span>
          </div>
          <div className="om-detail-actions">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="om-btn-ghost om-btn-pill"
              >
                <Pencil size={14} />
                Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="om-btn-primary om-btn-pill"
                  style={saving ? { opacity: 0.5 } : undefined}
                >
                  {saving ? <Loader2 size={14} className="om-spin" /> : <Save size={14} />}
                  Save
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="om-btn-ghost om-btn-pill"
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
                className="om-btn-ghost om-btn-pill"
              >
                <ExternalLink size={14} />
                Open Original
              </a>
            )}
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`om-icon-btn${chatOpen ? ' active' : ''}`}
            >
              <MessageSquare size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="om-detail-scroll">
          <div className="om-detail-content">
            {/* Back button */}
            <div style={{ marginBottom: '12px' }}>
              <BackButton />
            </div>

            {/* Title */}
            {isEditing ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="om-detail-title-input"
                style={{ marginBottom: '8px' }}
              />
            ) : (
              <h1 className="om-detail-title" style={{ marginBottom: '8px' }}>{memo.title}</h1>
            )}

            {/* Meta */}
            <div className="om-detail-meta" style={{ marginBottom: '24px' }}>
              <span className="mono" style={{ fontSize: '11px', color: 'var(--text-4)' }}>
                {new Date(memo.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
              {memo.source_domain && !isEditing && (
                <>
                  <span style={{ color: 'var(--text-4)' }}>•</span>
                  <a
                    href={memo.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="om-source link-dotted"
                  >
                    {memo.source_favicon && <img src={memo.source_favicon} alt="" style={{ width: '16px', height: '16px', borderRadius: '50%' }} />}
                    {memo.source_domain}
                    <ExternalLink size={12} />
                  </a>
                </>
              )}
              {isEditing && (
                <>
                  <span style={{ color: 'var(--text-4)' }}>•</span>
                  <input
                    value={editSourceUrl}
                    onChange={(e) => setEditSourceUrl(e.target.value)}
                    placeholder="Source URL"
                    className="om-detail-url-input"
                  />
                </>
              )}
              {!isEditing && memo.tags?.length > 0 && (
                <>
                  <span style={{ color: 'var(--text-4)' }}>•</span>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {memo.tags.map((tag: string) => (
                      <span key={tag} className="om-tag">{tag}</span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Edit: Tags */}
            {isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <div className="om-notes-label" style={{ marginBottom: '8px' }}>
                  <Tag size={14} className="om-section-icon" />
                  <span className="om-section-h">Tags</span>
                </div>
                <div className="om-detail-tags">
                  {editTags.map((tag) => (
                    <span key={tag} className="om-tag-edit">
                      {tag}
                      <button onClick={() => removeTag(tag)}><X size={12} /></button>
                    </span>
                  ))}
                  <span className="om-tag-add">
                    <input
                      value={editTagInput}
                      onChange={(e) => setEditTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                      placeholder="Add tag..."
                      style={{ background: 'none', border: 0, outline: 'none', font: 'inherit', color: 'inherit', minWidth: '80px' }}
                    />
                  </span>
                </div>
              </div>
            )}

            {/* Edit: Collections */}
            {isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <div className="om-notes-label" style={{ marginBottom: '8px' }}>
                  <Folder size={14} className="om-section-icon" />
                  <span className="om-section-h">Collections</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {collections.map((col: Collection) => (
                    <button
                      key={col.id}
                      onClick={() => toggleCollection(col.id)}
                      className={`om-coll-chip${editCollectionIds.includes(col.id) ? ' active' : ''}`}
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
                  <div className="om-ai-summary" style={{ marginBottom: '24px' }}>
                    <div className="om-ai-summary-head">
                      <Sparkles size={16} className="om-accent-icon" />
                      <span className="om-ai-summary-label">AI Summary</span>
                    </div>
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.ai_summary}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleGenerateSummary}
                    disabled={generatingSummary}
                    className="om-btn-ghost om-btn-pill"
                    style={{ marginBottom: '24px', opacity: generatingSummary ? 0.4 : undefined }}
                  >
                    {generatingSummary ? <Loader2 size={14} className="om-spin" /> : <Sparkles size={14} />}
                    Generate AI Summary
                  </button>
                )}
              </>
            )}

            {/* Thumbnail / Image */}
            {memo.type === 'image' && memo.file_path && !isEditing && (
              <div className="om-image-memo" style={{ marginBottom: '24px' }}>
                <img src={`/api/files/${memo.file_path}`} alt={memo.title} />
              </div>
            )}

            {/* Video */}
            {youtubeId && !isEditing && (
              <div className="om-video-embed" style={{ marginBottom: '24px' }}>
                <iframe
                  src={`https://www.youtube.com/embed/${youtubeId}`}
                  allowFullScreen
                  title={memo.title}
                />
              </div>
            )}

            {/* Rich Web Preview for article/link */}
            {isWebType && !isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <div className="om-web-card">
                  {memo.thumbnail_path && (
                    <div className="om-web-card-thumb">
                      <img src={memo.thumbnail_path} alt="" />
                    </div>
                  )}
                  <div className="om-web-card-body">
                    <div className="om-web-card-source">
                      {memo.source_favicon ? (
                        <img src={memo.source_favicon} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
                      ) : (
                        <GlobeIcon size={18} className="om-section-icon" />
                      )}
                      <span className="om-web-card-domain">{memo.source_domain || 'Website'}</span>
                    </div>
                    <h2 className="om-web-card-title">{memo.title}</h2>
                    {memo.description && (
                      <p className="om-web-card-desc">{memo.description}</p>
                    )}
                    <a
                      href={memo.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="om-btn-primary om-btn-pill"
                      style={{ alignSelf: 'flex-start' }}
                    >
                      Open Original
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>

                {/* Collapsible extracted content */}
                {(memo.content_text || memo.content_raw) && (
                  <div style={{ marginTop: '16px' }}>
                    <button
                      onClick={() => setShowExtracted(!showExtracted)}
                      className="om-extracted-toggle"
                    >
                      {showExtracted ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {showExtracted ? 'Hide extracted content' : 'Show extracted content'}
                    </button>
                    {showExtracted && (
                      <div className="om-extracted-body prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                          code: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
                            <code className={`om-code-inline ${className || ''}`}>{children}</code>
                          ),
                          pre: ({ children }: { children?: React.ReactNode }) => (
                            <pre className="om-code-block">{children}</pre>
                          )
                        }}>{memo.content_raw || memo.content_text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Content body for note */}
            {memo.type === 'note' && !isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <MarkdownEditor
                  viewFirst
                  value={noteContent}
                  onSave={(val) => {
                    setNoteContent(val);
                    memoApi.update(memo.id, { content_raw: val, content_text: val }).then(() => {
                      queryClient.invalidateQueries({ queryKey: ['memo', id] });
                      queryClient.invalidateQueries({ queryKey: ['memos'] });
                    });
                  }}
                  placeholder="Click to write your note..."
                />
              </div>
            )}

            {/* Document content */}
            {memo.type === 'document' && !isEditing && memo.content_text && (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
                    <code className={`om-code-inline ${className || ''}`}>{children}</code>
                  ),
                  pre: ({ children }: { children?: React.ReactNode }) => (
                    <pre className="om-code-block">{children}</pre>
                  )
                }}>{memo.content_raw || memo.content_text}</ReactMarkdown>
              </div>
            )}

            {/* Edit: Content */}
            {isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <label className="om-field-label-block">Content</label>
                <MarkdownEditor
                  value={editContent}
                  onChange={(val) => setEditContent(val)}
                  placeholder="Write content..."
                />
              </div>
            )}

            {/* Notes section */}
            <div className="om-notes-section">
              <div className="om-notes-head">
                <div className="om-notes-label">
                  <Pencil size={16} className="om-section-icon" />
                  <h3 className="om-section-h">My Notes</h3>
                </div>
                {notesSaving && <Loader2 size={14} className="om-section-icon om-spin" />}
              </div>
              <MarkdownEditor
                viewFirst={!isEditing}
                value={isEditing ? editNotes : notesDraft}
                onChange={isEditing ? (val) => setEditNotes(val) : (val) => setNotesDraft(val)}
                onSave={(val) => {
                  if (isEditing) return;
                  memoApi.update(memo.id, { notes: val }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['memo', id] });
                  });
                }}
                placeholder="Click to add your thoughts, annotations, or highlights..."
              />
            </div>

            {/* Related memos */}
            {!isEditing && related.length > 0 && (
              <div className="om-related">
                <h3 className="om-section-h">Related Memos</h3>
                <div className="om-related-strip">
                  {related.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => navigate(`/memo/${r.id}`)}
                      className="om-related-card"
                    >
                      <p className="om-related-card-title">{r.title}</p>
                      <p className="om-related-card-meta">{r.source_domain || r.type}</p>
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
        <div className="om-detail-chat">
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
