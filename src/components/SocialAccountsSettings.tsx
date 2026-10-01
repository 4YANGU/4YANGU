import { RefreshCw, Unlink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearOAuthReturn, getPendingState, resumeConnection, startConnection } from '../lib/socialOAuth';
import type { OAuthOutcome } from '../lib/socialOAuth';
import { apiFetch } from '../lib/api';
import type { SocialConnection } from '../types';
import { SOCIAL_PLATFORMS } from '../lib/socialPlatforms';
import PlatformLogo from './PlatformLogo';
import { platformLabel } from '../lib/platforms';

type Picker = {
  platform: string;
  state: string;
  choices: Array<{ id: string; name: string; username: string; picture: string }>;
};

type Props = {
  storeId: number;
  onConnectionsChanged?: () => void;
};

export default function SocialAccountsSettings({ storeId, onConnectionsChanged }: Props) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [picker, setPicker] = useState<Picker | null>(null);
  const [picking, setPicking] = useState(false);
  const [disconnecting, setDisconnecting] = useState<SocialConnection | null>(null);
  const [disconnectText, setDisconnectText] = useState('');
  const oauthHandled = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await apiFetch<{ connections: SocialConnection[] }>(`/api/media?action=social&op=status&storeId=${storeId}`);
      setConnections((result.connections || []).filter((connection) => connection.connection_status === 'connected' && SOCIAL_PLATFORMS.includes(connection.platform.toLowerCase() as (typeof SOCIAL_PLATFORMS)[number])));
      onConnectionsChanged?.();
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : 'Could not load connected accounts.');
    } finally {
      setLoading(false);
    }
  }, [storeId, onConnectionsChanged]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const acceptOAuth = useCallback((outcome: OAuthOutcome) => {
    if (outcome.status === 'needs_pick' && outcome.choices?.length) {
      setPicker({ platform: outcome.platform, state: outcome.state, choices: outcome.choices });
      setNotice('Permission received. Choose the Page or channel to finish.');
      clearOAuthReturn(storeId, false);
    } else if (outcome.status === 'complete') {
      setNotice(`${platformLabel(outcome.platform)} connected.`);
      setPicker(null);
      clearOAuthReturn(storeId);
    } else if (outcome.status === 'failed') {
      setError(outcome.error || 'Connection failed. Please try again.');
      clearOAuthReturn(storeId);
    } else {
      setNotice('Approval is still in progress. Finish it in the connection window, then tap Refresh.');
    }
  }, [storeId]);

  useEffect(() => {
    if (oauthHandled.current) return;
    oauthHandled.current = true;
    const state = getPendingState(storeId);
    const resume = async () => {
      try {
        const outcome = state
          ? await resumeConnection(storeId, state)
          : (await apiFetch<{ pending: OAuthOutcome | null }>(`/api/media?action=social&op=oauth_pending&storeId=${storeId}`)).pending;
        if (outcome) {
          acceptOAuth(outcome);
          await load(true);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not restore account approval. Please reconnect.');
      }
    };
    void resume();
  }, [acceptOAuth, load, storeId]);

  const connect = async (platform: string) => {
    if (busyKey) return;
    setBusyKey(`connect-${platform}`);
    setError('');
    setNotice('');
    try {
      const outcome = await startConnection(storeId, platform);
      acceptOAuth(outcome);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to connect. Please retry.');
    } finally {
      setBusyKey('');
    }
  };

  const finishPick = async (selectionId: string) => {
    if (!picker || picking) return;
    setPicking(true);
    setError('');
    try {
      const outcome = await apiFetch<OAuthOutcome>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: 'oauth_pick', store_id: storeId, state: picker.state, selection_id: selectionId }),
      });
      acceptOAuth(outcome);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not finish the connection.');
    } finally {
      setPicking(false);
    }
  };

  const disconnect = async (connection: SocialConnection) => {
    if (busyKey || disconnectText.trim() !== 'disconnect') return;
    setBusyKey(`disconnect-${connection.id}`);
    setError('');
    try {
      await apiFetch('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: 'disconnect', store_id: storeId, connection_id: connection.id }),
      });
      setNotice(`${platformLabel(connection.platform)} disconnected.`);
      setDisconnecting(null);
      setDisconnectText('');
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not disconnect that account.');
    } finally {
      setBusyKey('');
    }
  };

  const syncAccounts = async () => {
    if (syncing) return;
    setSyncing(true);
    setError('');
    try {
      const state = getPendingState(storeId);
      const outcome = state
        ? await resumeConnection(storeId, state)
        : (await apiFetch<{ pending: OAuthOutcome | null }>(`/api/media?action=social&op=oauth_pending&storeId=${storeId}`)).pending;
      await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'sync_accounts', store_id: storeId }) });
      if (outcome) acceptOAuth(outcome);
      await load(true);
      if (!outcome) setNotice('Connected accounts refreshed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refresh connected accounts.');
    } finally {
      setSyncing(false);
    }
  };

  return <section className="settings-section social-account-settings" aria-labelledby="connected-accounts-title">
    <div className="settings-section-heading connected-account-heading">
      <h2 id="connected-accounts-title">Connected Accounts</h2>
      <button type="button" className="settings-refresh-accounts" onClick={syncAccounts} disabled={syncing} aria-label="Refresh connected accounts" title="Refresh connected accounts">
        <RefreshCw className={syncing ? 'spin' : ''} />
      </button>
    </div>

    {error && <div className="form-error" role="alert">{error}</div>}
    {!error && notice && <div className="form-success" role="status">{notice}</div>}

    {picker ? <div className="settings-picker">
      <p className="form-intro">Choose the Facebook Page to connect.</p>
      <div className="accounts-modal-list">
        {picker.choices.map((choice) => <div key={choice.id} className="account-row oauth-pick-row">
          {choice.picture ? <img src={choice.picture} alt="" /> : <PlatformLogo platform={picker.platform} size={34} />}
          <div><strong>{choice.name}</strong><small>{choice.username ? `@${choice.username}` : platformLabel(picker.platform)}</small></div>
          <button type="button" className="social-link" onClick={() => finishPick(choice.id)} disabled={picking}>{picking ? 'Connecting…' : 'Use this'}</button>
        </div>)}
      </div>
      <button type="button" className="secondary-button" onClick={() => setPicker(null)}>Back</button>
    </div> : <div className="accounts-modal-list settings-account-list">
      {SOCIAL_PLATFORMS.map((platform) => {
        const connection = connections.find((item) => item.platform.toLowerCase() === platform);
        return <div className="account-row" key={platform}>
          <PlatformLogo platform={platform} size={34} />
          <div><strong>{platformLabel(platform)}</strong><small>{connection ? 'Connected' : 'Not yet connected'}</small></div>
          {connection
            ? disconnecting?.id === connection.id
              ? <div className="disconnect-confirm-inline">
                  <label htmlFor={`disconnect-${connection.id}`}>Type <strong>disconnect</strong> to confirm</label>
                  <input id={`disconnect-${connection.id}`} autoComplete="off" value={disconnectText} onChange={(event) => setDisconnectText(event.target.value)} placeholder="disconnect" />
                  <button type="button" className="social-unlink" onClick={() => disconnect(connection)} disabled={busyKey === `disconnect-${connection.id}` || disconnectText.trim() !== 'disconnect'}>{busyKey === `disconnect-${connection.id}` ? 'Disconnecting…' : 'Disconnect'}</button>
                  <button type="button" className="secondary-button" onClick={() => { setDisconnecting(null); setDisconnectText(''); }}>Cancel</button>
                </div>
              : <button type="button" className="social-unlink" onClick={() => { setDisconnecting(connection); setDisconnectText(''); setError(''); }} disabled={Boolean(busyKey)} aria-label={`Disconnect ${platformLabel(platform)}`} title="Disconnect account"><Unlink /></button>
            : <button type="button" className="social-link" onClick={() => connect(platform)} disabled={loading || Boolean(busyKey)}>{busyKey === `connect-${platform}` ? 'Connecting…' : 'Connect'}</button>}
        </div>;
      })}
    </div>}

  </section>;
}
