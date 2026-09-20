import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, Inbox as InboxIcon, Link2, MessageCircle, MessagesSquare, RefreshCw, Search, Send, Sparkles, Unlink } from 'lucide-react';
import Modal from './Modal';
import { apiFetch } from '../lib/api';
import type { SocialConnection, SocialMessage, SocialThread } from '../types';

export const PLATFORM_META = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'threads', label: 'Threads' },
];

const platformLabel = (id: string) => PLATFORM_META.find((p) => p.id === id)?.label || id;

export function PlatformLogo({ platform, size = 14 }: { platform: string; size?: number }) {
  const style = { width: size, height: size, flex: '0 0 auto' } as const;
  const common = { style, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true } as const;
  if (platform === 'tiktok') return <svg {...common}><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" /></svg>;
  if (platform === 'facebook') return <svg {...common}><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>;
  if (platform === 'instagram') return <svg {...common}><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 100-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 01-2.88 2.88 1.44 1.44 0 012.88-2.88z" /></svg>;
  if (platform === 'youtube') return <svg {...common}><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>;
  return (
    <svg style={style} viewBox="0 0 24 24" aria-hidden="true">
      <text x="12" y="17.5" textAnchor="middle" fontSize="16" fontWeight="900" fill="currentColor" fontFamily="Arial, sans-serif">@</text>
    </svg>
  );
}

export function PlatformTag({ platform, size }: { platform: string; size?: number }) {
  return (
    <span className={`platform-tag platform-${platform}`}>
      <PlatformLogo platform={platform} size={size || 13} />
      {platformLabel(platform)}
    </span>
  );
}

type StatusResponse = { mode: 'mock' | 'live'; connections: SocialConnection[]; unread: { total: number; by_platform: Record<string, number> } };
type InboxResponse = { threads: SocialThread[]; mode: 'mock' | 'live' };
type ConnectUrlResponse = { mode: 'mock' | 'live'; url: string | null };

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

function sourceNoun(platform: string, ref: string | null) {
  if (/video/i.test(ref || '')) return 'video';
  if (platform === 'tiktok' || platform === 'youtube') return 'video';
  return 'post';
}

function prettyRef(ref: string) {
  const cleaned = String(ref || '').replace(/[-_]+/g, ' ').trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : '';
}

export default function SocialInbox({ storeId, storeName, onActivity }: Props) {
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
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [connectBusy, setConnectBusy] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const [s, inbox] = await Promise.all([
        apiFetch<StatusResponse>(`/api/media?action=social&op=status&storeId=${storeId}`),
        apiFetch<InboxResponse>(`/api/media?action=social&op=inbox&storeId=${storeId}`),
      ]);
      setStatus(s);
      setThreads(inbox.threads || []);
      onActivity?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the inbox.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => threads.find((t) => t.thread_key === selectedKey) || null, [threads, selectedKey]);

  const visibleThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => {
      if (t.kind !== kindFilter) return false;
      if (unreadOnly && t.unread === 0) return false;
      if (q && !`${t.sender_name} ${t.sender_handle || ''} ${t.last_body}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [threads, kindFilter, query, unreadOnly]);

  const dmUnread = useMemo(() => threads.filter((t) => t.kind === 'dm').reduce((sum, t) => sum + t.unread, 0), [threads]);
  const commentUnread = useMemo(() => threads.filter((t) => t.kind === 'comment').reduce((sum, t) => sum + t.unread, 0), [threads]);

  const openThread = async (thread: SocialThread) => {
    setSelectedKey(thread.thread_key);
    setDetailOpen(true);
    setReply('');
    if (thread.unread > 0) {
      try {
        await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'read', store_id: storeId, thread_key: thread.thread_key }) });
        setThreads((current) => current.map((t) => t.thread_key === thread.thread_key ? { ...t, unread: 0, messages: t.messages.map((m) => ({ ...m, is_read: true })) } : t));
        setStatus((current) => current ? { ...current, unread: { total: Math.max(0, current.unread.total - thread.unread), by_platform: { ...current.unread.by_platform, [thread.platform]: 0 } } } : current);
        onActivity?.();
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
      setReply('');
      if (result.delivery && result.delivery.ok === false) setError(`Saved, but the live send failed: ${result.delivery.error || 'unknown error'}`);
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
      setThreads((current) => current.map((t) => t.thread_key === selected.thread_key ? { ...t, resolved: !t.resolved } : t));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that conversation.');
    } finally {
      setBusyKey('');
    }
  };

  const connectAccount = async (platform: string) => {
    if (connectBusy) return;
    setConnectBusy(platform);
    setAccountsError('');
    try {
      const init = await apiFetch<ConnectUrlResponse>(`/api/media?action=social&op=connect_url&storeId=${storeId}&platform=${platform}`);
      if (init.url) {
        const popup = window.open(init.url, 'repliz-connect', 'width=560,height=680');
        if (!popup) {
          setAccountsError('Please allow popups so the secure Repliz login window can open.');
          return;
        }
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('The Repliz login window timed out. Please try again.'));
          }, 300000);
          const handler = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === 'repliz-connected' && event.data?.platform === platform) {
              window.clearTimeout(timeout);
              window.removeEventListener('message', handler);
              resolve();
            } else if (event.data?.type === 'repliz-connect-error') {
              window.clearTimeout(timeout);
              window.removeEventListener('message', handler);
              reject(new Error(event.data?.message || 'The Repliz login did not complete.'));
            }
          };
          window.addEventListener('message', handler);
        });
        await load(true);
      } else {
        await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'connect', store_id: storeId, platform }) });
        await load(true);
      }
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : 'Could not connect that account.');
    } finally {
      setConnectBusy(null);
    }
  };

  const disconnect = async (connectionId: number) => {
    if (busyKey || !window.confirm('Disconnect this account? Posting to it will be disabled.')) return;
    setBusyKey(`conn-${connectionId}`);
    try {
      await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'disconnect', store_id: storeId, connection_id: connectionId }) });
      await load(true);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : 'Could not disconnect that account.');
    } finally {
      setBusyKey('');
    }
  };

  const seedDemo = async () => {
    if (seeding) return;
    setSeeding(true);
    setError('');
    try {
      await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'seed_demo', store_id: storeId }) });
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load demo messages.');
    } finally {
      setSeeding(false);
    }
  };

  if (loading) return <section className="social-inbox" aria-label="Inbox"><div className="social-loading"><RefreshCw className="spin" /> Opening your inbox…</div></section>;

  const connectedCount = status?.connections.length || 0;
  const isLive = status?.mode === 'live';

  return <section className="social-inbox" aria-label="Inbox">
    <div className="social-inbox-head">
      <div>
        <span className="eyebrow">{storeName} · social inbox</span>
        <h2>Inbox</h2>
        <p>DMs and comments from TikTok, Facebook, Instagram, YouTube and Threads — in one place.</p>
      </div>
      <div className="social-head-actions">
        <button className="accounts-button" onClick={() => { setAccountsError(''); setAccountsOpen(true); }}><Link2 /> Accounts <span>{connectedCount} of 5</span></button>
        <button className="secondary-button" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} /> Refresh</button>
      </div>
    </div>
    {error && <div className="form-error">{error}</div>}
      <div className="social-filters">
        <div className="social-filters-row">
          <div className="social-kind-tabs" role="group" aria-label="Choose DMs or comments">
            <button className={kindFilter === 'dm' ? 'active' : ''} onClick={() => setKindFilter('dm')}><MessageCircle /> DMs{dmUnread > 0 && <b>{dmUnread}</b>}</button>
            <button className={kindFilter === 'comment' ? 'active' : ''} onClick={() => setKindFilter('comment')}><MessagesSquare /> Comments{commentUnread > 0 && <b>{commentUnread}</b>}</button>
          </div>
          <label className="social-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or message…" /></label>
          <button className={`social-unread-toggle ${unreadOnly ? 'on' : ''}`} onClick={() => setUnreadOnly((value) => !value)}><CheckCheck /> Unread</button>
        </div>
      </div>

      {!threads.filter((t) => t.kind === kindFilter).length
        ? <div className="social-empty"><InboxIcon /><h3>No {kindFilter === 'dm' ? 'DMs' : 'comments'} yet</h3><p>Tap Accounts above to connect TikTok, Facebook, Instagram, YouTube and Threads, then load demo messages to see how the inbox works — or wait for real {kindFilter === 'dm' ? 'DMs' : 'comments'} to arrive.</p><button className="button-primary" onClick={seedDemo} disabled={seeding}>{seeding ? 'Loading…' : 'Load demo messages'} <Sparkles /></button></div>
        : !visibleThreads.length
          ? <div className="orders-empty">No conversations match these filters.</div>
          : <div className={`social-threads ${detailOpen && selected ? 'show-detail' : ''}`}>
            <div className="social-thread-list" role="list">
              {visibleThreads.map((thread) => <button key={thread.thread_key} role="listitem" className={`social-thread ${selectedKey === thread.thread_key ? 'active' : ''} ${thread.unread ? 'unread' : ''} ${thread.resolved ? 'resolved' : ''}`} onClick={() => openThread(thread)}>
                <span className="social-avatar">{(thread.sender_name || '?')[0]?.toUpperCase()}</span>
                <span className="social-thread-body">
                  <span className="social-thread-top"><strong>{thread.sender_name}</strong><small>{timeAgo(thread.last_at)}</small></span>
                  <span className="social-thread-meta"><PlatformTag platform={thread.platform} />{thread.resolved && <em>Resolved</em>}</span>
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
                  <div><strong>{selected.sender_name}</strong><small><PlatformTag platform={selected.platform} />{selected.sender_handle ? ` · ${selected.sender_handle}` : ''}</small></div>
                  <button className={`social-resolve ${selected.resolved ? 'done' : ''}`} onClick={toggleResolve} disabled={busyKey === 'resolve'}>{selected.resolved ? 'Reopen' : 'Resolve'} <Check /></button>
                </div>
                {selected.kind === 'comment' && <div className="social-source">
                  <span className="social-source-label"><MessagesSquare /> On your {platformLabel(selected.platform)} {sourceNoun(selected.platform, selected.source_ref)}</span>
                  {selected.source_post
                    ? <><p>{selected.source_post.caption}</p><small>Posted {fullTime(selected.source_post.posted_at)}</small></>
                    : selected.source_ref
                      ? <small>{prettyRef(selected.source_ref)}</small>
                      : <small>The original post is not linked.</small>}
                </div>}
                <div className="social-messages">
                  {selected.messages.map((message) => <div key={message.id} className={`social-bubble ${message.direction}`}>
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


    {accountsOpen && <Modal title="Connected accounts" onClose={() => setAccountsOpen(false)}>
      <div className="accounts-body">
        <p className="form-intro">{isLive ? 'Connect each platform through the secure Repliz login window. Posting and the inbox use these accounts.' : 'Tap Connect on each platform to link it for posting and the inbox.'}</p>
        {accountsError && <div className="form-error">{accountsError}</div>}
        <div className="accounts-list">
          {PLATFORM_META.map((platform) => {
            const connection = status?.connections.find((c) => c.platform === platform.id);
            return <div key={platform.id} className={`account-row ${connection ? 'on' : 'off'}`}>
              <PlatformLogo platform={platform.id} size={22} />
              <div><strong>{platform.label}</strong><small>{connection ? connection.account_handle : 'Not connected'}</small></div>
              {connection
                ? <span className="account-row-actions"><span className="account-on"><Check /> Connected</span><button className="social-unlink" onClick={() => disconnect(connection.id)} disabled={busyKey === `conn-${connection.id}`} aria-label={`Disconnect ${platform.label}`} title="Disconnect"><Unlink /></button></span>
                : <button className="social-link" onClick={() => connectAccount(platform.id)} disabled={connectBusy !== null}>{connectBusy === platform.id ? 'Connecting…' : 'Connect'}</button>}
            </div>;
          })}
        </div>
        <div className="modal-actions"><button className="button-primary" onClick={() => setAccountsOpen(false)}>Done <Check /></button></div>
      </div>
    </Modal>}
  </section>;
}
