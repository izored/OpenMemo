import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { collectionApi } from '@/lib/api';
import { deriveCollectionEmoji } from '@/lib/collectionEmoji';

const PRESET_EMOJIS = [
  '📁','📂','🗂️','⭐','🔖','📌',
  '💡','🔍','🎯','📝','💻','🎨',
  '📊','📈','📚','💰','✈️','🏋️',
  '🍕','🎵','🎬','💬','🔐','🛠️',
  '🏠','🌍','🎮','🔬','📱','🎭',
  '🌟','🔥','❤️','🚀','⚡','🎉',
  '💼','📷','🌱','🏆','⚽','🎪',
];

const PRESET_COLORS = [
  '#D97706', '#DC2626', '#7C3AED', '#2563EB',
  '#059669', '#0891B2', '#DB2777', '#475569',
];

export function AddCollectionModal() {
  const { collectionModalOpen, setCollectionModalOpen, editingCollection, setEditingCollection, setLastCreatedCollectionId, activeSpace } = useAppStore();
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional form sync when the modal opens / edit target changes
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
    const derived = deriveCollectionEmoji(name);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional emoji derivation from the name field
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
        const created = await collectionApi.create({
          // A collection created while inside a Space belongs to that Space
          // (ADR-020); otherwise it lands in the main library.
          name: name.trim(), emoji, description: description.trim() || undefined, color,
          workspace_id: activeSpace || undefined,
        });
        // Let an open surface (AddMemoPanel) auto-select the new collection so
        // the user doesn't have to reopen the picker and select it again.
        if (created?.id) setLastCreatedCollectionId(created.id);
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
