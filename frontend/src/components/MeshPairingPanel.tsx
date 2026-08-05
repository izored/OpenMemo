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

export function MeshPairingPanel() {
  const [words, setWords] = useState<string[]>([]);
  const [devices, setDevices] = useState<MeshDevice[]>([]);
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const refresh = () => {
    meshApi.pairCode().then((r) => setWords(r.words)).catch(() => setWords([]));
    meshApi.devices().then((r) => setDevices(r.devices)).catch(() => setDevices([]));
  };

  useEffect(refresh, []);

  const paired = devices.length > 0;

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await meshApi.pairStart();
      setWords(r.words);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start');
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
            <button type="button" className="om-btn-secondary" onClick={start} disabled={busy}>
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
        </div>
      )}

      {error && <p className="mono" style={{ color: '#EF5048', marginTop: 8 }}>{error}</p>}
    </div>
  );
}
