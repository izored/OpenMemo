import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { meshApi, type MeshDevice } from '@/lib/api';

/**
 * Pairing (ADR-024 §2, §3).
 *
 * The empty state is two buttons and no third option — start a Mesh, or join
 * one. No direction picker, no push/pull, no profiles: anything else is a
 * decision the user has to make repeatedly and get wrong.
 *
 * The code is the library. Anyone holding those twelve words can read
 * everything, so it is blurred until revealed and the copy says so plainly
 * rather than leaving it to be inferred.
 */

function Words({ words }: { words: string[] }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="om-mesh-code">
      <div className={'om-mesh-words' + (shown ? '' : ' hidden')}>
        {words.map((w, i) => (
          <span key={i} className="om-mesh-word">
            <b>{i + 1}</b>
            {w}
          </span>
        ))}
      </div>
      <div className="om-mesh-code-actions">
        <button type="button" className="om-btn-secondary" onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide' : 'Reveal'}
        </button>
        <button
          type="button"
          className="om-btn-secondary"
          onClick={() => navigator.clipboard?.writeText(words.join(' '))}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

/** Windows / Darwin / Linux as a person would say it. */
function osLabel(platform: string | null): string {
  if (!platform) return '';
  return { Darwin: 'macOS', Windows: 'Windows', Linux: 'Linux' }[platform] || platform;
}

export function MeshPairingPanel() {
  const [words, setWords] = useState<string[]>([]);
  const [devices, setDevices] = useState<MeshDevice[]>([]);
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [discovery, setDiscovery] = useState<Awaited<ReturnType<typeof meshApi.discover>> | null>(null);
  const [confirmReplace, setConfirmReplace] = useState('');
  const [qrOpen, setQrOpen] = useState(false);

  const refresh = () => {
    meshApi.pairCode().then((r) => setWords(r.words)).catch(() => setWords([]));
    meshApi.devices().then((r) => setDevices(r.devices)).catch(() => setDevices([]));
  };

  useEffect(refresh, []);

  // Look for the other computer once the panel opens. The number that matters
  // is `others_on_network`: openMemos that are HERE but in a different Mesh,
  // which is what pressing "Start a Mesh" on both machines produces. Each
  // filters the other out and both report nothing, forever, with no clue why.
  useEffect(() => {
    meshApi.discover().then(setDiscovery).catch(() => setDiscovery(null));
  }, []);

  const paired = devices.length > 0;

  const start = async (replace = false) => {
    setBusy(true);
    setError('');
    try {
      const r = await meshApi.pairStart(replace);
      setWords(r.words);
      setConfirmReplace('');
      refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not start';
      // A 409 is the guard, not a failure: this Mesh already has another
      // device, and starting again would cut it loose. Offer that as a
      // deliberate choice rather than an error to retry blindly.
      if (message.includes('already has another device')) setConfirmReplace(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setError('');
    try {
      await meshApi.pairJoin(joinCode);
      setJoinCode('');
      setJoining(false);
      refresh();
    } catch (e) {
      // The backend returns the real reason — "a word is mistyped" is
      // actionable in a way "pairing failed" never is.
      setError(e instanceof Error ? e.message : 'That code did not work');
    } finally {
      setBusy(false);
    }
  };

  if (!paired && !words.length && !joining) {
    return (
      <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="om-setting-row-text" style={{ marginBottom: 10 }}>
          <p>Connect your other computer</p>
          <span className="mono">
            One of these, once. After that they find each other on their own.
          </span>
        </div>
        {/* Start and Join are peers, not primary/secondary — one library has to
            exist before another can join it, but neither is the recommended
            path. Equal buttons; the helper line is a caption under each. */}
        <div className="om-mesh-start">
          <div className="om-mesh-start-choice">
            <button type="button" className="om-btn-secondary" onClick={() => start()} disabled={busy}>
              <Icon name="plus" size={13} /> Start a Mesh
            </button>
            <span className="mono">this is my first device</span>
          </div>
          <div className="om-mesh-start-choice">
            <button type="button" className="om-btn-secondary" onClick={() => setJoining(true)}>
              <Icon name="link" size={13} /> Join a Mesh
            </button>
            <span className="mono">I have a code</span>
          </div>
        </div>
        {/* The mistake this catches: Start pressed on BOTH computers. Each
            mints its own root, so they filter each other out and both sit here
            reporting nothing. Seeing an openMemo that is not in this Mesh is
            the only signal that distinguishes it from "not switched on yet". */}
        {!!discovery?.others_on_network && discovery.count === 0 && (
          <div
            role="status"
            style={{
              border: '1px solid var(--border-warning, #E5C07B)',
              background: 'var(--bg-warning, rgba(186,117,23,0.08))',
              borderRadius: 10, padding: '10px 12px', marginTop: 10, maxWidth: 560,
            }}
          >
            <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-warning, #BA7517)' }}>
              Another openMemo is here, but in a different Mesh
            </p>
            <span className="mono" style={{ display: 'block', marginTop: 4 }}>
              {discovery.note}
            </span>
          </div>
        )}
        {confirmReplace && (
          <div
            role="alertdialog"
            aria-label="Replace this Mesh"
            style={{
              border: '1px solid var(--border-danger, #D65C5C)',
              background: 'var(--bg-danger, rgba(198,40,40,0.08))',
              borderRadius: 10, padding: '10px 12px', marginTop: 10, maxWidth: 560,
            }}
          >
            <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-danger, #C62828)' }}>
              Start over and cut the other device loose?
            </p>
            <span className="mono" style={{ display: 'block', margin: '4px 0 10px' }}>{confirmReplace}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="om-btn-ghost om-btn-pill" onClick={() => setConfirmReplace('')}>
                Keep this Mesh
              </button>
              <button type="button" className="om-btn-danger om-btn-pill" onClick={() => start(true)} disabled={busy}>
                Start a new Mesh
              </button>
            </div>
          </div>
        )}
        {error && <p className="mono" style={{ color: '#EF5048', marginTop: 8 }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, flexDirection: 'column', alignItems: 'stretch' }}>
      {joining && (
        <>
          <div className="om-setting-row-text" style={{ marginBottom: 8 }}>
            <p>Enter the code from your other computer</p>
            <span className="mono">Twelve words. Capitals, commas and line breaks are fine.</span>
          </div>
          <textarea
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="harbor velvet cactus ridge ember quilt lantern drift marble oyster thistle vault"
            rows={3}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="om-btn-primary" onClick={join} disabled={busy || !joinCode.trim()}>
              {busy ? 'Checking…' : 'Join'}
            </button>
            <button type="button" className="om-btn-secondary" onClick={() => { setJoining(false); setError(''); }}>
              Cancel
            </button>
          </div>
        </>
      )}

      {!joining && words.length > 0 && (
        <>
          <div className="om-setting-row-text" style={{ marginBottom: 8 }}>
            <p>Your Mesh code</p>
            <span className="mono">
              Type these on your other computer to connect it. <b>Anyone with this
              code can read your whole library</b>, so keep it like a password. Write
              it down — this is the only place it is shown.
            </span>
          </div>
          <Words words={words} />
          <button
            type="button"
            className="om-btn-secondary"
            style={{ marginTop: 8, alignSelf: 'flex-start' }}
            onClick={() => setQrOpen((o) => !o)}
          >
            <Icon name="link" size={13} /> {qrOpen ? 'Hide QR' : 'Show QR instead'}
          </button>
          {qrOpen && (
            <div className="om-mesh-qr">
              <img src="/api/mesh/pair/qr" alt="Pairing QR code" />
              <span className="mono">Scan this from your other computer.</span>
            </div>
          )}
        </>
      )}

      {!joining && devices.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="om-setting-row-text" style={{ marginBottom: 6 }}>
            <p>Devices</p>
            <span className="mono">
              The primary runs the Telegram bot and the heavy AI work. It does not
              win disagreements — you always decide those.
            </span>
          </div>
          {devices.map((d) => (
            <div key={d.device_id} className="om-mesh-batch">
              <div className="om-mesh-batch-main">
                <b>
                  {d.name || d.device_id}
                  {d.is_this_device ? ' · this computer' : ''}
                  {d.is_primary ? ' · primary' : ''}
                </b>
                <span>
                  {/* The OS has been recorded since the table existed and was
                      never shown. Two laptops both called "This device" are
                      otherwise impossible to tell apart in this list. */}
                  {osLabel(d.platform)}
                  {osLabel(d.platform) ? ' · ' : ''}
                  {d.revoked
                    ? 'Removed — it stops syncing once it reconnects'
                    : d.last_seen
                      ? `Last seen ${new Date(d.last_seen).toLocaleString()}`
                      : 'Not seen yet'}
                </span>
              </div>
              {!d.revoked && !d.is_primary && (
                <button
                  type="button"
                  className="om-btn-secondary"
                  onClick={async () => {
                    await meshApi.makePrimary(d.device_id).catch(() => undefined);
                    refresh();
                  }}
                >
                  Make primary
                </button>
              )}
              {!d.revoked && !d.is_this_device && (
                <button
                  type="button"
                  className="om-btn-secondary danger"
                  onClick={async () => {
                    if (!confirm(
                      'Stop syncing with this device?\n\nIt still holds your Mesh code, ' +
                      'so it only stops once it reconnects. To cut it off for certain, ' +
                      'start a new Mesh and re-pair the devices you keep.',
                    )) return;
                    await meshApi.revokeDevice(d.device_id).catch(() => undefined);
                    refresh();
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}

          {/* Starting over, as a named choice. It used to be a `replace` flag
              you only met by hitting an error, which reads as an override
              rather than a decision. */}
          <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
            <div className="om-setting-row-text">
              <p>Leave this Mesh</p>
              <span className="mono">
                Forgets the code and the device list on this computer. Your memos stay exactly
                where they are — leaving is about which devices talk to each other, not about
                your library.
              </span>
            </div>
            <button
              type="button"
              className="om-btn-secondary danger"
              disabled={busy}
              onClick={async () => {
                if (!confirm(
                  'Leave this Mesh?\n\nThis computer forgets the code and starts fresh, ready ' +
                  'to Start or Join again. Your memos are not touched.\n\nThe other computer ' +
                  'keeps its own copy and its own code — it will simply stop finding this one. ' +
                  'There is no server to tell it, so you cannot make it forget you.',
                )) return;
                setBusy(true);
                try {
                  await meshApi.leave();
                  setWords([]);
                  setConfirmReplace('');
                  refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not leave');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Leave
            </button>
          </div>
        </div>
      )}

      {error && <p className="mono" style={{ color: '#EF5048', marginTop: 8 }}>{error}</p>}
    </div>
  );
}
