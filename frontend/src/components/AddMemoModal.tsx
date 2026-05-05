import { useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Link2, FileText, Upload, Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { ingestApi } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'link' | 'note' | 'file' | 'voice';

export function AddMemoModal() {
  const { addModalOpen, setAddModalOpen } = useAppStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('link');
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
    } catch (e: any) {
      setError(e.message || 'Failed to save link');
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
    } catch (e: any) {
      setError(e.message || 'Failed to save note');
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
    } catch (e: any) {
      setError(e.message || 'Failed to upload file');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  }, []);

  if (!addModalOpen) return null;

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'link', label: 'Link', icon: Link2 },
    { id: 'note', label: 'Note', icon: FileText },
    { id: 'file', label: 'File', icon: Upload },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={close} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden border border-[#e5e5e5]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5]">
          <h2 className="text-lg font-semibold text-[#202020] tracking-tight">Add New Memo</h2>
          <button onClick={close} className="p-1.5 rounded-full hover:bg-[#f5f5f5] transition-colors">
            <X size={18} className="text-[#646464]" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#e5e5e5]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setError(''); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-[#ea2804] border-b-2 border-[#ea2804]'
                  : 'text-[#646464] hover:text-[#202020]'
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
                <label className="block text-sm font-semibold text-[#202020] mb-1.5">URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  className="w-full px-4 py-2.5 border border-[#e5e5e5] rounded-full text-sm focus:outline-none focus:border-[#202020] transition-colors"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveLink()}
                />
              </div>
              <button
                onClick={handleSaveLink}
                disabled={loading || !url.trim()}
                className="w-full py-2.5 bg-[#202020] text-white rounded-full text-sm font-semibold hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
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
                <label className="block text-sm font-semibold text-[#202020] mb-1.5">Title</label>
                <input
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="My note title"
                  className="w-full px-4 py-2.5 border border-[#e5e5e5] rounded-full text-sm focus:outline-none focus:border-[#202020] transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#202020] mb-1.5">Content</label>
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Write your note here... (Markdown supported)"
                  rows={6}
                  className="w-full px-4 py-2.5 border border-[#e5e5e5] rounded-xl text-sm focus:outline-none focus:border-[#202020] resize-none transition-colors"
                />
              </div>
              <button
                onClick={handleSaveNote}
                disabled={loading || !noteTitle.trim()}
                className="w-full py-2.5 bg-[#202020] text-white rounded-full text-sm font-semibold hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
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
                  dragOver ? 'border-[#ea2804] bg-[#FEE4E0]' : 'border-[#e5e5e5] hover:border-[#202020]'
                )}
              >
                <Upload size={32} className="mx-auto mb-3 text-[#8d8d8d]" />
                <p className="text-sm font-semibold text-[#202020]">
                  Drop files here or click to browse
                </p>
                <p className="text-xs text-[#8d8d8d] mt-1">
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
                <div className="flex items-center justify-center gap-2 text-sm text-[#646464]">
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
