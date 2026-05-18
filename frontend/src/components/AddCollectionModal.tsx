import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { collectionApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const presetColors = [
  '#D97706', '#DC2626', '#7C3AED', '#2563EB',
  '#059669', '#0891B2', '#DB2777', '#475569',
];

export function AddCollectionModal() {
  const { collectionModalOpen, setCollectionModalOpen, editingCollection, setEditingCollection } = useAppStore();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📁');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#D97706');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isEditing = !!editingCollection;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (editingCollection) {
      setName(editingCollection.name);
      setEmoji(editingCollection.emoji || '📁');
      setDescription(editingCollection.description || '');
      setColor(editingCollection.color || '#D97706');
    } else {
      setName('');
      setEmoji('📁');
      setDescription('');
      setColor('#D97706');
    }
    setError('');
    setConfirmDelete(false);
  }, [editingCollection, collectionModalOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
          name: name.trim(),
          emoji,
          description: description.trim() || null,
          color,
        });
      } else {
        await collectionApi.create({
          name: name.trim(),
          emoji,
          description: description.trim() || undefined,
          color,
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={close} />

      {/* Modal */}
      <div className="relative bg-[var(--surface)] rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden border border-[var(--color-border)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold text-[var(--color-text)] tracking-tight">
            {isEditing ? 'Edit Collection' : 'New Collection'}
          </h2>
          <button onClick={close} className="p-1.5 rounded-full hover:bg-[var(--surface-2)] transition-colors">
            <X size={18} className="text-[var(--text-2)]" />
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Name + Emoji row */}
          <div className="flex gap-3">
            <div className="flex-shrink-0">
              <label className="block text-sm font-semibold text-[var(--color-text)] mb-1.5">Emoji</label>
              <input
                type="text"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                className="w-14 h-11 text-center text-xl border border-[var(--color-border)] rounded-xl focus:outline-none focus:border-[var(--color-text)] transition-colors bg-[var(--surface)]"
                maxLength={2}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-semibold text-[var(--color-text)] mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Collection name"
                className="w-full px-4 py-2.5 border border-[var(--color-border)] rounded-full text-sm focus:outline-none focus:border-[var(--color-text)] transition-colors bg-[var(--surface)]"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-[var(--color-text)] mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
              className="w-full px-4 py-2.5 border border-[var(--color-border)] rounded-xl text-sm focus:outline-none focus:border-[var(--color-text)] resize-none transition-colors bg-[var(--surface)]"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-semibold text-[var(--color-text)] mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {presetColors.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-8 h-8 rounded-full border-2 transition-all',
                    color === c ? 'border-[var(--color-text)] scale-110' : 'border-transparent hover:scale-105'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading || !name.trim()}
            className="w-full py-2.5 bg-[var(--text)] text-[var(--bg)] rounded-full text-sm font-semibold hover:bg-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {isEditing ? 'Save Changes' : 'Create Collection'}
          </button>

          {isEditing && (
            <div className="pt-4 mt-1 border-t border-[var(--color-border)]">
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full py-2.5 rounded-full text-sm font-semibold text-red-600 border border-red-500/30 hover:bg-red-500/10 transition-colors"
                >
                  Delete collection
                </button>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-[12px] text-[var(--text-2)] leading-relaxed">
                    Delete <b>{editingCollection?.name}</b>? Memos are kept, only the
                    collection is removed. Consider exporting a backup first
                    (Settings → Danger zone → Export).
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-2.5 rounded-full text-sm font-semibold border border-[var(--color-border)] hover:bg-[var(--surface-2)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={loading}
                      className="flex-1 py-2.5 rounded-full text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                    >
                      {loading && <Loader2 size={16} className="animate-spin" />}
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
