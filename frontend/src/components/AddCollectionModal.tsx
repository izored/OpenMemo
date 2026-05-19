import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { collectionApi } from '@/lib/api';

const PRESET_EMOJIS = [
  '📁','📂','🗂️','⭐','🔖','📌',
  '💡','🔍','🎯','📝','💻','🎨',
  '📊','📈','📚','💰','✈️','🏋️',
  '🍕','🎵','🎬','💬','🔐','🛠️',
  '🏠','🌍','🎮','🔬','📱','🎭',
  '🌟','🔥','❤️','🚀','⚡','🎉',
  '💼','📷','🌱','🏆','⚽','🎪',
];

const KEYWORD_EMOJI: [RegExp, string][] = [
  [/\b(code|dev|program|script|software|tech|web|app|api)\b/i, '💻'],
  [/\b(design|ui|ux|figma|sketch|art|creative|graphic)\b/i, '🎨'],
  [/\b(book|read|learn|study|educat|course|class|school)\b/i, '📚'],
  [/\b(money|finance|budget|invest|bank|crypto|stock|wallet)\b/i, '💰'],
  [/\b(travel|trip|vacation|flight|hotel|tour)\b/i, '✈️'],
  [/\b(health|fitness|gym|workout|sport|run|diet|medical)\b/i, '🏋️'],
  [/\b(food|cook|recipe|restaurant|meal|eat|drink)\b/i, '🍕'],
  [/\b(music|song|playlist|album|artist|band|audio|podcast)\b/i, '🎵'],
  [/\b(video|movie|film|tv|series|watch|cinema|youtube)\b/i, '🎬'],
  [/\b(game|gaming|play|esport|steam|xbox|playstation)\b/i, '🎮'],
  [/\b(research|science|lab|experiment|data|analysis)\b/i, '🔬'],
  [/\b(work|job|office|career|business|meeting|project)\b/i, '💼'],
  [/\b(home|personal|life|family|house|daily)\b/i, '🏠'],
  [/\b(social|chat|team|community|friends|network)\b/i, '💬'],
  [/\b(security|crypto|password|vault|key|lock|privacy)\b/i, '🔐'],
  [/\b(photo|image|picture|gallery|camera)\b/i, '📷'],
  [/\b(note|memo|journal|diary|write|blog)\b/i, '📝'],
  [/\b(idea|thought|brain|mind|think|concept)\b/i, '💡'],
  [/\b(star|fav|important|key|main|primary)\b/i, '⭐'],
];

function deriveEmoji(name: string): string | null {
  for (const [re, emoji] of KEYWORD_EMOJI) {
    if (re.test(name)) return emoji;
  }
  return null;
}

const PRESET_COLORS = [
  '#D97706', '#DC2626', '#7C3AED', '#2563EB',
  '#059669', '#0891B2', '#DB2777', '#475569',
];

export function AddCollectionModal() {
  const { collectionModalOpen, setCollectionModalOpen, editingCollection, setEditingCollection } = useAppStore();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📁');
  const [emojiManual, setEmojiManual] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#D97706');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const isEditing = !!editingCollection;

  useEffect(() => {
    if (editingCollection) {
      setName(editingCollection.name);
      setEmoji(editingCollection.emoji || '📁');
      setEmojiManual(true);
      setDescription(editingCollection.description || '');
      setColor(editingCollection.color || '#D97706');
    } else {
      setName('');
      setEmoji('📁');
      setEmojiManual(false);
      setDescription('');
      setColor('#D97706');
    }
    setError('');
    setConfirmDelete(false);
    setPickerOpen(false);
  }, [editingCollection, collectionModalOpen]);

  // Auto-derive emoji from name unless user manually picked one
  useEffect(() => {
    if (emojiManual) return;
    const derived = deriveEmoji(name);
    setEmoji(derived ?? '📁');
  }, [name, emojiManual]);

  // Close picker on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    if (pickerOpen) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [pickerOpen]);

  const close = () => {
    setCollectionModalOpen(false);
    setEditingCollection(null);
  };

  const handleDelete = async () => {
    if (!editingCollection) return;
    setLoading(true);
    setError('');
    try {
      await collectionApi.delete(editingCollection.id);
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      close();
    } catch (e) {
      setError((e as Error).message || 'Failed to delete collection');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      if (isEditing && editingCollection) {
        await collectionApi.update(editingCollection.id, {
          name: name.trim(), emoji, description: description.trim() || null, color,
        });
      } else {
        await collectionApi.create({
          name: name.trim(), emoji, description: description.trim() || undefined, color,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      close();
    } catch (e) {
      setError((e as Error).message || 'Failed to save collection');
    } finally {
      setLoading(false);
    }
  };

  if (!collectionModalOpen) return null;

  return (
    <div className="om-modal-backdrop">
      <div className="om-modal-scrim" onClick={close} />
      <div className="om-modal om-coll-modal">
        {/* Header */}
        <div className="om-modal-header">
          <h2 className="om-modal-title">{isEditing ? 'Edit Collection' : 'New Collection'}</h2>
          <button className="om-icon-btn" onClick={close}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="om-modal-body">
          {error && <div className="om-modal-error">{error}</div>}

          {/* Emoji + Name row */}
          <div className="om-coll-row">
            <div className="om-coll-emoji-wrap" ref={pickerRef}>
              <label className="om-field-label">Emoji</label>
              <button
                className="om-coll-emoji-btn"
                onClick={() => setPickerOpen((v) => !v)}
                type="button"
              >
                {emoji}
              </button>
              {pickerOpen && (
                <div className="om-emoji-picker">
                  {PRESET_EMOJIS.map((e) => (
                    <button
                      key={e}
                      className={`om-emoji-opt${emoji === e ? ' active' : ''}`}
                      onClick={() => { setEmoji(e); setEmojiManual(true); setPickerOpen(false); }}
                      type="button"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label className="om-field-label">Name</label>
              <input
                className="om-input om-input-pill"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Collection name"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="om-field-label">Description</label>
            <textarea
              className="om-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={3}
            />
          </div>

          {/* Color */}
          <div>
            <label className="om-field-label">Color</label>
            <div className="om-color-row">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`om-color-swatch${color === c ? ' active' : ''}`}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  type="button"
                />
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            className="om-btn-full"
            onClick={handleSubmit}
            disabled={loading || !name.trim()}
            type="button"
          >
            {loading && <Loader2 size={15} className="om-spin" />}
            {isEditing ? 'Save Changes' : 'Create Collection'}
          </button>

          {isEditing && (
            <div className="om-coll-danger">
              {!confirmDelete ? (
                <button className="om-btn-danger-ghost" onClick={() => setConfirmDelete(true)} type="button">
                  Delete collection
                </button>
              ) : (
                <div className="om-coll-confirm">
                  <p className="om-coll-confirm-text">
                    Delete <b>{editingCollection?.name}</b>? Memos are kept, only the collection is removed.
                  </p>
                  <div className="om-coll-confirm-row">
                    <button className="om-btn-cancel" onClick={() => setConfirmDelete(false)} type="button">Cancel</button>
                    <button className="om-btn-delete" onClick={handleDelete} disabled={loading} type="button">
                      {loading && <Loader2 size={15} className="om-spin" />}
                      Delete forever
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
