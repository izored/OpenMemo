import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';
import { ingestApi, collectionApi, settingsApi } from '@/lib/api';
import { losslessLink, playlistShape } from '@/lib/playlistUrl';
import { cn } from '@/lib/utils';

type Tab = 'link' | 'upload' | 'playlist';

type LosslessProbe = {
  kind: 'track' | 'album' | 'playlist';
  title: string;
  artist?: string | null;
  cover?: string | null;
  count: number;
  alreadySaved?: { id: string; name: string } | null;
};

const PROVIDER_LABEL: Record<'spotify' | 'apple', string> = {
  spotify: 'Spotify',
  apple: 'Apple Music',
};

/**
 * Music page's dedicated "+" surface (SpotiFLAC integration). Same bottom-right
 * glass panel as the New-Memo panel, so the gesture/feel stays identical — only
 * the contents are music-specific:
 *   · paste any track/playlist link — Spotify / Apple Music resolve to lossless
 *     FLAC, while YouTube / SoundCloud / Bandcamp keep their existing yt-dlp path;
 *   · upload local audio straight into the library;
 *   · spin up an empty playlist.
 * A gear in the header reveals the auto-download-linked-audio setting.
 */
// `embedded` (ADR-021): render only the panel content — the bottom-bar IslandFab
// owns the glass surface + the morph. The global instance steps aside on
// bottom-bar pages so the two never double up.
export function MusicAddModal({ embedded = false }: { embedded?: boolean } = {}) {
  const open = useAppStore((s) => s.musicModalOpen);
  const setOpen = useAppStore((s) => s.setMusicModalOpen);
  const bottomBarPresent = useAppStore((s) => s.bottomBarPresent);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('link');
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Read before the link tab needs it: `music_relay_enabled` decides whether a
  // Spotify / Apple link is even offered.
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });

  // Link tab
  const [url, setUrl] = useState('');
  const [download, setDownload] = useState(true);
  // A Spotify OR Apple Music link is a lossless (FLAC) source; both share the
  // same probe/ingest contract, only the provider differs.
  //
  // Both go through the music relay, which is off by default — and while it is
  // off those routes 404 on the server. So treat the link as unrecognised
  // rather than probing something that cannot answer, and say why below.
  const lossless = losslessLink(url);
  const relayOn = settings?.music_relay_enabled ?? false;
  const losslessBlocked = !!lossless && !relayOn;
  const provider = relayOn ? (lossless?.provider ?? null) : null;
  const losslessKind = lossless?.kind ?? null;
  const plShape = playlistShape(url);
  const [llProbe, setLlProbe] = useState<LosslessProbe | null>(null);
  const [llProbing, setLlProbing] = useState(false);

  // Upload tab. `uploadMode` decides how a dropped batch is filed:
  //   album    — auto-group by each file's embedded album tag (one+ albums)
  //   playlist — everything into one new playlist
  //   tracks   — loose songs straight into the library, no collection
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadMode, setUploadMode] = useState<'album' | 'playlist' | 'tracks'>('album');
  const [uploadName, setUploadName] = useState('');

  // Playlist tab
  const [plName, setPlName] = useState('');

  // Settings drawer only toggles auto-download now. Lossless quality is no
  // longer a user choice: the backend always asks for hi-res and downgrades to
  // CD on its own when a release has no hi-res master. (`settings` is read
  // above, where the link tab first needs it.)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale error on open
      setError('');
    }
  }, [open]);

  // Single track → download now; a big collection → metadata-first.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derive sensible default from the link
    setDownload(losslessKind !== 'playlist');
  }, [losslessKind]);

  // Debounced lossless preview so paste/typing doesn't hammer the probe.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the probe as the URL/provider changes
    setLlProbe(null);
    if (!provider || !open) {
      setLlProbing(false);
      return;
    }
    setLlProbing(true);
    const t = setTimeout(async () => {
      try {
        const res = provider === 'apple'
          ? await ingestApi.probeApple(url.trim())
          : await ingestApi.probeSpotify(url.trim());
        setLlProbe({
          kind: res.kind,
          title: res.title,
          artist: res.artist,
          cover: res.cover,
          count: res.count,
          alreadySaved: res.already_saved ?? null,
        });
      } catch {
        setLlProbe(null);
      } finally {
        setLlProbing(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [url, provider, open]);

  const close = () => {
    setOpen(false);
    setUrl('');
    setPlName('');
    setError('');
    setProgress(null);
    setShowSettings(false);
    setUploadName('');
  };

  const refreshMusic = () => {
    queryClient.invalidateQueries({ queryKey: ['memos'] });
    queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const saveLink = async () => {
    const link = url.trim();
    if (!link) return;
    setBusy(true);
    setError('');
    try {
      if (provider) {
        const res = provider === 'apple'
          ? await ingestApi.apple(link, { download })
          : await ingestApi.spotify(link, { download });
        refreshMusic();
        close();
        if (res.collection_id) navigate(`/music/${res.collection_id}`);
        return;
      }
      if (plShape.isPlaylist) {
        const res = await ingestApi.playlist(link, { download });
        refreshMusic();
        close();
        navigate(`/music/${res.collection_id}`);
        return;
      }
      // Music surface: a plain link (YouTube, SoundCloud…) means "save the
      // SONG" — ingest as a music memo + audio pull, never a video/link memo.
      await ingestApi.url(link, undefined, { audioOnly: true });
      refreshMusic();
      close();
    } catch (e) {
      setError((e as Error).message || 'Could not save that link');
    } finally {
      setBusy(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const arr = Array.from(files);
    setBusy(true);
    setError('');

    // Album / playlist: one request groups the batch (and any dropped cover
    // image) into collection(s) server-side.
    if (uploadMode !== 'tracks') {
      setProgress({ done: 0, total: arr.length });
      try {
        const res = await ingestApi.album(arr, {
          mode: uploadMode,
          name: uploadName.trim() || undefined,
        });
        setProgress(null);
        setBusy(false);
        refreshMusic();
        close();
        if (res.collection_id) navigate(`/music/${res.collection_id}`);
      } catch (e) {
        setProgress(null);
        setBusy(false);
        setError((e as Error).message || 'Could not import that album');
      }
      return;
    }

    // Loose tracks: each file becomes a standalone library song.
    const audio = arr.filter((f) => !f.type.startsWith('image/'));
    setProgress({ done: 0, total: audio.length });
    const failed: string[] = [];
    for (let i = 0; i < audio.length; i++) {
      try {
        await ingestApi.file(audio[i], undefined, undefined, { audioKind: 'music' });
      } catch {
        failed.push(audio[i].name);
      }
      setProgress({ done: i + 1, total: audio.length });
    }
    setProgress(null);
    setBusy(false);
    refreshMusic();
    if (!failed.length) {
      close();
      return;
    }
    setError(`${failed.length} of ${audio.length} failed to upload`);
  };

  const createPlaylist = async () => {
    const name = plName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      const created = await collectionApi.create({ name, kind: 'playlist' });
      queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
      close();
      navigate(`/music/${created.id}`);
    } catch (e) {
      setError((e as Error).message || 'Could not create playlist');
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'link', icon: 'link', label: 'Link' },
    { id: 'upload', icon: 'upload', label: 'Upload' },
    { id: 'playlist', icon: 'listMusic', label: 'Playlist' },
  ];

  // Footer action mirrors the New-Memo panel: one context button per tab.
  const footLabel = busy
    ? 'Working…'
    : tab === 'upload'
      ? (progress ? `Uploading ${progress.done}/${progress.total}…` : 'Choose files')
      : tab === 'playlist'
        ? 'Create playlist'
        : llProbe?.alreadySaved ? 'Open playlist' : 'Save';
  const footAction = () => {
    if (tab === 'upload') fileRef.current?.click();
    else if (tab === 'playlist') createPlaylist();
    else saveLink();
  };
  const footDisabled = busy
    || (tab === 'link' && !url.trim())
    // Saving an Apple/Spotify link with the relay off would just 404. The pane
    // says so; the button matches it rather than inviting a failed request.
    || (tab === 'link' && losslessBlocked)
    || (tab === 'playlist' && !plName.trim());

  // The global corner instance steps aside on bottom-bar pages (ADR-021).
  if (!embedded && bottomBarPresent) return null;

  return (
    <aside
      className={cn(embedded ? 'om-add-embedded om-mm-panel' : 'om-add-panel om-mm-panel', (open || embedded) && 'open')}
      aria-hidden={embedded ? undefined : !open}
    >
      <div className="om-add-head">
        <div className="om-add-head-l">
          <Icon name="music" size={13} />
          <b>Add music</b>
        </div>
        <div className="om-mm-head-actions">
          <button
            className={cn('om-add-x', showSettings && 'is-on')}
            onClick={() => setShowSettings((v) => !v)}
            title="Music settings"
            aria-label="Music settings"
          >
            <Icon name="settings" size={13} />
          </button>
          <button className="om-add-x" onClick={close} aria-label="Close">
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>

      <div className="om-add-body">
        {showSettings && (
          <div className="om-mm-settings">
            <div className="om-mm-set-row">
              <div>
                <label className="om-field-label">Auto-download linked audio</label>
                <p className="om-mm-set-hint">SoundCloud / Bandcamp → local files</p>
              </div>
              <button
                className={cn('om-mm-toggle', settings?.auto_download_audio && 'on')}
                onClick={async () => {
                  await settingsApi.update({ auto_download_audio: !settings?.auto_download_audio });
                  queryClient.invalidateQueries({ queryKey: ['settings'] });
                }}
                role="switch"
                aria-checked={!!settings?.auto_download_audio}
                aria-label="Auto-download linked audio"
              >
                <span />
              </button>
            </div>
            <p className="om-mm-provider mono">
              <Icon name="info" size={11} /> Lossless via Qobuz — hi-res when available, CD otherwise.
            </p>
          </div>
        )}

        <div className="om-add-sect mono">Add</div>
        <div className="om-add-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={cn('om-add-tab', tab === t.id && 'active')}
              onClick={() => { setTab(t.id); setError(''); }}
              title={t.label}
            >
              <Icon name={t.icon} size={13} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {tab === 'link' && (
          <div className="om-add-tab-pane">
            <div className="om-add-sect mono">Track or playlist link</div>
            <div className="om-add-input">
              <Icon name={provider ? 'sparkles' : 'globe'} size={13} />
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Spotify, Apple Music, YouTube…"
                onKeyDown={(e) => e.key === 'Enter' && saveLink()}
              />
            </div>

            {provider ? (
              <div className="om-mm-spotify">
                <span className="om-mm-badge">
                  <Icon name="sparkles" size={11} /> {PROVIDER_LABEL[provider]} → lossless FLAC
                </span>
                {llProbing && !llProbe ? (
                  <p className="om-mm-hint mono">Reading {PROVIDER_LABEL[provider]} link…</p>
                ) : llProbe ? (
                  <div className="om-mm-preview">
                    {llProbe.cover && <img src={llProbe.cover} alt="" loading="lazy" />}
                    <div className="om-mm-preview-body">
                      <b>{llProbe.title}</b>
                      <small className="mono">
                        {llProbe.kind === 'track'
                          ? llProbe.artist || 'Track'
                          : `${llProbe.kind === 'album' ? 'Album' : 'Playlist'} · ${llProbe.count} track${llProbe.count === 1 ? '' : 's'}`}
                      </small>
                      {llProbe.alreadySaved && (
                        <small className="om-mm-saved mono">Already saved.</small>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="om-mm-hint mono">Couldn’t preview — saving still works.</p>
                )}
                <label className="om-mm-check">
                  <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />
                  <span>Download {losslessKind === 'track' ? 'now' : 'all now'}</span>
                </label>
              </div>
            ) : losslessBlocked ? (
              <div className="om-mm-spotify">
                <p className="om-mm-hint mono" style={{ color: 'var(--text-warning, #BA7517)' }}>
                  That’s {lossless?.provider === 'apple' ? 'an Apple Music' : 'a Spotify'} link, and
                  the music relay is off — so openMemo won’t fetch it.
                </p>
                <p className="om-mm-hint mono">
                  Add the file yourself on the Upload tab, or turn the relay on in
                  Settings → Files → Music relay.
                </p>
              </div>
            ) : plShape.isPlaylist ? (
              <>
                <p className="om-mm-hint mono">Playlist link — saved as a music playlist.</p>
                <label className="om-mm-check">
                  <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />
                  <span>Download tracks now</span>
                </label>
              </>
            ) : (
              <p className="om-mm-hint mono">
                Spotify &amp; Apple Music links download as lossless FLAC. Other links (YouTube, SoundCloud…) are saved as songs — audio downloads right here in your library.
              </p>
            )}
          </div>
        )}

        {tab === 'upload' && (
          <div className="om-add-tab-pane">
            <div className="om-add-tabs" role="tablist">
              {([
                { id: 'album', icon: 'layers', label: 'Album' },
                { id: 'playlist', icon: 'listMusic', label: 'Playlist' },
                { id: 'tracks', icon: 'music', label: 'Tracks' },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={uploadMode === m.id}
                  className={cn('om-add-tab', uploadMode === m.id && 'active')}
                  onClick={() => { setUploadMode(m.id); setError(''); }}
                  title={m.label}
                >
                  <Icon name={m.icon} size={13} />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            {uploadMode !== 'tracks' && (
              <div className="om-add-input">
                <Icon name={uploadMode === 'album' ? 'layers' : 'listMusic'} size={13} />
                <input
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder={uploadMode === 'album' ? 'Album name (optional)' : 'Playlist name (optional)'}
                  maxLength={200}
                />
              </div>
            )}

            <div
              className="om-add-dropzone"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
            >
              <Icon name="music" size={20} />
              {progress ? (
                <>
                  <p>Uploading {progress.done} / {progress.total}…</p>
                  <span className="mono">Keep this open until it finishes</span>
                </>
              ) : uploadMode === 'tracks' ? (
                <>
                  <p>Drop audio or <span className="om-add-link">browse</span></p>
                  <span className="mono">MP3 · FLAC · WAV · M4A · OGG</span>
                </>
              ) : (
                <>
                  <p>Drop {uploadMode === 'album' ? 'an album' : 'tracks'} or <span className="om-add-link">browse</span></p>
                  <span className="mono">Audio + an optional cover image</span>
                </>
              )}
            </div>
            {uploadMode === 'album' && !progress && (
              <p className="om-mm-hint mono">Grouped by each file’s album tag. Cover: dropped image, else embedded art.</p>
            )}
          </div>
        )}

        {tab === 'playlist' && (
          <div className="om-add-tab-pane">
            <div className="om-add-sect mono">Playlist name</div>
            <div className="om-add-input">
              <Icon name="listMusic" size={13} />
              <input
                autoFocus
                value={plName}
                onChange={(e) => setPlName(e.target.value)}
                placeholder="e.g. Late-night coding"
                maxLength={200}
                onKeyDown={(e) => e.key === 'Enter' && createPlaylist()}
              />
            </div>
            <p className="om-mm-hint mono">Empty playlist — drag songs in, or paste a link.</p>
          </div>
        )}

        {error && <p className="om-add-hint mono" style={{ color: '#EF5048' }}>{error}</p>}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={uploadMode === 'tracks' ? 'audio/*' : 'audio/*,image/*'}
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />

      <div className="om-add-foot">
        <button className="om-add-foot-btn ghost" onClick={close}>Cancel</button>
        <button className="om-add-foot-btn primary" onClick={footAction} disabled={footDisabled}>
          <span>{footLabel}</span>
          <span className="mono om-add-kbd-inv">⏎</span>
        </button>
      </div>
    </aside>
  );
}
