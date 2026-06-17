import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';
import { spaceApi } from '@/lib/api';

const PRESET_EMOJIS = [
  '🗂️','📁','🚀','🧠','🔬','🎯',
  '💼','🎨','💻','📚','🎵','🎬',
  '🏗️','🧪','📐','🗺️','🛠️','🌱',
  '🔥','⚡','🌟','🏆','🎮','📷',
];

const PRESET_COLORS = [
  '#6366F1', '#7C3AED', '#2563EB', '#0891B2',
  '#059669', '#D97706', '#DC2626', '#DB2777',
];

function band(color: string): string {
  const c = color || '#6366F1';
  return `linear-gradient(120deg, ${c} 0%, color-mix(in oklab, ${c} 58%, #14131c) 70%, color-mix(in oklab, ${c} 30%, #0c0b12) 100%)`;
}

type DeletePhase = 'idle' | 'arm' | 'type';

export function AddSpaceModal() {
  const { spaceModalOpen, setSpaceModalOpen, editingSpace, setEditingSpace, activeSpace, setActiveSpace } = useAppStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🗂️');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6366F1');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deletePhase, setDeletePhase] = useState<DeletePhase>('idle');
  const [confirmText, setConfirmText] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!editingSpace;
  const counts = editingSpace?.counts;
  const existingCover = !removeCover ? editingSpace?.cover_url : null;
  const shownCover = coverPreview || existingCover || null;

  useEffect(() => {
    if (editingSpace) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional form sync when the modal opens / edit target changes
      setName(editingSpace.name);
      setEmoji(editingSpace.emoji || '🗂️');
      setDescription(editingSpace.description || '');
      setColor(editingSpace.color || '#6366F1');
    } else {
      setName('');
      setEmoji('🗂️');
      setDescription('');
      setColor('#6366F1');
    }
    setError('');
    setDeletePhase('idle');
    setConfirmText('');
    setBackedUp(false);
    setPickerOpen(false);
    setCoverFile(null);
    setCoverPreview(null);
    setRemoveCover(false);
  }, [editingSpace, spaceModalOpen]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    if (pickerOpen) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [pickerOpen]);

  // Revoke the object URL when the preview changes / unmounts.
  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);

  const close = () => {
    setSpaceModalOpen(false);
    setEditingSpace(null);
  };

  const onPickCover = (f: File | null) => {
    if (!f) return;
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverFile(f);
    setCoverPreview(URL.createObjectURL(f));
    setRemoveCover(false);
  };

  const clearCover = () => {
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverFile(null);
    setCoverPreview(null);
    setRemoveCover(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      let id = editingSpace?.id;
      if (isEditing && editingSpace) {
        await spaceApi.update(editingSpace.id, {
          name: name.trim(), emoji, description: description.trim(), color,
        });
      } else {
        const created = await spaceApi.create({
          name: name.trim(), emoji, description: description.trim() || undefined, color,
        });
        id = created.id;
      }
      // Cover changes ride after the row exists (the endpoint needs an id).
      if (id) {
        if (coverFile) await spaceApi.uploadCover(id, coverFile);
        else if (removeCover && isEditing) await spaceApi.deleteCover(id);
      }
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      queryClient.invalidateQueries({ queryKey: ['space'] });
      close();
    } catch (e) {
      setError((e as Error).message || 'Failed to save Space');
    } finally {
      setLoading(false);
    }
  };

  const handleBackup = async () => {
    if (!editingSpace) return;
    setError('');
    try {
      await spaceApi.exportZip(editingSpace.id, editingSpace.name);
      setBackedUp(true);
    } catch (e) {
      setError((e as Error).message || 'Backup failed');
    }
  };

  const handleDelete = async () => {
    if (!editingSpace) return;
    setLoading(true);
    setError('');
    try {
      await spaceApi.delete(editingSpace.id, confirmText.trim());
      if (activeSpace === editingSpace.id) {
        setActiveSpace(null);
        navigate('/spaces');
      }
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      close();
    } catch (e) {
      setError((e as Error).message || 'Delete refused');
    } finally {
      setLoading(false);
    }
  };

  if (!spaceModalOpen) return null;

  const nameMatches = confirmText.trim() === (editingSpace?.name || '').trim();

  return (
    <div className="om-modal-backdrop">
      <div className="om-modal-scrim" onClick={close} />
      <div className="om-space-modal">
        {/* Cover band — full-bleed, with the emoji tile overlapping it. */}
        <div
          className="om-spm-cover"
          style={shownCover ? { backgroundImage: `url(${shownCover})` } : { background: band(color) }}
        >
          <button className="om-spm-close" onClick={close} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
          <div className="om-spm-cover-actions">
            <button className="om-spm-cover-btn" onClick={() => coverInputRef.current?.click()} type="button">
              <Icon name="image" size={12} />
              <span>{shownCover ? 'Change cover' : 'Add cover'}</span>
            </button>
            {shownCover && (
              <button className="om-spm-cover-btn" onClick={clearCover} type="button" title="Remove cover">
                <Icon name="trash" size={12} />
              </button>
            )}
          </div>
          <div className="om-spm-emoji-wrap" ref={pickerRef}>
            <button className="om-spm-emoji" onClick={() => setPickerOpen((v) => !v)} type="button" title="Change icon">
              {emoji}
            </button>
            {pickerOpen && (
              <div className="om-emoji-picker om-spm-emoji-picker">
                {PRESET_EMOJIS.map((e) => (
                  <button
                    key={e}
                    className={`om-emoji-opt${emoji === e ? ' active' : ''}`}
                    onClick={() => { setEmoji(e); setPickerOpen(false); }}
                    type="button"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onPickCover(e.target.files?.[0] || null)}
        />

        <div className="om-spm-body">
          {error && <div className="om-modal-error">{error}</div>}

          <input
            className="om-spm-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled Space"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />

          <textarea
            className="om-spm-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description…"
            rows={2}
          />

          {!shownCover && (
            <div className="om-spm-field">
              <label className="om-field-label">Accent color</label>
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
          )}

          <button className="om-btn-full" onClick={handleSubmit} disabled={loading || !name.trim()} type="button">
            {loading && deletePhase === 'idle' && <Loader2 size={15} className="om-spin" />}
            {isEditing ? 'Save Changes' : 'Create Space'}
          </button>

          {isEditing && (
            <div className="om-spm-danger">
              {deletePhase === 'idle' && (
                <button className="om-spm-danger-link" onClick={() => setDeletePhase('arm')} type="button">
                  <Icon name="trash" size={12} />
                  <span>Delete this Space</span>
                </button>
              )}

              {deletePhase === 'arm' && (
                <div className="om-spm-confirm">
                  <p className="om-spm-confirm-text">
                    Deleting <b>{editingSpace?.name}</b> erases <b>everything</b> inside it:
                    {' '}<b>{counts?.memos ?? 0} memo{counts?.memos === 1 ? '' : 's'}</b> and
                    {' '}<b>{counts?.collections ?? 0} collection{counts?.collections === 1 ? '' : 's'}</b>.
                    This cannot be undone. Back it up first.
                  </p>
                  <button
                    className={`om-spm-backup${backedUp ? ' done' : ''}`}
                    onClick={handleBackup}
                    type="button"
                  >
                    <Icon name={backedUp ? 'check' : 'download'} size={13} />
                    <span>{backedUp ? 'Backup downloaded' : 'Download backup (.zip)'}</span>
                  </button>
                  <div className="om-spm-confirm-row">
                    <button className="om-btn-cancel" onClick={() => setDeletePhase('idle')} type="button">Cancel</button>
                    <button className="om-spm-continue" onClick={() => setDeletePhase('type')} type="button">
                      I understand, continue
                    </button>
                  </div>
                </div>
              )}

              {deletePhase === 'type' && (
                <div className="om-spm-confirm">
                  <p className="om-spm-confirm-text">
                    Type <b>{editingSpace?.name}</b> to permanently delete this Space and all of its memos.
                  </p>
                  <input
                    className="om-input om-input-pill"
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={editingSpace?.name}
                    autoFocus
                  />
                  <div className="om-spm-confirm-row">
                    <button className="om-btn-cancel" onClick={() => { setDeletePhase('idle'); setConfirmText(''); }} type="button">Cancel</button>
                    <button className="om-btn-delete" onClick={handleDelete} disabled={loading || !nameMatches} type="button">
                      {loading && <Loader2 size={15} className="om-spin" />}
                      Delete everything
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
