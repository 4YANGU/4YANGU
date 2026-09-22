import { clearOAuthReturn, getPendingState, resumeConnection, startConnection } from '../lib/socialOAuth';
import type { OAuthOutcome } from '../lib/socialOAuth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, ExternalLink, Inbox as InboxIcon, Link2, MessageCircle, MessagesSquare, Play, RefreshCw, Search, Send, Unlink } from 'lucide-react';
import Modal from './Modal';
import SavedPosts from './SavedPosts';
import { apiFetch } from '../lib/api';
import PlatformLogo, { PlatformBadge, platformLabel } from './PlatformLogo';
import type { SocialConnection, SocialMessage, SocialThread } from '../types';

const PLATFORMS = ['tiktok', 'facebook', 'instagram', 'youtube', 'threads'];

type StatusResponse = { connections: SocialConnection[]; unread: { total: number; by_platform?: Record<string, number> } };
type InboxResponse = { threads: SocialThread[] };

type Props = { storeId: number; storeName: string; onActivity?: () => void };

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return '';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function SocialInbox({ storeId, onActivity }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [threads, setThreads] = useState<SocialThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [kindFilter, setKindFilter] = useState<'dm' | 'comment'>('dm');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');
  const [setup, setSetup] = useState<{ keysPresent: boolean; apiReachable: boolean | null; apiDetail: string; tableReady: boolean | null; tableDetail: string } | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [picker, setPicker] = useState<{ platform: string; state: string; choices: Array<{ id: string; name: string; username: string; picture: string }> } | null>(null);
  const [picking, setPicking] = useState(false);
  const loadRef = useRef<() => void>(() => undefined);
  // Woyoyo-009: single-flight OAuth resume. After same-tab approval the
  // callback redirects back here with ?oauth=…&platform=… — we pick it up
  // once, show the result, capture any pending Page/channel choice, and then
  // scrub the params so refresh never replays it.
  const oauthHandled = useRef(false);

  const load = useCallback(async (silent = false, background = false) => {
    if (background) { /* live mode syncs silently below — never show spinners */ }
    else if (silent) setRefreshing(true);
    else setLoading(true);
    if (!background) setError('');
    try {
      if (background) {
        // Quiet live sync: pull newest Repliz comments/chats, then re-read.
        await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'sync_inbox', store_id: storeId }) }).catch(() => undefined);
      }
      const [s, inbox] = await Promise.all([
        apiFetch<StatusResponse>(`/api/media?action=social&op=status&storeId=${storeId}`),
        apiFetch<InboxResponse>(`/api/media?action=social&op=inbox&storeId=${storeId}`),
      ]);
      setStatus(s);
      setThreads(inbox.threads || []);
      onActivity?.();
    } catch (err) {
      if (!background) setError(err instanceof Error ? err.message : 'Could not load the inbox.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRef.current = () => load(true, true); }, [load]);

  const acceptOAuth = (outcome: OAuthOutcome) => {
    setAccountsOpen(true);
    if (outcome.status === 'needs_pick' && outcome.choices?.length) {
      setPicker({ platform: outcome.platform, state: outcome.state, choices: outcome.choices });
      setNotice('Permission received. Choose your Page or channel to finish.');
      clearOAuthReturn(storeId, false);
    } else if (outcome.status === 'complete') {
      setNotice(`${platformLabel(outcome.platform)} connected.`); setPicker(null); clearOAuthReturn(storeId);
    } else if (outcome.status === 'failed') {
      setError(outcome.error || 'Connection failed. Please try again.'); clearOAuthReturn(storeId);
    } else setNotice('Approval is still in progress. Finish in the connection window, then tap Refresh.');
  };
  useEffect(() => {
    if (oauthHandled.current) return;
    const state = getPendingState(storeId);
    oauthHandled.current = true;
    if (!state) {
      apiFetch<{ pending: OAuthOutcome | null }>(`/api/media?action=social&op=oauth_pending&storeId=${storeId}`)
        .then(result => { if (result.pending) acceptOAuth(result.pending); })
        .catch(() => undefined);
      return;
    }
    resumeConnection(storeId, state).then(async outcome => { await load(true); acceptOAuth(outcome); })
      .catch(err => { setAccountsOpen(true); setError(err instanceof Error ? err.message : 'Could not restore approval. Please reconnect.'); });
    // The saved approval is read before any URL parameters are removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  // Woyoyo-004: social-style auto-refresh — the inbox quietly checks for new
  // DMs and comments every 20 seconds (only when the tab is visible and the
  // owner is not typing a reply), so nothing is ever missed.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
      loadRef.current();
    }, 20000);
    const onVisible = () => { if (!document.hidden) loadRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const selected = useMemo(() => threads.find((t) => t.thread_key === selectedKey) || null, [threads, selectedKey]);

  const dmUnread = useMemo(() => threads.filter((t) => t.kind === 'dm').reduce((sum, t) => sum + t.unread, 0), [threads]);
  const commentUnread = useMemo(() => threads.filter((t) => t.kind === 'comment').reduce((sum, t) => sum + t.unread, 0), [threads]);

  const visibleThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => {
      if (t.kind !== kindFilter) return false;
      if (unreadOnly && t.unread === 0) return false;
      if (q && !`${t.sender_name} ${t.sender_handle || ''} ${t.last_body}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [threads, kindFilter, query, unreadOnly]);

  const switchKind = (kind: 'dm' | 'comment') => {
    setKindFilter(kind);
    setSelectedKey(null);
    setDetailOpen(false);
    setReply('');
  };

  const openThread = async (thread: SocialThread) => {
    setSelectedKey(thread.thread_key);
    setDetailOpen(true);
    setReply('');
    if (thread.unread > 0) {
      try {
        await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'read', store_id: storeId, thread_key: thread.thread_key }) });
        setThreads((current) => current.map((t) => t.thread_key === thread.thread_key ? { ...t, unread: 0, messages: t.messages.map((m) => ({ ...m, is_read: true })) } : t));
        setStatus((current) => current ? { ...current, unread: { total: Math.max(0, current.unread.total - thread.unread) } } : current);
        await load(true, true); onActivity?.();
      } catch { /* conversation still opens for reading */ }
    }
  };

  const sendReply = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!selected || !reply.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const result = await apiFetch<{ message: SocialMessage; delivery?: { ok?: boolean; error?: string } }>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: 'reply', store_id: storeId, thread_key: selected.thread_key, body: reply.trim() }),
      });
      setThreads((current) => current.map((t) => t.thread_key === selected.thread_key ? { ...t, last_at: result.message.created_at, last_body: result.message.body, resolved: false, messages: [...t.messages, result.message] } : t));
      setReply(''); await load(true);
      if (result.delivery && result.delivery.ok === false) setError(`Saved, but sending failed: ${result.delivery.error || 'please try again.'}`);
      onActivity?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that reply.');
    } finally {
      setSending(false);
    }
  };

  const toggleResolve = async () => {
    if (!selected || busyKey) return;
    setBusyKey('resolve');
    try {
      await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'resolve', store_id: storeId, thread_key: selected.thread_key, resolved: !selected.resolved }) });
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that conversation.');
    } finally {
      setBusyKey('');
    }
  };

  const connect = async (platform: string) => {
    if (busyKey) return;
    setBusyKey(`connect-${platform}`); setError(''); setNotice('');
    try { const outcome = await startConnection(storeId, platform); await load(true); acceptOAuth(outcome); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to connect. Please retry.'); }
    finally { setBusyKey(''); }
  };
  const finishPick = async (selectionId: string) => {
    if (!picker || picking) return;
    setPicking(true); setError('');
    try {
      const outcome = await apiFetch<OAuthOutcome>('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'oauth_pick', store_id: storeId, state: picker.state, selection_id: selectionId }) });
      await load(true); acceptOAuth(outcome);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not finish the connection.'); }
    finally { setPicking(false); }
  };

  const disconnect = async (connectionId: number) => {
    if (busyKey || !window.confirm('Disconnect this account? Posting to it will stop.')) return;
    setBusyKey(`conn-${connectionId}`);
    try {
      await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'disconnect', store_id: storeId, connection_id: connectionId }) });
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect that account.');
    } finally {
      setBusyKey('');
    }
  };

  // Woyoyo-010: setup self-test. Runs whenever the Accounts pop-up opens
  // so a broken setup shows its fix right where Connect is tapped.
  const checkSetup = useCallback(async () => {
    setSetupLoading(true);
    try {
      const result = await apiFetch<{ keysPresent: boolean; apiReachable: boolean | null; apiDetail: string; tableReady: boolean | null; tableDetail: string }>(`/api/media?action=social&op=setup_check&storeId=${storeId}`);
      setSetup(result);
    } catch { setSetup(null); } finally { setSetupLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);
  useEffect(() => { if (accountsOpen) checkSetup(); }, [accountsOpen, checkSetup]);

  const syncAccounts = async () => {
    if (syncing) return;
    setSyncing(true);
    setError('');
    try {
      const pending = getPendingState(storeId);
      const outcome = pending ? await resumeConnection(storeId, pending) : (await apiFetch<{ pending: OAuthOutcome | null }>(`/api/media?action=social&op=oauth_pending&storeId=${storeId}`)).pending;
      await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'sync_accounts', store_id: storeId }) });
      await load(true);
      if (outcome) acceptOAuth(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh.');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <section className="social-inbox" aria-label="Inbox"><div className="social-loading"><RefreshCw className="spin" /> Opening your inbox…</div></section>;

  const connectedCount = status?.connections.length || 0;

  return <section className="social-inbox" aria-label="Inbox">
    <div className="social-inbox-head social-inbox-head-row">
      <div className="inbox-head-copy inbox-title-row">
        <h2>Inbox</h2>
        <span className="inbox-platform-strip" aria-label="TikTok, Facebook, Instagram, YouTube, Threads">{PLATFORMS.map((platform) => <PlatformLogo key={platform} platform={platform} size={20} />)}</span>
      </div>
      <div className="social-head-actions">
        <button className="inbox-accounts-icon" onClick={() => setAccountsOpen(true)} aria-label="Connected accounts" title={`Connected accounts · ${connectedCount} of 5`}><Link2 />{connectedCount < 5 && <b>{connectedCount}/5</b>}</button>
        <button className="inbox-refresh-icon" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh inbox" title="Refresh inbox"><RefreshCw className={refreshing ? 'spin' : ''} /></button>
      </div>
    </div>
    {error && <div className="form-error">{error}</div>}
    {!error && notice && <div className="form-success">{notice}</div>}
    <div className="saved-draft-box"><span>Not quite ready to post?</span><button onClick={() => setDraftsOpen(true)}>Saved drafts</button></div>
    {draftsOpen && <SavedPosts storeId={storeId} onClose={() => setDraftsOpen(false)} />}
    <div className="social-view-tabs" role="tablist" aria-label="Message types">
      <button className={kindFilter === 'dm' ? 'active' : ''} onClick={() => switchKind('dm')}><MessageCircle /> DMs{dmUnread > 0 && <b className="tab-unread">{dmUnread}</b>}</button>
      <button className={kindFilter === 'comment' ? 'active' : ''} onClick={() => switchKind('comment')}><MessagesSquare /> Comments{commentUnread > 0 && <b className="tab-unread">{commentUnread}</b>}</button>
    </div>

    <div className="social-filters">
      <div className="social-filters-row">
        <label className="social-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or message…" /></label>
        <button className={`social-unread-toggle ${unreadOnly ? 'on' : ''}`} onClick={() => setUnreadOnly((value) => !value)}><CheckCheck /> Unread</button>
      </div>
    </div>

    {!threads.length
      ? <div className="social-empty"><InboxIcon /><h3>No conversations yet</h3><p>Connect your accounts above. New DMs and comments will appear here.</p></div>
      : !visibleThreads.length
        ? <div className="orders-empty">{kindFilter === 'dm' ? 'No DMs match these filters.' : 'No comments match these filters.'}</div>
        : <div className={`social-threads ${detailOpen && selected ? 'show-detail' : ''}`}>
          <div className="social-thread-list" role="list">
            {visibleThreads.map((thread) => <button key={thread.thread_key} role="listitem" className={`social-thread ${selectedKey === thread.thread_key ? 'active' : ''} ${thread.unread ? 'unread' : ''} ${thread.resolved ? 'resolved' : ''}`} onClick={() => openThread(thread)}>
              <span className="social-avatar">{(thread.sender_name || '?')[0]?.toUpperCase()}</span>
              <span className="social-thread-body">
                <span className="social-thread-top"><strong>{thread.sender_name}</strong><small>{timeAgo(thread.last_at)}</small></span>
                <span className="social-thread-meta"><PlatformBadge platform={thread.platform} small />{thread.kind === 'dm' ? 'DM' : 'Comment'}{thread.resolved && <em>Resolved</em>}</span>
                {thread.kind === 'comment' && (thread.source_title || thread.source_ref) && <span className="thread-source-line"><Play />{thread.source_title || thread.source_ref}</span>}
                <span className="social-thread-preview">{thread.last_body}</span>
              </span>
              {thread.unread > 0 && <b className="social-unread">{thread.unread}</b>}
            </button>)}
          </div>
          <div className="social-thread-detail">
            {selected ? <>
              <div className="social-detail-head">
                <button className="social-back" onClick={() => setDetailOpen(false)} aria-label="Back to conversations"><ArrowLeft /></button>
                <span className="social-avatar">{(selected.sender_name || '?')[0]?.toUpperCase()}</span>
                <div><strong>{selected.sender_name}</strong><small><PlatformBadge platform={selected.platform} small /> {selected.kind === 'dm' ? 'DM' : 'Comment'}{selected.sender_handle ? ` · ${selected.sender_handle}` : ''}</small></div>
                <button className={`social-resolve ${selected.resolved ? 'done' : ''}`} onClick={toggleResolve} disabled={busyKey === 'resolve'}>{selected.resolved ? 'Reopen' : 'Resolve'} <Check /></button>
              </div>
              {selected.kind === 'comment' && (selected.source_title || selected.source_ref) && <div className="comment-source-card">
                <span className="comment-source-thumb"><Play /></span>
                <div><small>Comment on</small><strong>{selected.source_title || 'Original post'}</strong>{selected.source_ref && selected.source_title !== selected.source_ref && <span>{selected.source_ref}</span>}</div>
                {selected.source_url && <a href={selected.source_url} target="_blank" rel="noreferrer"><ExternalLink /> View</a>}
              </div>}
              <div className="social-messages">
                {selected.messages.map((message) => <div key={message.id} className={`social-bubble ${message.direction}`}>
                  <span className="bubble-platform"><PlatformLogo platform={message.platform} size={11} />{platformLabel(message.platform)}</span>
                  <p>{message.body}</p>
                  <small>{fullTime(message.created_at)}{message.direction === 'out' ? ' · you' : ''}</small>
                </div>)}
              </div>
              <form className="social-reply" onSubmit={sendReply}>
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={`Reply to ${selected.sender_name}…`} rows={2} maxLength={2000} />
                <button className="button-primary" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : 'Send'} <Send /></button>
              </form>
            </> : <div className="social-detail-placeholder"><MessagesSquare /><p>Select a conversation to read and reply.</p></div>}
          </div>
        </div>}
    {accountsOpen && <Modal title={`Connected accounts · ${connectedCount} of 5`} onClose={() => { setAccountsOpen(false); setPicker(null); setNotice(''); }}>
      <div className="accounts-modal-body">{error && <div className="form-error" role="alert">{error}</div>}{!error && notice && <div className="form-success">{notice}</div>}
        {picker ? <>
          <p className="form-intro">{picker.platform === 'facebook' ? 'Choose the Facebook Page to connect.' : 'Choose the YouTube channel to connect.'}</p>
          <div className="accounts-modal-list">
            {picker.choices.map((choice) => <div key={choice.id} className="account-row oauth-pick-row">
              {choice.picture ? <img src={choice.picture} alt="" /> : <PlatformBadge platform={picker.platform} />}
              <div><strong>{choice.name}</strong><small>{choice.username ? `@${choice.username}` : platformLabel(picker.platform)}</small></div>
              <button className="social-link" onClick={() => finishPick(choice.id)} disabled={picking}>{picking ? 'Connecting…' : 'Use this'}</button>
            </div>)}
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => setPicker(null)}>Back</button>
          </div>
        </> : <>
          <p className="form-intro">Connect each platform. Posting and replies use these accounts automatically.</p>
          {setupLoading && <small className="composer-hint">Checking connection setup…</small>}
          {setup && (!setup.keysPresent || setup.apiReachable === false || setup.tableReady === false) && <div className="form-error setup-error">
            <strong>Setup needed before connecting:</strong>
            <span>{!setup.keysPresent && '• Add REPLIZ_ACCESS_KEY + REPLIZ_SECRET_KEY in Vercel → Settings → Environment Variables, then try again.'}</span>
            {setup.keysPresent && setup.apiReachable === false && <span>• Repliz did not answer ({setup.apiDetail || 'check the keys and redeploy'}).</span>}
            {setup.tableReady === false && <span>• Run supabase/migrations/202609220012_woyoyo012.sql once in Supabase → SQL Editor.</span>}
          </div>}
          <div className="accounts-modal-list">
            {PLATFORMS.map((platform) => {
              const connection = status?.connections.find((c) => c.platform === platform);
              return <div key={platform} className="account-row">
                <PlatformBadge platform={platform} />
                <div><strong>{connection ? connection.account_handle : 'Not connected'}</strong><small>{connection ? 'Connected' : `Tap Connect to link your ${platformLabel(platform)} account`}</small></div>
                {connection
                  ? <button className="social-unlink" onClick={() => disconnect(connection.id)} disabled={busyKey === `conn-${connection.id}`} aria-label={`Disconnect ${platformLabel(platform)}`} title="Disconnect"><Unlink /></button>
                  : <button className="social-link" onClick={() => connect(platform)} disabled={busyKey === `connect-${platform}`}>{busyKey === `connect-${platform}` ? 'Connecting…' : 'Connect'}</button>}
              </div>;
            })}
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={syncAccounts} disabled={syncing}><RefreshCw className={syncing ? 'spin' : ''} /> {syncing ? 'Checking…' : 'Refresh'}</button>
            <button type="button" className="button-primary compact" onClick={() => setAccountsOpen(false)}>Done <Check /></button>
          </div>
        </>}
      </div>
    </Modal>}
  </section>;
}
