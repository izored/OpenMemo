import { useCallback, useRef } from 'react';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import { ACCENT_OPTIONS, accentHarmony, randomBlobPositions } from '@/lib/appearance';

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

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setTweak({ bgImage: r.result as string, bgMode: 'image' });
    r.readAsDataURL(f);
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
          <span className="om-add-kbd mono">live</span>
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
            <span className="mono">How memos render in the grid</span>
          </div>
          <div className="om-add-segment" role="tablist">
            {[
              { v: 'minimal', l: 'Min' },
              { v: 'hybrid', l: 'Hybrid' },
              { v: 'rich', l: 'Rich' },
            ].map((o) => (
              <button
                key={o.v}
                className={cn('om-add-seg', t.cardStyle === o.v && 'active')}
                onClick={() => setTweak('cardStyle', o.v)}
              >
                <span className={`om-seg-swatch s-${o.v}`} />
                <span>{o.l}</span>
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
              { v: 'boxed', l: 'Boxed' },
              { v: 'full', l: 'Full width' },
            ].map((o) => (
              <button
                key={o.v}
                className={cn('om-add-seg', t.layout === o.v && 'active')}
                onClick={() => setTweak('layout', o.v)}
              >
                <span>{o.l}</span>
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
                      <span className="mono">JPG · PNG · auto-blurred</span>
                    </>
                  )}
                  {t.bgImage && <span className="om-ap-bg-replace mono">Replace</span>}
                </button>
                {t.bgImage && (
                  <button
                    className="om-ap-bg-clear"
                    onClick={() => setTweak({ bgImage: '', bgMode: 'none' })}
                  >
                    <Icon name="x" size={11} />
                    <span>Remove</span>
                  </button>
                )}
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
      </div>

      <div className="om-add-foot">
        <span className="mono om-ap-hint">Changes preview live.</span>
        <button className="om-add-foot-btn primary" onClick={() => setOpen(false)}>
          <span>Done</span>
          <span className="mono om-add-kbd-inv">⏎</span>
        </button>
      </div>
    </aside>
  );
}
