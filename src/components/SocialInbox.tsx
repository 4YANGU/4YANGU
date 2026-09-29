import { clearOAuthReturn, getPendingState, resumeConnection, startConnection } from '../lib/socialOAuth';
import type { OAuthOutcome } from '../lib/socialOAuth';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, CheckCheck, ExternalLink, Inbox as InboxIcon, Link2, MessageCircle, MessagesSquare, Paperclip, Play, RefreshCw, Search, Send, Unlink } from 'lucide-react';
import Modal from './Modal';
import { apiFetch } from '../lib/api';
import PlatformLogo, { PlatformBadge, platformLabel } from './PlatformLogo';
import type { Order, SocialConnection, SocialMessage, SocialThread } from '../types';
import { readableMessage } from '../lib/messageText';
import { pushBackHandler } from '../lib/backNavigation';

const PLATFORMS = ['tiktok', 'facebook', 'instagram'];

type StatusResponse = { connections: SocialConnection[]; unread: { total: number; by_platform?: Record<string, number> } };
type InboxResponse = { threads: SocialThread[] };

type Props = { storeId: number; storeName: string; onActivity?: () => void };

function dateLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (messageDay === start) return 'Today';
  if (messageDay === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeLabel(iso: string) {
  const day = dateLabel(iso);
  return day === 'Today' ? new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false }) : day;
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function SocialInbox({ storeId, onActivity }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [threads, setThreads] = useState<SocialThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [kindFilter, setKindFilter] = useState<'all'>('all');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const chatOpenRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');
  const [setup, setSetup] = useState<{ keysPresent: boolean; apiReachable: boolean | null; apiDetail: string; tableReady: boolean | null; tableDetail: string } | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [picker, setPicker] = useState<{ platform: string; state: string; choices: Array<{ id: string; name: string; username: string; picture: string }> } | null>(null);
  const [picking, setPicking] = useState(false);
  const loadRef = useRef<() => void>(() => undefined);
  const knownInbound = useRef<Set<number> | null>(null);
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
      const [s, inbox, orderResult] = await Promise.allSettled([
        apiFetch<StatusResponse>(`/api/media?action=social&op=status&storeId=${storeId}`),
        apiFetch<InboxResponse>(`/api/media?action=social&op=inbox&storeId=${storeId}`),
        apiFetch<Order[]>(`/api/orders?storeId=${storeId}`),
      ]);
      if (inbox.status === 'rejected' && orderResult.status === 'rejected') throw inbox.reason;
      if (s.status === 'fulfilled') setStatus(s.value);
      const allThreads = inbox.status === 'fulfilled' ? [...(inbox.value.threads || [])] : [];
      if (orderResult.status === 'fulfilled') for (const order of orderResult.value) {
        const threadKey = `order:${order.order_key || order.id}`;
        if (allThreads.some(thread => thread.thread_key === threadKey)) continue;
        const body = `Store Order: ${order.product_name} · KES ${Number(order.product_price || 0).toLocaleString('en-KE')}${order.color ? ` · ${order.color}` : ''}${order.size ? ` · ${order.size}` : ''}. ${order.fulfilment || 'Delivery'}. ${order.note || ''}`.trim();
        const message: SocialMessage = { id: -Math.abs(order.id), store_id: storeId, platform: 'storefront', kind: 'dm', thread_key: threadKey, sender_name: order.customer_phone, sender_handle: order.customer_phone, sender_avatar: null, body, direction: 'in', is_read: false, is_resolved: false, external_id: order.order_key, post_ref: '', post_title: order.product_name, post_url: '', created_at: order.created_at };
        allThreads.push({ thread_key: threadKey, platform: 'storefront', kind: 'dm', sender_name: order.customer_phone, sender_handle: order.customer_phone, sender_avatar: null, last_body: body, last_at: order.created_at, unread: 1, resolved: false, source_ref: '', source_title: order.product_name, source_url: '', messages: [message] });
      }
      allThreads.sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime());
      setThreads(allThreads);
      const incoming = allThreads.flatMap(thread => thread.messages.filter(message => message.direction === 'in'));
      if (knownInbound.current && 'Notification' in window && Notification.permission === 'granted') {
        for (const message of incoming.filter(item => !knownInbound.current?.has(item.id)).slice(0, 4)) {
          new Notification(message.platform === 'storefront' ? 'Store Order' : message.kind === 'comment' ? 'New comment' : 'New message', { body: readableMessage(message.body).slice(0, 140), icon: '/favicon-192.png', tag: `inbox-${message.id}` });
        }
      }
      knownInbound.current = new Set(incoming.map(message => message.id));
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
  useEffect(() => {
    chatOpenRef.current = detailOpen;
  }, [detailOpen]);

  const closeThread = useCallback(() => {
    chatOpenRef.current = false;
    setDetailOpen(false);
    setSelectedKey(null);
    setReply('');
    setAttachment(null);
    if (window.history.state?.stoyanguChat) {
      window.history.back();
    }
  }, []);

  // Phone hardware back button & gesture navigation handler
  useEffect(() => {
    if (!detailOpen && !accountsOpen && !picker) return;
    return pushBackHandler(() => {
      if (picker) {
        setPicker(null);
        return true;
      }
      if (accountsOpen) {
        setAccountsOpen(false);
        setNotice('');
        return true;
      }
      if (detailOpen) {
        chatOpenRef.current = false;
        setDetailOpen(false);
        setSelectedKey(null);
        setReply('');
        setAttachment(null);
        return true;
      }
      return false;
    });
  }, [detailOpen, accountsOpen, picker]);

  useEffect(() => {
    const onBack = () => {
      if (chatOpenRef.current) {
        chatOpenRef.current = false;
        setDetailOpen(false); setSelectedKey(null); setReply(''); setAttachment(null);
        return;
      }
      if (picker) {
        setPicker(null);
        return;
      }
      if (accountsOpen) {
        setAccountsOpen(false); setPicker(null); setNotice('');
        return;
      }
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [accountsOpen, picker]);

  const dmUnread = useMemo(() => threads.filter((t) => t.kind === 'dm').reduce((sum, t) => sum + t.unread, 0), [threads]);
  const commentUnread = useMemo(() => threads.filter((t) => t.kind === 'comment').reduce((sum, t) => sum + t.unread, 0), [threads]);

  const visibleThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => {
      if (unreadOnly && t.unread === 0) return false;
      if (q && !`${t.sender_name} ${t.sender_handle || ''} ${t.last_body}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [threads, query, unreadOnly]);

  const switchKind = (kind: 'all') => {
    setKindFilter(kind);
    setSelectedKey(null);
    setDetailOpen(false);
    setReply('');
  };

  const openThread = async (thread: SocialThread) => {
    window.history.pushState({ stoyanguChat: thread.thread_key }, '', window.location.href);
    chatOpenRef.current = true;
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
    if (!selected || (!reply.trim() && !attachment) || sending) return;
    setSending(true);
    setError('');
    try {
      let attachmentUrl = '';
      if (attachment) {
        const contentType = attachment.type || (/\.(mp4|m4v)$/i.test(attachment.name) ? 'video/mp4' : /\.mov$/i.test(attachment.name) ? 'video/quicktime' : /\.webm$/i.test(attachment.name) ? 'video/webm' : 'image/jpeg');
        const video = contentType.startsWith('video/');
        if (attachment.size > (video ? 75 : 15) * 1024 * 1024) throw new Error(video ? 'Videos must be under 75 MB.' : 'Attachments must be under 15 MB.');
        if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm)|application\/pdf)$/.test(contentType)) throw new Error('Choose a photo, video or PDF attachment.');
        const signed = await apiFetch<{ signedUrl: string; url: string }>('/api/media?action=post-upload-url', { method: 'POST', body: JSON.stringify({ fileName: attachment.name, contentType, kind: video ? 'video' : contentType === 'application/pdf' ? 'document' : 'image' }) });
        const uploaded = await fetch(signed.signedUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: attachment });
        if (!uploaded.ok) throw new Error('Attachment upload failed. Please try again.');
        attachmentUrl = signed.url;
      }
      const result = await apiFetch<{ message: SocialMessage; delivery?: { ok?: boolean; error?: string } }>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: 'reply', store_id: storeId, thread_key: selected.thread_key, body: reply.trim(), attachment_url: attachmentUrl, attachment_name: attachment?.name }),
      });
      setThreads((current) => current.map((t) => t.thread_key === selected.thread_key ? { ...t, last_at: result.message.created_at, last_body: result.message.body, resolved: false, messages: [...t.messages, result.message] } : t));
      setReply(''); setAttachment(null); await load(true);
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

  const openAccounts = () => {
    window.history.pushState({ stoyanguAccounts: true }, '', window.location.href);
    setAccountsOpen(true);
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
        <h2>My Customers</h2>
        <span className="inbox-platform-strip" aria-label="TikTok, Facebook, Instagram, WhatsApp">{PLATFORMS.map((platform) => <PlatformLogo key={platform} platform={platform} size={20} />)}<PlatformLogo platform="whatsapp" size={20} /></span>
      </div>
      <div className="social-head-actions">
        <button className="inbox-accounts-icon" onClick={openAccounts} aria-label="Connected accounts" title={`Connected accounts · ${connectedCount} of 5`}><Link2 />{connectedCount < 5 && <b>{connectedCount}/5</b>}</button>
        <button className="inbox-refresh-icon" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh inbox" title="Refresh inbox"><RefreshCw className={refreshing ? 'spin' : ''} /></button>
      </div>
    </div>
    {error && <div className="form-error">{error}</div>}
    {!error && notice && <div className="form-success">{notice}</div>}
    <div className="social-filters">
      <div className="social-filters-row">
        <label className="social-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customers…" /></label>
        <button className={`social-unread-toggle ${unreadOnly ? 'on' : ''}`} onClick={() => setUnreadOnly((value) => !value)}><CheckCheck /> Unread</button>
      </div>
    </div>

    {!threads.length
      ? <div className="social-empty"><InboxIcon /><h3>No customers yet</h3><p>Connect your accounts above. New messages and comments will appear here.</p></div>
      : !visibleThreads.length
        ? <div className="orders-empty">No customers match these filters.</div>
        : <div className={`social-threads ${detailOpen && selected ? 'show-detail fullscreen-chat' : ''}`}>
          <div className="social-thread-list" role="list">
            {visibleThreads.map((thread) => <button key={thread.thread_key} role="listitem" className={`social-thread ${selectedKey === thread.thread_key ? 'active' : ''} ${thread.unread ? 'unread' : ''} ${thread.resolved ? 'resolved' : ''}`} onClick={() => openThread(thread)}>
              <span className="social-avatar-wrap">
                {thread.sender_avatar ? <img className="social-avatar" src={thread.sender_avatar} alt="" /> : <span className="social-avatar">{(thread.sender_name || '?')[0]?.toUpperCase()}</span>}
                <span className="social-avatar-platform"><PlatformLogo platform={thread.platform} size={12} /></span>
              </span>
              <span className="social-thread-body">
                <span className="social-thread-top"><strong>{thread.sender_name}</strong><small>{timeLabel(thread.last_at)}</small></span>
                <span className="social-thread-meta">{thread.platform === 'storefront' ? 'Store Order' : thread.kind === 'dm' ? 'DM' : 'Comment'}{thread.resolved && <em>Resolved</em>}</span>
                {thread.kind === 'comment' && (thread.source_title || thread.source_ref) && <span className="thread-source-line"><Play />{thread.source_title || thread.source_ref}</span>}
                <span className="social-thread-preview">{readableMessage(thread.last_body)}</span>
              </span>
              {thread.unread > 0 && <b className="social-unread">{thread.unread}</b>}
            </button>)}
          </div>
          <div className="social-thread-detail">
            {selected ? <>
              <div className="social-detail-head">
                <button className="social-back" onClick={closeThread} aria-label="Back to customers"><ArrowLeft /></button>
                <span className="social-avatar-wrap">
                  {selected.sender_avatar ? <img className="social-avatar" src={selected.sender_avatar} alt="" /> : <span className="social-avatar">{(selected.sender_name || '?')[0]?.toUpperCase()}</span>}
                  <span className="social-avatar-platform"><PlatformLogo platform={selected.platform} size={12} /></span>
                </span>
                <div><strong>{selected.sender_name}</strong><small>{selected.platform === 'storefront' ? 'Store Order' : selected.kind === 'dm' ? 'DM' : 'Comment'}{selected.sender_handle ? ` · ${selected.sender_handle}` : ''}</small></div>
                {selected.platform === 'storefront' && selected.sender_handle && <div className="website-order-actions"><a className="chat-whatsapp" href={`https://wa.me/${selected.sender_handle.replace(/\D/g, '')}?text=${encodeURIComponent(reply || 'Hello! Thank you for your store order.')}`} target="_blank" rel="noreferrer">Reply via WhatsApp</a><a className="chat-call" href={`tel:${selected.sender_handle.replace(/[^\d+]/g, '')}`}>Call</a></div>}<button className={`social-resolve ${selected.resolved ? 'done' : ''}`} onClick={toggleResolve} disabled={busyKey === 'resolve'}>{selected.resolved ? 'Reopen' : 'Resolve'} <Check /></button>
              </div>
              {selected.kind === 'comment' && (selected.source_title || selected.source_ref) && <div className="comment-source-card">
                <span className="comment-source-thumb"><Play /></span>
                <div><small>Comment on</small><strong>{selected.source_title || 'Original post'}</strong>{selected.source_ref && selected.source_title !== selected.source_ref && <span>{selected.source_ref}</span>}</div>
                {selected.source_url && <a href={selected.source_url} target="_blank" rel="noreferrer"><ExternalLink /> View</a>}
              </div>}
              <div className="social-messages">
                {selected.messages.map((message, index) => <Fragment key={message.id}>{(index === 0 || dateLabel(message.created_at) !== dateLabel(selected.messages[index - 1].created_at)) && <div className="chat-day-divider">{dateLabel(message.created_at)}</div>}<div className={`social-bubble ${message.direction}`}>
                  <span className="bubble-platform"><PlatformLogo platform={message.platform} size={11} />{platformLabel(message.platform)}</span>
                  <p>{readableMessage(message.body)}</p>{message.attachment_url && <a className="chat-attachment" href={message.attachment_url} target="_blank" rel="noreferrer">{message.attachment_url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i) ? <img src={message.attachment_url} alt={message.attachment_name || "Attached photo"} loading="lazy" /> : <><Paperclip size={16} /> {message.attachment_name || "View attachment"}</>}</a>}
                  <small>{fullTime(message.created_at)}{message.direction === 'out' ? ' · you' : ''}</small>
                </div></Fragment>)}
              </div>
              <form className="social-reply" onSubmit={sendReply}>
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Message" rows={1} maxLength={2000} /><input ref={cameraInput} hidden type="file" accept="image/*,video/*" capture="environment" onChange={event => { setAttachment(event.target.files?.[0] || null); event.target.value = ""; }} /><button className="social-camera" type="button" onClick={() => cameraInput.current?.click()} aria-label="Take a photo or video"><Camera size={20} /></button><button className="social-send" aria-label="Send message" disabled={sending || (!reply.trim() && !attachment)}><Send size={19} /></button>{attachment && <span className="attachment-chip">{attachment.name}<button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">×</button></span>}
              </form>
            </> : <div className="social-detail-placeholder"><MessagesSquare /><p>Select a customer to read and reply.</p></div>}
          </div>
        </div>}
    {accountsOpen && <Modal title={`Connected accounts · ${connectedCount} of 3`} onClose={() => { setAccountsOpen(false); setPicker(null); setNotice(''); }}>
      <div className="accounts-modal-body">{error && <div className="form-error" role="alert">{error}</div>}{!error && notice && <div className="form-success">{notice}</div>}
        {picker ? <>
          <p className="form-intro">Choose the Facebook Page to connect.</p>
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
