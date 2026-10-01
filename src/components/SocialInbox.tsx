import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, CheckCheck, ExternalLink, Inbox as InboxIcon, MessagesSquare, Paperclip, Play, RefreshCw, Search, Send } from 'lucide-react';
import MediaCaptureSheet from './MediaCaptureSheet';
import { apiFetch, readCachedApi } from '../lib/api';
import PlatformLogo from './PlatformLogo';
import { platformLabel } from '../lib/platforms';
import { SOCIAL_PLATFORMS } from '../lib/socialPlatforms';
import type { Order, SocialMessage, SocialThread } from '../types';
import { readableMessage } from '../lib/messageText';
import { clearHistoryFlag, pushBackHandler, pushHistoryFlag } from '../lib/backNavigation';
import supabase from '../lib/supabase';

const PLATFORMS = SOCIAL_PLATFORMS;

type InboxResponse = { threads: SocialThread[] };

type Props = { storeId: number; storeName: string; active?: boolean; refreshSignal?: number; onActivity?: () => void };

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

function mergeInboxThreads(storeId: number, inbox?: InboxResponse, orders?: Order[]) {
  const allThreads = [...(inbox?.threads || [])];
  for (const order of orders || []) {
    const threadKey = `order:${order.order_key || order.id}`;
    if (allThreads.some(thread => thread.thread_key === threadKey)) continue;
    const body = `Store Order: ${order.product_name} · KES ${Number(order.product_price || 0).toLocaleString('en-KE')}${order.color ? ` · ${order.color}` : ''}${order.size ? ` · ${order.size}` : ''}. ${order.fulfilment || 'Delivery'}. ${order.note || ''}`.trim();
    const message: SocialMessage = { id: -Math.abs(order.id), store_id: storeId, platform: 'storefront', kind: 'dm', thread_key: threadKey, sender_name: order.customer_phone, sender_handle: order.customer_phone, sender_avatar: null, body, direction: 'in', is_read: false, is_resolved: false, external_id: order.order_key, post_ref: '', post_title: order.product_name, post_url: '', created_at: order.created_at };
    allThreads.push({ thread_key: threadKey, platform: 'storefront', kind: 'dm', sender_name: order.customer_phone, sender_handle: order.customer_phone, sender_avatar: null, last_body: body, last_at: order.created_at, unread: 1, resolved: false, source_ref: '', source_title: order.product_name, source_url: '', messages: [message] });
  }
  return allThreads.sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime());
}

export default function SocialInbox({ storeId, onActivity, active = true, refreshSignal = 0 }: Props) {
  const [threads, setThreads] = useState<SocialThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const hasLoadedRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const chatOpenRef = useRef(false);
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<() => void>(() => undefined);
  const liveRefreshTimer = useRef<number | undefined>(undefined);
  const lastRefreshSignal = useRef(refreshSignal);
  const load = useCallback(async (silent = false, background = false, syncNow = false) => {
    if (!active) return;
    if (background) { /* background refreshes stay quiet */ }
    else if (silent || hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    if (!background) setError('');
    try {
      if (background || syncNow) {
        // Pull recent provider messages before reading the inbox. The server
        // cron covers closed-app alerts; this keeps the open app current too.
        await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'sync_inbox', store_id: storeId }) }).catch(() => undefined);
      }
      const [inbox, orderResult] = await Promise.allSettled([
        apiFetch<InboxResponse>(`/api/media?action=social&op=inbox&storeId=${storeId}`),
        apiFetch<Order[]>(`/api/orders?storeId=${storeId}`),
      ]);
      if (inbox.status === 'rejected' && orderResult.status === 'rejected') throw inbox.reason;
      const allThreads = mergeInboxThreads(
        storeId,
        inbox.status === 'fulfilled' ? inbox.value : undefined,
        orderResult.status === 'fulfilled' ? orderResult.value : undefined,
      );
      setThreads(allThreads);
      setError('');
      hasLoadedRef.current = true;
      setHasLoaded(true);
      onActivity?.();
    } catch (err) {
      if (!background) setError(err instanceof Error ? err.message : 'Could not load the inbox.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, active]);

  const scheduleLiveRefresh = useCallback(() => {
    if (liveRefreshTimer.current !== undefined) window.clearTimeout(liveRefreshTimer.current);
    liveRefreshTimer.current = window.setTimeout(() => {
      liveRefreshTimer.current = undefined;
      void load(true, false, false);
    }, 100);
  }, [load]);

  useEffect(() => () => {
    if (liveRefreshTimer.current !== undefined) window.clearTimeout(liveRefreshTimer.current);
  }, []);

  useEffect(() => {
    if (!active || hasLoadedRef.current) return;
    let alive = true;
    void Promise.all([
      readCachedApi<InboxResponse>(`/api/media?action=social&op=inbox&storeId=${storeId}`),
      readCachedApi<Order[]>(`/api/orders?storeId=${storeId}`),
    ]).then(([inbox, orders]) => {
      if (!alive || hasLoadedRef.current || (inbox === undefined && orders === undefined)) return;
      setThreads(mergeInboxThreads(storeId, inbox, orders));
      hasLoadedRef.current = true;
      setHasLoaded(true);
      setLoading(false);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [active, storeId]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => { void load(hasLoadedRef.current, false, true); }, 0);
    return () => window.clearTimeout(timer);
  }, [active, load]);
  useEffect(() => { loadRef.current = () => { if (active) void load(true, true, true); }; }, [active, load]);
  useEffect(() => {
    if (lastRefreshSignal.current === refreshSignal) return;
    lastRefreshSignal.current = refreshSignal;
    if (!active) return;
    const timer = window.setTimeout(() => { void load(true, true, true); }, 0);
    return () => window.clearTimeout(timer);
  }, [active, load, refreshSignal]);
  useEffect(() => {
    if (!active) return;
    const channel = supabase
      .channel(`social-inbox-${storeId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'social_messages',
        filter: `store_id=eq.${storeId}`,
      }, (event) => {
        const message = event.new as SocialMessage;
        if (message.direction === 'in') scheduleLiveRefresh();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [active, scheduleLiveRefresh, storeId]);

  useEffect(() => {
    if (!active || !('serviceWorker' in navigator)) return;
    const onServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; storeId?: number | string } | null;
      if (message?.type !== 'stoyangu-inbox-update') return;
      const messageStoreId = Number(message.storeId);
      if (Number.isSafeInteger(messageStoreId) && messageStoreId > 0 && messageStoreId !== storeId) return;
      scheduleLiveRefresh();
    };
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
  }, [active, scheduleLiveRefresh, storeId]);

  useEffect(() => {
    const onOnline = () => { if (active) void load(true, true, true); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [active, load]);

  // Realtime handles new rows immediately; this 20-second sync is only a
  // recovery check if the live connection or webhook is temporarily unavailable.
  // The mounted view is retained when the owner switches tabs.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const focused = document.activeElement;
      if (focused && (focused.tagName === 'TEXTAREA' || focused.tagName === 'INPUT')) return;
      loadRef.current();
    }, 20000);
    const onVisible = () => { if (active && !document.hidden) loadRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [active]);

  const selected = useMemo(() => threads.find((t) => t.thread_key === selectedKey) || null, [threads, selectedKey]);
  useEffect(() => {
    chatOpenRef.current = active && detailOpen;
  }, [active, detailOpen]);

  const closeThread = useCallback(() => {
    chatOpenRef.current = false;
    setDetailOpen(false);
    setSelectedKey(null);
    setReply('');
    setAttachment(null);
    clearHistoryFlag('stoyanguChat');
  }, []);

  useEffect(() => {
    if (active) return;
    chatOpenRef.current = false;
    clearHistoryFlag('stoyanguChat');
  }, [active]);

  // Phone hardware back button & gesture navigation handler.
  useEffect(() => {
    if (!active || !detailOpen) return;
    return pushBackHandler(() => {
      if (mediaPickerOpen) {
        setMediaPickerOpen(false);
        pushHistoryFlag('stoyanguChat', selectedKey);
        return true;
      }
      closeThread();
      return true;
    });
  }, [active, closeThread, detailOpen, mediaPickerOpen, selectedKey]);

  useEffect(() => {
    const onBack = () => {
      // Returning from the nested camera/gallery sheet lands on this chat's
      // history entry; it must not also close the conversation.
      if (window.history.state?.stoyanguChat || !active || !chatOpenRef.current) return;
      chatOpenRef.current = false;
      setDetailOpen(false); setSelectedKey(null); setReply(''); setAttachment(null);
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [active]);

  // Use the visual viewport while the phone keyboard is visible. CSS 100vh
  // follows the layout viewport on several mobile browsers and used to leave
  // a large blank strip between the keyboard and composer.
  useEffect(() => {
    if (!active || !detailOpen || !window.matchMedia('(max-width: 720px)').matches) return;
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const height = viewport?.height || window.innerHeight;
      const top = viewport?.offsetTop || 0;
      document.documentElement.style.setProperty('--chat-viewport-height', `${height}px`);
      document.documentElement.style.setProperty('--chat-viewport-top', `${top}px`);
      window.requestAnimationFrame(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }));
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    return () => {
      document.body.style.overflow = previousOverflow;
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      document.documentElement.style.removeProperty('--chat-viewport-height');
      document.documentElement.style.removeProperty('--chat-viewport-top');
    };
  }, [active, detailOpen]);

  useEffect(() => {
    window.requestAnimationFrame(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }));
  }, [selected?.messages.length, selectedKey]);

  const visibleThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => {
      if (unreadOnly && t.unread === 0) return false;
      if (q && !`${t.sender_name} ${t.sender_handle || ''} ${t.last_body}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [threads, query, unreadOnly]);

  const openThread = async (thread: SocialThread) => {
    pushHistoryFlag('stoyanguChat', thread.thread_key);
    chatOpenRef.current = true;
    setSelectedKey(thread.thread_key);
    setDetailOpen(true);
    setReply('');
    if (thread.unread > 0) {
      try {
        await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'read', store_id: storeId, thread_key: thread.thread_key }) });
        setThreads((current) => current.map((t) => t.thread_key === thread.thread_key ? { ...t, unread: 0, messages: t.messages.map((m) => ({ ...m, is_read: true })) } : t));
        await load(true, true); onActivity?.();
      } catch { /* conversation still opens for reading */ }
    }
  };

  const sendReply = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!selected || (!reply.trim() && !attachment) || sending) return;

    const thread = selected;
    const messageText = reply.trim();
    const attachmentFile = attachment;
    const optimisticId = -Date.now();
    const optimisticTime = new Date().toISOString();
    const optimisticAttachment = attachmentFile ? URL.createObjectURL(attachmentFile) : null;
    const optimisticMessage: SocialMessage = {
      id: optimisticId,
      store_id: storeId,
      platform: thread.platform,
      kind: thread.kind,
      thread_key: thread.thread_key,
      sender_name: 'You',
      sender_handle: null,
      sender_avatar: null,
      body: messageText || (attachmentFile ? `Attachment: ${attachmentFile.name}` : ''),
      direction: 'out',
      is_read: true,
      is_resolved: false,
      external_id: null,
      post_ref: thread.source_ref,
      post_title: thread.source_title,
      post_url: thread.source_url,
      attachment_url: optimisticAttachment,
      attachment_name: attachmentFile?.name || null,
      created_at: optimisticTime,
    };

    // Clear the composer and paint the bubble before doing any network work.
    // This keeps sending feeling instant even on a slow mobile connection.
    setReply('');
    setAttachment(null);
    setSending(true);
    setError('');
    setThreads((current) => current.map((item) => item.thread_key === thread.thread_key
      ? { ...item, last_at: optimisticTime, last_body: optimisticMessage.body, resolved: false, messages: [...item.messages, optimisticMessage] }
      : item));

    try {
      let attachmentUrl = '';
      if (attachmentFile) {
        const contentType = attachmentFile.type || (/\.(mp4|m4v)$/i.test(attachmentFile.name) ? 'video/mp4' : /\.mov$/i.test(attachmentFile.name) ? 'video/quicktime' : /\.webm$/i.test(attachmentFile.name) ? 'video/webm' : 'image/jpeg');
        const video = contentType.startsWith('video/');
        if (attachmentFile.size > (video ? 75 : 15) * 1024 * 1024) throw new Error(video ? 'Videos must be under 75 MB.' : 'Attachments must be under 15 MB.');
        if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm)|application\/pdf)$/.test(contentType)) throw new Error('Choose a photo, video or PDF attachment.');
        const signed = await apiFetch<{ signedUrl: string; url: string }>('/api/media?action=post-upload-url', { method: 'POST', body: JSON.stringify({ fileName: attachmentFile.name, contentType, kind: video ? 'video' : contentType === 'application/pdf' ? 'document' : 'image' }) });
        const uploaded = await fetch(signed.signedUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: attachmentFile });
        if (!uploaded.ok) throw new Error('Attachment upload failed. Please try again.');
        attachmentUrl = signed.url;
      }
      const result = await apiFetch<{ message: SocialMessage; delivery?: { ok?: boolean; error?: string } }>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: 'reply', store_id: storeId, thread_key: thread.thread_key, body: messageText, attachment_url: attachmentUrl, attachment_name: attachmentFile?.name }),
      });
      setThreads((current) => current.map((item) => item.thread_key === thread.thread_key
        ? { ...item, last_at: result.message.created_at, last_body: result.message.body, messages: item.messages.map((message) => message.id === optimisticId ? result.message : message) }
        : item));
      if (result.delivery && result.delivery.ok === false) setError(`Saved, but sending failed: ${result.delivery.error || 'please try again.'}`);
      onActivity?.();
    } catch (reason) {
      setThreads((current) => current.map((item) => item.thread_key === thread.thread_key
        ? { ...item, messages: item.messages.filter((message) => message.id !== optimisticId) }
        : item));
      setReply((current) => current || messageText);
      setAttachment((current) => current || attachmentFile);
      setError(reason instanceof Error ? reason.message : 'Could not send that reply.');
    } finally {
      if (optimisticAttachment) URL.revokeObjectURL(optimisticAttachment);
      setSending(false);
    }
  };

  if (loading && !hasLoaded) return <section className="social-inbox" aria-label="Inbox"><div className="social-inbox-skeleton" role="status" aria-label="Loading My Customers"><strong>Loading My Customers…</strong>{Array.from({ length: 5 }, (_, index) => <div className="social-skeleton-thread" key={index} aria-hidden="true"><span className="social-skeleton-avatar" /><span className="social-skeleton-copy"><i /><i /><i /></span></div>)}</div></section>;

  return <section className="social-inbox" aria-label="Inbox">
    <div className="social-inbox-head social-inbox-head-row">
      <div className="inbox-head-copy inbox-title-row">
        <h2>My Customers</h2>
        <span className="inbox-platform-strip" aria-label="TikTok, Facebook, Instagram, Threads and WhatsApp">{PLATFORMS.map((platform) => <PlatformLogo key={platform} platform={platform} size={23} />)}<PlatformLogo platform="whatsapp" size={23} /></span>
      </div>
      <div className="social-head-actions">
        <button className="inbox-refresh-icon" onClick={() => load(true, false, true)} disabled={refreshing} aria-label="Refresh inbox" title="Refresh inbox"><RefreshCw className={refreshing ? 'spin' : ''} /></button>
      </div>
    </div>
    {error && <div className="form-error">{error}</div>}
    <div className="social-filters">
      <div className="social-filters-row">
        <label className="social-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customers…" /></label>
        <button className={`social-unread-toggle ${unreadOnly ? 'on' : ''}`} onClick={() => setUnreadOnly((value) => !value)}><CheckCheck /> Unread</button>
      </div>
    </div>

    {!threads.length && error
      ? <div className="social-empty social-inbox-load-error"><InboxIcon /><h3>Your saved inbox is not available yet</h3><p>{error}</p><button className="secondary-button" onClick={() => load(false, false, true)}><RefreshCw /> Try again</button></div>
      : !threads.length
        ? <div className="social-empty"><InboxIcon /><h3>No customers yet</h3><p>Connect accounts in Settings. New messages and comments will appear here.</p></div>
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
                {selected.platform === 'storefront' && selected.sender_handle && <div className="website-order-actions"><a className="chat-whatsapp" href={`https://wa.me/${selected.sender_handle.replace(/\D/g, '')}?text=${encodeURIComponent(reply || 'Hello! Thank you for your store order.')}`} target="_blank" rel="noreferrer">Reply via WhatsApp</a><a className="chat-call" href={`tel:${selected.sender_handle.replace(/[^\d+]/g, '')}`}>Call</a></div>}
              </div>
              {selected.kind === 'comment' && (selected.source_title || selected.source_ref) && <div className="comment-source-card">
                <span className="comment-source-thumb"><Play /></span>
                <div><small>Comment on</small><strong>{selected.source_title || 'Original post'}</strong>{selected.source_ref && selected.source_title !== selected.source_ref && <span>{selected.source_ref}</span>}</div>
                {selected.source_url && <a href={selected.source_url} target="_blank" rel="noreferrer"><ExternalLink /> View</a>}
              </div>}
              <div className="social-messages" ref={messagesRef}>
                {selected.messages.map((message, index) => <Fragment key={message.id}>{(index === 0 || dateLabel(message.created_at) !== dateLabel(selected.messages[index - 1].created_at)) && <div className="chat-day-divider">{dateLabel(message.created_at)}</div>}<div className={`social-bubble ${message.direction}`}>
                  <span className="bubble-platform"><PlatformLogo platform={message.platform} size={11} />{platformLabel(message.platform)}</span>
                  <p>{readableMessage(message.body)}</p>{message.attachment_url && <a className="chat-attachment" href={message.attachment_url} target="_blank" rel="noreferrer">{message.attachment_url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i) ? <img src={message.attachment_url} alt={message.attachment_name || "Attached photo"} loading="lazy" /> : <><Paperclip size={16} /> {message.attachment_name || "View attachment"}</>}</a>}
                  <small>{fullTime(message.created_at)}{message.direction === 'out' ? ' · you' : ''}</small>
                </div></Fragment>)}
              </div>
              <form className="social-reply" onSubmit={sendReply}>
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Message" rows={1} maxLength={2000} /><button className="social-camera" type="button" onClick={() => setMediaPickerOpen(true)} aria-label="Open camera and gallery" title="Camera and gallery"><Camera size={20} /></button><button className="social-send" aria-label="Send message" disabled={sending || (!reply.trim() && !attachment)}><Send size={19} /></button>{attachment && <span className="attachment-chip">{attachment.name}<button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">×</button></span>}
              </form>
            </> : <div className="social-detail-placeholder"><MessagesSquare /><p>Select a customer to read and reply.</p></div>}
          </div>
        </div>}
    {mediaPickerOpen && <MediaCaptureSheet
      title="Camera and gallery"
      maxPhotos={1}
      maxVideos={1}
      maxItems={1}
      onClose={() => setMediaPickerOpen(false)}
      onUse={(files) => { setAttachment(files[0] || null); setMediaPickerOpen(false); }}
    />}
  </section>;
}
