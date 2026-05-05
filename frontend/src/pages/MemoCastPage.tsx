import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Radio, Play, Pause, Loader2, Clock, FileText } from 'lucide-react';
import { memocastApi } from '@/lib/api';
import ReactMarkdown from 'react-markdown';

export function MemoCastPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [playing, setPlaying] = useState(false);

  const { data: episodes = [], isLoading } = useQuery({
    queryKey: ['memocasts'],
    queryFn: memocastApi.list,
  });

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await memocastApi.create();
      queryClient.invalidateQueries({ queryKey: ['memocasts'] });
      setSelectedEpisode(result);
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-2">
          <Radio size={20} className="text-[#D97706]" />
          <h1 className="text-xl font-semibold text-[#1F2937]">MemoCast</h1>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 bg-[#D97706] text-white rounded-lg text-sm font-medium hover:bg-[#B45309] disabled:opacity-50"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Radio size={16} />}
          Generate Episode
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Episodes list */}
        <div className="w-80 border-r border-[#E5E7EB] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-[#D97706]" />
            </div>
          ) : episodes.length === 0 ? (
            <div className="p-6 text-center">
              <Radio size={32} className="mx-auto mb-3 text-[#9CA3AF]" />
              <p className="text-sm text-[#6B7280]">No episodes yet</p>
              <p className="text-xs text-[#9CA3AF] mt-1">Generate your first MemoCast from recent saves</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E5E7EB]">
              {episodes.map((ep: any) => (
                <button
                  key={ep.id}
                  onClick={() => setSelectedEpisode(ep)}
                  className={`w-full text-left p-4 hover:bg-[#F3F4F6] transition-colors ${selectedEpisode?.id === ep.id ? 'bg-[#FEF3C7]' : ''}`}
                >
                  <p className="text-sm font-medium text-[#1F2937] line-clamp-2">{ep.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-[#9CA3AF]">
                    <Clock size={12} />
                    <span>{ep.duration ? `${Math.floor(ep.duration / 60)}:${(ep.duration % 60).toString().padStart(2, '0')}` : 'Generating...'}</span>
                    <span>•</span>
                    <span>{new Date(ep.created_at).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Episode detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedEpisode ? (
            <div className="max-w-2xl mx-auto">
              {/* Player card */}
              <div className="bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A] rounded-2xl p-6 mb-6">
                <h2 className="text-lg font-semibold text-[#92400E] mb-2">{selectedEpisode.title}</h2>
                <div className="flex items-center gap-3 text-sm text-[#92400E]/70">
                  <span>{new Date(selectedEpisode.created_at).toLocaleDateString()}</span>
                  {selectedEpisode.duration && (
                    <span>{Math.floor(selectedEpisode.duration / 60)}:{(selectedEpisode.duration % 60).toString().padStart(2, '0')}</span>
                  )}
                </div>

                {/* Play controls */}
                <div className="flex items-center gap-4 mt-4">
                  <button
                    onClick={() => setPlaying(!playing)}
                    className="w-12 h-12 rounded-full bg-[#D97706] text-white flex items-center justify-center hover:bg-[#B45309]"
                  >
                    {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                  </button>
                  <div className="flex-1 h-1.5 bg-[#D97706]/20 rounded-full">
                    <div className="h-full w-0 bg-[#D97706] rounded-full" />
                  </div>
                </div>
              </div>

              {/* Script / Transcript */}
              {selectedEpisode.script_text && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={16} className="text-[#6B7280]" />
                    <h3 className="text-sm font-medium text-[#374151]">Transcript</h3>
                  </div>
                  <div className="prose prose-sm max-w-none text-[#374151] bg-[#F9FAFB] rounded-xl p-4">
                    <ReactMarkdown>{selectedEpisode.script_text}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Radio size={40} className="text-[#D1D5DB] mb-4" />
              <p className="text-sm text-[#6B7280]">Select an episode or generate a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
