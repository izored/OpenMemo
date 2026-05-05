import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Radio, Play, Pause, Loader2, Clock, FileText } from 'lucide-react';
import { memocastApi } from '@/lib/api';
import ReactMarkdown from 'react-markdown';

export function MemoCastPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [selectedEpisode]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 pl-14 border-b border-[#e5e5e5]">
        <div className="flex items-center gap-2.5">
          <Radio size={20} className="text-[#ea2804]" />
          <h1 className="text-xl font-semibold text-[#202020] tracking-tight">MemoCast</h1>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 px-5 py-2 bg-[#202020] text-white rounded-full text-sm font-semibold hover:bg-black disabled:opacity-40 transition-colors"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Radio size={16} />}
          Generate Episode
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Episodes list */}
        <div className="w-80 border-r border-[#e5e5e5] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-[#ea2804]" />
            </div>
          ) : episodes.length === 0 ? (
            <div className="p-6 text-center">
              <Radio size={32} className="mx-auto mb-3 text-[#8d8d8d]" />
              <p className="text-sm text-[#646464]">No episodes yet</p>
              <p className="text-xs text-[#8d8d8d] mt-1">Generate your first MemoCast from recent saves</p>
            </div>
          ) : (
            <div className="divide-y divide-[#e5e5e5]">
              {episodes.map((ep: any) => (
                <button
                  key={ep.id}
                  onClick={() => setSelectedEpisode(ep)}
                  className={`w-full text-left p-4 hover:bg-[#f5f5f5] transition-colors ${selectedEpisode?.id === ep.id ? 'bg-[#FEE4E0]' : ''}`}
                >
                  <p className="text-sm font-semibold text-[#202020] line-clamp-2">{ep.title}</p>
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-[#8d8d8d] font-mono">
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
              <div className="bg-[#202020] rounded-2xl p-6 mb-6 text-white">
                <h2 className="text-lg font-semibold mb-2 tracking-tight">{selectedEpisode.title}</h2>
                <div className="flex items-center gap-3 text-sm text-[#bbbbbb] font-mono">
                  <span>{new Date(selectedEpisode.created_at).toLocaleDateString()}</span>
                  {selectedEpisode.duration && (
                    <span>{Math.floor(selectedEpisode.duration / 60)}:{(selectedEpisode.duration % 60).toString().padStart(2, '0')}</span>
                  )}
                </div>

                {/* Audio element */}
                {selectedEpisode.audio_path && (
                  <audio ref={audioRef} src={`/api/files/${selectedEpisode.audio_path}`} className="hidden" />
                )}

                {/* Play controls */}
                <div className="flex items-center gap-4 mt-5">
                  <button
                    onClick={togglePlay}
                    disabled={!selectedEpisode.audio_path}
                    className="w-12 h-12 rounded-full bg-[#ea2804] text-white flex items-center justify-center hover:bg-[#c92000] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                  </button>
                  <div className="flex-1 h-1.5 bg-[#4e4e4e] rounded-full">
                    <div
                      className="h-full bg-[#ea2804] rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-[#bbbbbb] font-mono">
                    {selectedEpisode.audio_path
                      ? `${Math.floor(currentTime / 60)}:${(Math.floor(currentTime) % 60).toString().padStart(2, '0')} / ${Math.floor(duration / 60)}:${(Math.floor(duration) % 60).toString().padStart(2, '0')}`
                      : 'Generating...'}
                  </span>
                </div>
              </div>

              {/* Script / Transcript */}
              {selectedEpisode.script_text && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={16} className="text-[#646464]" />
                    <h3 className="text-sm font-semibold text-[#202020]">Transcript</h3>
                  </div>
                  <div className="prose prose-sm max-w-none text-[#202020] bg-[#fafafa] rounded-2xl p-5 border border-[#e5e5e5]">
                    <ReactMarkdown>{selectedEpisode.script_text}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Radio size={40} className="text-[#e5e5e5] mb-4" />
              <p className="text-sm text-[#646464]">Select an episode or generate a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
