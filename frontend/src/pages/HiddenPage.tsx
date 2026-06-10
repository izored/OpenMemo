import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MemoGrid } from '@/components/MemoGrid';
import { Icon } from '@/components/Icon';
import { memoApi, settingsApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

// Passcode gate for the hidden section (OPNMMO-0016). Two modes:
//   • no passcode yet → first-open "set passcode" flow (passcode + confirm)
//   • passcode exists → single input, verified server-side
// The unlock lives in the app store (session-only, never persisted) so a
// reload always re-asks. This is a soft privacy gate, not encryption — the
// memos still exist in the local DB and inside their collections.
function PassGate({ passcodeSet }: { passcodeSet: boolean }) {
  const queryClient = useQueryClient();
  const setHiddenUnlocked = useAppStore((s) => s.setHiddenUnlocked);
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError('');
    if (!passcodeSet && passcode !== confirm) {
      setError('Passcodes don’t match.');
      return;
    }
    setBusy(true);
    try {
      if (passcodeSet) {
        const { ok } = await settingsApi.verifyHiddenPasscode(passcode);
        if (!ok) {
          setError('Wrong passcode.');
          return;
        }
      } else {
        await settingsApi.setHiddenPasscode(passcode);
        queryClient.invalidateQueries({ queryKey: ['settings'] });
      }
      setHiddenUnlocked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  return (
    <div className="om-passgate-wrap">
      <div className="om-passgate">
        <div className="om-passgate-mark">
          <Icon name="eye" size={20} />
        </div>
        <h2 className="om-passgate-title">{passcodeSet ? 'Hidden Memos' : 'Set a passcode'}</h2>
        <p className="om-passgate-sub">
          {passcodeSet
            ? 'Enter your passcode to see what you’ve tucked away.'
            : 'First time here. Pick a passcode for the hidden section — you’ll need it every visit.'}
        </p>
        <input
          type="password"
          className="om-passgate-input mono"
          placeholder="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
          autoComplete="off"
        />
        {!passcodeSet && (
          <input
            type="password"
            className="om-passgate-input mono"
            placeholder="Confirm passcode"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
          />
        )}
        {error && <p className="om-passgate-error">{error}</p>}
        <button
          className="om-confirm-btn om-passgate-submit"
          onClick={submit}
          disabled={busy || passcode.length < 4}
          title={passcode.length < 4 ? 'At least 4 characters' : undefined}
        >
          {busy ? 'Checking…' : passcodeSet ? 'Unlock' : 'Set & unlock'}
        </button>
      </div>
    </div>
  );
}

export function HiddenPage() {
  const hiddenUnlocked = useAppStore((s) => s.hiddenUnlocked);
  const setHiddenUnlocked = useAppStore((s) => s.setHiddenUnlocked);

  const { data: appSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['memos', 'hidden-list'],
    queryFn: () => memoApi.list({ hidden: true, limit: 200 }),
    enabled: hiddenUnlocked,
  });
  const memos = data?.items ?? [];

  if (!hiddenUnlocked) {
    if (settingsLoading) return null;
    return <PassGate passcodeSet={!!appSettings?.hidden_passcode_set} />;
  }

  return (
    <>
      <header className="om-header">
        <div className="om-greet">
          <span className="om-greet-eyebrow mono">Passcode-gated</span>
          <h1 className="om-greet-title">Hidden</h1>
          <p className="om-greet-sub">
            Off the dashboard, still in their collections. Unhide a Memo to bring it back.
          </p>
        </div>
        <button className="om-passgate-lock" onClick={() => setHiddenUnlocked(false)} title="Lock the hidden section">
          <Icon name="eye" size={13} />
          <span>Lock</span>
        </button>
      </header>

      {isLoading ? (
        <div className="om-empty">
          <div className="om-empty-mark">
            <Icon name="refresh" size={24} />
          </div>
          <p>Loading hidden Memos…</p>
        </div>
      ) : memos.length === 0 ? (
        <div className="om-empty">
          <div className="om-empty-mark">
            <Icon name="eye" size={24} />
          </div>
          <p>Nothing hidden. Use Hide on a card’s delete prompt to tuck it away.</p>
        </div>
      ) : (
        <MemoGrid memos={memos} />
      )}
    </>
  );
}
