import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, AtSign, Check, CheckCheck, Inbox as InboxIcon, Link2, MessageCircle, MessagesSquare, RefreshCw, Search, Send, Sparkles, Unlink, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { SocialConnection, SocialMessage, SocialPost, SocialThread } from '../types';

const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok', dot: '#111111' },
  { id: 'facebook', label: 'Facebook', dot: '#1877F2' },
  { id: 'instagram', label: 'Instagram', dot: '#E1306C' },
  { id: 'youtube', label: 'YouTube', dot: '#FF0000' },
  { id: 'threads', label: 'Threads', dot: '#6b7280' },
];

const platformLabel = (id: string) => PLATFORMS.find((p) => p.id === id)?.label || id;
const platformDot = (id: string) => PLATFORMS.find((p) => p.id === id)?.dot || '#5a966e';

type StatusResponse = { mode: 'mock' | 'live'; connections: SocialConnection[]; unread: { total: number; by_platform: Record<string, number> } };
type InboxResponse = { threads: SocialThread[]; mode: 'mock' | 'live' };
type PostsResponse = { posts: SocialPost[] };

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

export default function SocialInbox({ storeId, storeName, onActivity }: Props) {
  const [view, setView] = useState<'messages' | 'posts'>('messages');
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [threads, setThreads] = useState<SocialThread[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'dm' | 'comment'>('all');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectHandle, setConnectHandle] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const [s, inbox, p] = await Promise.all([
        apiFetch<StatusResponse>(`/api/media?action=social&op=status&storeId=${storeId}`),
        apiFetch<InboxResponse>(`/api/media?action=social&op=inbox&storeId=${storeId}`),
        apiFetch<PostsResponse>(`/api/media?action=social&op=posts&storeId=${storeId}`),
      ]);
      setStatus(s);
      setThreads(inbox.threads || []);
      setPosts(p.posts || []);
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
      if (platformFilter !== 'all' && t.platform !== platformFilter) return false;
      if (kindFilter !== 'all' && t.kind !== kindFilter) return false;
      if (unreadOnly && t.unread === 0) return false;
      if (q && !`${t.sender_name} ${t.sender_handle || ''} ${t.last_body}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [threads, platformFilter, kindFilter, query, unreadOnly]);

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

  const startConnect = (platform: string) => {
    setConnecting(platform);
    setConnectHandle(`@${storeName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'mystore'}`);
  };

  const saveConnection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!connecting || busyKey) return;
    setBusyKey('connect');
    setError('');
    try {
      await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'connect', store_id: storeId, platform: connecting, handle: connectHandle.trim() }) });
      setConnecting(null);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect that account.');
    } finally {
      setBusyKey('');
    }
  };

  const disconnect = async (connectionId: number) => {
    if (busyKey || !window.confirm('Disconnect this account? Posting to it will be disabled.')) return;
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
        <span className="eyebrow">Powered by Repliz · {isLive ? 'Live' : 'Demo mode'}</span>
        <h2>Inbox</h2>
        <p>DMs and comments from TikTok, Facebook, Instagram, YouTube and Threads — in one place.</p>
      </div>
      <button className="secondary-button" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} /> Refresh</button>
    </div>
    {error && <div className="form-error">{error}</div>}
    <div className="social-view-tabs" role="tablist" aria-label="Inbox views">
      <button className={view === 'messages' ? 'active' : ''} onClick={() => setView('messages')}><MessageCircle /> Messages</button>
      <button className={view === 'posts' ? 'active' : ''} onClick={() => setView('posts')}><Send /> Posts</button>
    </div>

    {view === 'messages' ? <>
      <div className="social-connections">
        <div className="social-connections-head"><Link2 /><strong>Connected accounts</strong><small>{connectedCount} of 5 connected</small></div>
        <div className="social-connection-grid">
          {PLATFORMS.map((platform) => {
            const connection = status?.connections.find((c) => c.platform === platform.id);
            return <div key={platform.id} className={`social-connection ${connection ? 'on' : 'off'}`}>
              <span className="social-dot" style={{ background: platformDot(platform.id) }} />
              <div><strong>{platform.label}</strong><small>{connection ? connection.account_handle : 'Not connected'}</small></div>
              {connection
                ? <button className="social-unlink" onClick={() => disconnect(connection.id)} disabled={busyKey === `conn-${connection.id}`} aria-label={`Disconnect ${platform.label}`} title="Disconnect"><Unlink /></button>
                : <button className="social-link" onClick={() => startConnect(platform.id)}>Connect</button>}
            </div>;
          })}
        </div>
        {connecting && <form className="social-connect-form" onSubmit={saveConnection}>
          <label><AtSign /> {platformLabel(connecting)} handle<input value={connectHandle} onChange={(event) => setConnectHandle(event.target.value)} placeholder="@yourhandle" maxLength={60} autoFocus /></label>
          <div><button type="button" className="secondary-button" onClick={() => setConnecting(null)}><X /> Cancel</button><button className="button-primary compact" disabled={busyKey === 'connect' || !connectHandle.trim()}>{busyKey === 'connect' ? 'Connecting…' : 'Connect account'} <Check /></button></div>
          {!isLive && <small><Sparkles /> Demo mode: this creates a test connection so posting and inbox work instantly. No real login needed.</small>}
        </form>}
      </div>

      <div className="social-filters">
        <div className="social-platform-chips" role="group" aria-label="Filter by platform">
          <button className={platformFilter === 'all' ? 'active' : ''} onClick={() => setPlatformFilter('all')}>All{(status?.unread.total || 0) > 0 && <b>{status?.unread.total}</b>}</button>
          {PLATFORMS.map((platform) => {
            const count = status?.unread.by_platform[platform.id] || 0;
            return <button key={platform.id} className={platformFilter === platform.id ? 'active' : ''} onClick={() => setPlatformFilter(platform.id)}><span className="social-dot" style={{ background: platformDot(platform.id) }} />{platform.label}{count > 0 && <b>{count}</b>}</button>;
          })}
        </div>
        <div className="social-filters-row">
          <div className="social-kind-tabs">
            <button className={kindFilter === 'all' ? 'active' : ''} onClick={() => setKindFilter('all')}>All</button>
            <button className={kindFilter === 'dm' ? 'active' : ''} onClick={() => setKindFilter('dm')}><MessageCircle /> DMs</button>
            <button className={kindFilter === 'comment' ? 'active' : ''} onClick={() => setKindFilter('comment')}><MessagesSquare /> Comments</button>
          </div>
          <label className="social-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or message…" /></label>
          <button className={`social-unread-toggle ${unreadOnly ? 'on' : ''}`} onClick={() => setUnreadOnly((value) => !value)}><CheckCheck /> Unread</button>
        </div>
      </div>

      {!threads.length
        ? <div className="social-empty"><InboxIcon /><h3>No conversations yet</h3><p>Connect your accounts above, then load demo messages to see how the inbox works — or wait for real DMs and comments to arrive.</p><button className="button-primary" onClick={seedDemo} disabled={seeding}>{seeding ? 'Loading…' : 'Load demo messages'} <Sparkles /></button></div>
        : !visibleThreads.length
          ? <div className="orders-empty">No conversations match these filters.</div>
          : <div className={`social-threads ${detailOpen && selected ? 'show-detail' : ''}`}>
            <div className="social-thread-list" role="list">
              {visibleThreads.map((thread) => <button key={thread.thread_key} role="listitem" className={`social-thread ${selectedKey === thread.thread_key ? 'active' : ''} ${thread.unread ? 'unread' : ''} ${thread.resolved ? 'resolved' : ''}`} onClick={() => openThread(thread)}>
                <span className="social-avatar">{(thread.sender_name || '?')[0]?.toUpperCase()}</span>
                <span className="social-thread-body">
                  <span className="social-thread-top"><strong>{thread.sender_name}</strong><small>{timeAgo(thread.last_at)}</small></span>
                  <span className="social-thread-meta"><span className="social-dot" style={{ background: platformDot(thread.platform) }} />{platformLabel(thread.platform)} · {thread.kind === 'dm' ? 'DM' : 'Comment'}{thread.resolved && <em>Resolved</em>}</span>
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
                  <div><strong>{selected.sender_name}</strong><small><span className="social-dot" style={{ background: platformDot(selected.platform) }} />{platformLabel(selected.platform)} · {selected.kind === 'dm' ? 'DM' : 'Comment'}{selected.sender_handle ? ` · ${selected.sender_handle}` : ''}</small></div>
                  <button className={`social-resolve ${selected.resolved ? 'done' : ''}`} onClick={toggleResolve} disabled={busyKey === 'resolve'}>{selected.resolved ? 'Reopen' : 'Resolve'} <Check /></button>
                </div>
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
    </> : <div className="social-posts">
      {!posts.length
        ? <div className="social-empty"><Send /><h3>No posts yet</h3><p>Tap the <b>+</b> button below to write once and post to every connected platform.</p></div>
        : posts.map((post) => <article key={post.id} className="social-post">
          <div className="social-post-head">
            <span className={`social-post-status ${post.status}`}>{post.status === 'posted' ? 'Posted' : 'Draft'}</span>
            <small>{fullTime(post.posted_at || post.created_at)}{!isLive && post.status === 'posted' ? ' · demo' : ''}</small>
          </div>
          <p>{post.caption}</p>
          {post.media_urls?.length > 0 && <div className="social-post-media">{post.media_urls.slice(0, 4).map((url) => <img key={url} src={url} alt="Post attachment" />)}</div>}
          <div className="social-post-results">
            {(post.platforms || []).map((platform) => {
              const result = post.results?.[platform] as { ok?: boolean; external_id?: string; error?: string } | undefined;
              return <span key={platform} className={`social-result ${result?.ok ? 'ok' : result ? 'fail' : ''}`} title={result?.external_id || result?.error || ''}><span className="social-dot" style={{ background: platformDot(platform) }} />{platformLabel(platform)}{result ? (result.ok ? <Check /> : <X />) : null}</span>;
            })}
          </div>
        </article>)}
    </div>}
  </section>;
}
