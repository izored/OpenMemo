import { useCallback, useRef } from 'react';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import { ACCENT_OPTIONS, accentHarmony, randomBlobPositions } from '@/lib/appearance';
import { settingsApi } from '@/lib/api';

export function AppearancePanel() {
  const open = useAppStore((s) => s.appearancePanelOpen);
  const setOpen = useAppStore((s) => s.setAppearancePanelOpen);
  const t = useAppStore((s) => s.tweaks);
  const setTweak = useAppStore((s) => s.setTweak);
  const fileRef = useRef<HTMLInputElement>(null);

  const randomizeBg = useCallback(() => {
    setTweak({
      bgPalette: accentHarmony(t.accent),
      bgPositions: randomBlobPositions(),
      bgMode: 'random',
    });
  }, [t.accent, setTweak]);

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      alert('Image over 10 MB. Lossless compression for large backgrounds is coming soon — please use a smaller image for now.');
      return;
    }
    try {
      // Store the original full-quality image server-side (a localStorage data
      // URL can't hold a real photo). We keep only its URL in tweaks, cache-busted
      // so a replace shows at once. Rendering is unchanged: --bg-image: url(...).
      await settingsApi.uploadBackground(f);
      setTweak({ bgImage: `/api/settings/background?t=${Date.now()}`, bgMode: 'image' });
    } catch (err) {
      alert((err as Error).message || 'Could not set background.');
    }
  };

  const removeBg = () => {
    settingsApi.deleteBackground().catch(() => {});
    setTweak({ bgImage: '', bgMode: 'none' });
  };

  const customAccents = t.customAccents?.length === 2 ? t.customAccents : (['', ''] as [string, string]);

  return (
    <aside
      className={cn('om-add-panel om-ap-panel', open && 'open')}
      aria-hidden={!open}
      aria-label="Appearance"
    >
      <div className="om-add-head">
        <div className="om-add-head-l">
          <b>Appearance</b>
          <span className="om-add-kbd mono om-ap-live">live</span>
        </div>
        <button className="om-add-x" onClick={() => setOpen(false)} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="om-add-body">
        {/* Theme */}
        <div className="om-ap-row">
          <div className="om-ap-label">
            <p>Theme</p>
            <span className="mono">Calm light or quiet dark</span>
          </div>
          <div className="om-add-segment two" role="tablist">
            {[
              { v: 'light', l: 'Light', icon: 'sun' },
              { v: 'dark', l: 'Dark', icon: 'moon' },
            ].map((o) => (
              <button
                key={o.v}
                className={cn('om-add-seg', t.theme === o.v && 'active')}
                onClick={() => setTweak('theme', o.v)}
              >
                <Icon name={o.icon} size={11} />
                <span>{o.l}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Accent */}
        <div className="om-ap-row">
          <div className="om-ap-label">
            <p>Accent</p>
            <span className="mono">Highlights & primary actions</span>
          </div>
          <div className="om-ap-swatches">
            {ACCENT_OPTIONS.map((c) => (
              <button
                key={c}
                className={cn('om-ap-swatch', t.accent === c && 'active')}
                style={{ background: c }}
                onClick={() =>
                  setTweak({
                    accent: c,
                    bgPalette: accentHarmony(c),
                    bgPositions: randomBlobPositions(),
                    bgMode: 'random',
                  })
                }
                aria-label={c}
              >
                {t.accent === c && <Icon name="check" size={10} />}
              </button>
            ))}
            {customAccents.map((c, i) => {
              if (!c) {
                return (
                  <label key={`cu-${i}`} className="om-ap-swatch custom empty" aria-label="Add custom accent">
                    <input
                      type="color"
                      defaultValue="#888888"
                      onChange={(e) => {
                        const arr: [string, string] = [customAccents[0], customAccents[1]];
                        arr[i] = e.target.value;
                        setTweak({
                          accent: e.target.value,
                          customAccents: arr,
                          bgPalette: accentHarmony(e.target.value),
                          bgPositions: randomBlobPositions(),
                          bgMode: 'random',
                        });
                      }}
                    />
                    <Icon name="plus" size={12} />
                  </label>
                );
              }
              return (
                <button
                  key={`cu-${i}`}
                  className={cn('om-ap-swatch custom filled', t.accent === c && 'active')}
                  style={{ background: c }}
                  onClick={() =>
                    setTweak({
                      accent: c,
                      bgPalette: accentHarmony(c),
                      bgPositions: randomBlobPositions(),
                      bgMode: 'random',
                    })
                  }
                  aria-label={`Custom ${c}`}
                >
                  {t.accent === c && <Icon name="check" size={10} />}
                  <span
                    className="om-ap-swatch-clear"
                    role="button"
                    aria-label="Remove custom color"
                    onClick={(e) => {
                      e.stopPropagation();
                      const arr: [string, string] = [customAccents[0], customAccents[1]];
                      arr[i] = '';
                      setTweak({ customAccents: arr });
                    }}
                  >
                    ×
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Card style */}
        <div className="om-ap-row">
          <div className="om-ap-label">
            <p>Card style</p>
            <span className="mono">How Memos render in the grid</span>
          </div>
          <div className="om-add-segment two" role="tablist">
            {[
              { v: 'normal', l: 'Normal', star: false },
              { v: 'minimal', l: 'Minimal', star: true },
            ].map((o) => (
              <button
                key={o.v}
                className={cn('om-add-seg', t.cardStyle === o.v && 'active')}
                onClick={() => setTweak('cardStyle', o.v)}
              >
                <span className={`om-seg-swatch s-${o.v}`} />
                <span>{o.l}{o.star && <span className="om-ap-star" aria-hidden>*</span>}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Layout width */}
        <div className="om-ap-row">
          <div className="om-ap-label">
            <p>Layout</p>
            <span className="mono">Boxed max-width or full-bleed</span>
          </div>
          <div className="om-add-segment two" role="tablist">
            {[
              { v: 'boxed', l: 'Boxed', star: true },
              { v: 'full', l: 'Full width', star: false },
            ].map((o) => (
              <button
                key={o.v}
                className={cn('om-add-seg', t.layout === o.v && 'active')}
                onClick={() => setTweak('layout', o.v)}
              >
                <span>{o.l}{o.star && <span className="om-ap-star" aria-hidden>*</span>}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sidebar player size */}
        <div className="om-ap-row">
          <div className="om-ap-label">
            <p className="om-ap-label-ico"><Icon name="music" size={12} /> Player</p>
            <span className="mono">Sidebar now-playing size</span>
          </div>
          <div className="om-add-segment two" role="tablist">
            {[
              { v: 'small', l: 'Small', star: false },
              { v: 'big', l: 'Big', star: true },
            ].map((o) => (
              <button
                key={o.v}
                className={cn('om-add-seg', t.playerSize === o.v && 'active')}
                onClick={() => setTweak('playerSize', o.v)}
              >
                <span>{o.l}{o.star && <span className="om-ap-star" aria-hidden>*</span>}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Grid columns */}
        <div className="om-ap-row">
          <div className="om-ap-label">
            <p>Grid columns</p>
            <span className="mono">Cards per row</span>
          </div>
          <div className="om-add-segment" role="tablist">
            {[3, 4, 5].map((n) => (
              <button
                key={n}
                className={cn('om-add-seg', t.gridColumns === n && 'active')}
                onClick={() => setTweak('gridColumns', n)}
              >
                <span className="om-seg-cols">
                  {Array.from({ length: n }).map((_, i) => (
                    <i key={i} />
                  ))}
                </span>
                <span>{n}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Background */}
        <div className="om-ap-row">
          <div className="om-ap-label">
            <p>Background</p>
            <span className="mono">Image or randomized accent wash</span>
          </div>
          <div className="om-ap-bg">
            <div className="om-add-segment two" role="tablist">
              {[
                { v: 'image', l: 'Image', icon: 'image' },
                { v: 'random', l: 'Random', icon: 'sparkles' },
              ].map((o) => (
                <button
                  key={o.v}
                  className={cn('om-add-seg', t.bgMode === o.v && 'active')}
                  onClick={() => setTweak('bgMode', o.v)}
                >
                  <Icon name={o.icon} size={11} />
                  <span>{o.l}</span>
                </button>
              ))}
            </div>

            {t.bgMode === 'image' ? (
              <div className="om-ap-bg-image">
                <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} hidden />
                <button
                  className="om-ap-bg-drop"
                  onClick={() => fileRef.current?.click()}
                  style={t.bgImage ? { backgroundImage: `url(${t.bgImage})` } : undefined}
                >
                  {!t.bgImage && (
                    <>
                      <Icon name="image" size={16} />
                      <span>Upload image</span>
                      <span className="mono">JPG · PNG · WEBP · full quality</span>
                    </>
                  )}
                  {t.bgImage && <span className="om-ap-bg-replace mono">Replace</span>}
                </button>
                {t.bgImage && (
                  <button
                    className="om-ap-bg-clear"
                    onClick={removeBg}
                  >
                    <Icon name="x" size={11} />
                    <span>Remove</span>
                  </button>
                )}
                <div className="om-ap-blur-row">
                  <span className="mono om-ap-blur-label">Blur — {Math.round(t.bgBlur ?? 64)}px</span>
                  <input
                    type="range"
                    min={0}
                    max={120}
                    step={2}
                    value={t.bgBlur ?? 64}
                    onChange={(e) => setTweak('bgBlur', parseInt(e.target.value))}
                    className="om-ap-range"
                    aria-label="Background blur"
                  />
                </div>
              </div>
            ) : (
              <div className="om-ap-bg-random">
                <div className="om-ap-bg-preview" aria-hidden>
                  {(t.bgPalette?.length ? t.bgPalette : accentHarmony(t.accent)).map((c, i) => (
                    <span key={i} style={{ background: c }} />
                  ))}
                </div>
                <button className="om-ap-bg-roll" onClick={randomizeBg}>
                  <Icon name="refresh" size={11} />
                  <span>Randomize</span>
                  <span className="mono">· in {t.accent}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Background fade — veils the gradient/image toward the base color */}
        <div className="om-ap-row">
          <div className="om-ap-label">
            <p>Background fade</p>
            <span className="mono">{Math.round((t.bgFade ?? 0) * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={t.bgFade ?? 0}
            onChange={(e) => setTweak('bgFade', parseFloat(e.target.value))}
            className="om-ap-range"
            aria-label="Background fade"
          />
        </div>

        {/* Blob animation speed */}
        <div className="om-ap-row">
          <div className="om-ap-label">
            <p>Animation speed</p>
            <span className="mono">Background blob drift</span>
          </div>
          <div className="om-add-segment" role="tablist">
            {([0, 2, 4] as const).map((s) => (
              <button
                key={s}
                className={cn('om-add-seg', (t.blobSpeed ?? 2) === s && 'active')}
                onClick={() => setTweak('blobSpeed', s)}
              >
                <span>{s === 0 ? 'Off' : `${s}×`}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="om-add-foot">
        <div className="om-ap-foot-note">
          <span className="mono om-ap-star-note">
            <span className="om-ap-star">*</span> My picks. This is how I run openMemo, and how it looks best to me.
          </span>
        </div>
        <button className="om-add-foot-btn primary" onClick={() => setOpen(false)}>
          <span>Done</span>
          <span className="mono om-add-kbd-inv">⏎</span>
        </button>
      </div>
    </aside>
  );
}
