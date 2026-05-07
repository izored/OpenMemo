import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Link2, FileText, Upload, Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { ingestApi } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'link' | 'note' | 'file' | 'voice';

export function AddMemoModal() {
  const { addModalOpen, setAddModalOpen, addModalTab } = useAppStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('link');

  // Sync tab when modal opens (set by SpeedDialFAB before opening)
  useEffect(() => { if (addModalOpen) setActiveTab(addModalTab as Tab); }, [addModalOpen]); // eslint-disable-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Link state
  const [url, setUrl] = useState('');

  // Note state
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');

  // File state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setUrl('');
    setNoteTitle('');
    setNoteContent('');
    setError('');
    setLoading(false);
  };

  const close = () => {
    reset();
    setAddModalOpen(false);
  };

  const handleSaveLink = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    try {
      await ingestApi.url(url.trim());
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      close();
    } catch (e) {
      setError((e as Error).message || 'Failed to save link');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNote = async () => {
    if (!noteTitle.trim()) return;
    setLoading(true);
    setError('');
    try {
      await ingestApi.note(noteTitle.trim(), noteContent);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      close();
    } catch (e) {
      setError((e as Error).message || 'Failed to save note');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        await ingestApi.file(file);
      }
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      close();
    } catch (e) {
      setError((e as Error).message || 'Failed to upload file');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!addModalOpen) return null;

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'link', label: 'Link', icon: Link2 },
    { id: 'note', label: 'Note', icon: FileText },
    { id: 'file', label: 'File', icon: Upload },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={close} />

      {/* Modal */}
      <div className="relative bg-[var(--color-bg-card)] rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden border border-[var(--color-border)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold text-[var(--color-text)] tracking-tight">Add New Memo</h2>
          <button onClick={close} className="p-1.5 rounded-full hover:bg-[var(--color-bg-hover)] transition-colors">
            <X size={18} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border)]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setError(''); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-[var(--color-brand)] border-b-2 border-[var(--color-brand)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              )}
            >
              <tab.icon size={15} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Link Tab */}
          {activeTab === 'link' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text)] mb-1.5">URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  className="w-full px-4 py-2.5 border border-[var(--color-border)] rounded-full text-sm focus:outline-none focus:border-[var(--color-text)] transition-colors bg-[var(--color-bg-card)]"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveLink()}
                />
              </div>
              <button
                onClick={handleSaveLink}
                disabled={loading || !url.trim()}
                className="w-full py-2.5 bg-[var(--color-bg-active)] text-[var(--color-text-active)] rounded-full text-sm font-semibold hover:bg-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                Save Link
              </button>
            </div>
          )}

          {/* Note Tab */}
          {activeTab === 'note' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text)] mb-1.5">Title</label>
                <input
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="My note title"
                  className="w-full px-4 py-2.5 border border-[var(--color-border)] rounded-full text-sm focus:outline-none focus:border-[var(--color-text)] transition-colors bg-[var(--color-bg-card)]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text)] mb-1.5">Content</label>
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Write your note here... (Markdown supported)"
                  rows={6}
                  className="w-full px-4 py-2.5 border border-[var(--color-border)] rounded-xl text-sm focus:outline-none focus:border-[var(--color-text)] resize-none transition-colors bg-[var(--color-bg-card)]"
                />
              </div>
              <button
                onClick={handleSaveNote}
                disabled={loading || !noteTitle.trim()}
                className="w-full py-2.5 bg-[var(--color-bg-active)] text-[var(--color-text-active)] rounded-full text-sm font-semibold hover:bg-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                Save Note
              </button>
            </div>
          )}

          {/* File Tab */}
          {activeTab === 'file' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors',
                  dragOver ? 'border-[var(--color-brand)] bg-[var(--color-brand-light)]' : 'border-[var(--color-border)] hover:border-[var(--color-text)]'
                )}
              >
                <Upload size={32} className="mx-auto mb-3 text-[var(--color-text-muted)]" />
                <p className="text-sm font-semibold text-[var(--color-text)]">
                  Drop files here or click to browse
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  PDF, DOC, XLSX, Images, Audio (up to 50MB)
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xlsx,.xls,.png,.jpg,.jpeg,.gif,.webp,.mp3,.wav,.m4a"
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
              {loading && (
                <div className="flex items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <Loader2 size={16} className="animate-spin" />
                  Uploading...
                </div>
              )}
            </div>
          )}


        </div>
      </div>
    </div>
  );
}
