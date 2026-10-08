import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, CheckCheck, Inbox as InboxIcon, Loader2, MessagesSquare, RefreshCw, Send } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { clearHistoryFlag, pushBackHandler, pushHistoryFlag } from '../lib/backNavigation';
import supabase from '../lib/supabase';
import type { WhatsAppMessage } from '../types';

/**
 * The shop's WhatsApp chats.
 *
 * Reads wa_messages straight from Supabase with the allowed columns only
 * (never select('*'), never content_json), filtered by the store being shown,
 * and polls every 3 seconds. There is no Realtime on this screen.
 *
 * Replying is the only thing this screen cannot do by itself: it posts one
 * message to /api/media?action=whatsapp-inbox, which queues a single row in
 * wa_outbox. Group chats (@g.us) are switched off in the worker and are
 * ignored here, and messages whose kind is 'unsupported' are hidden.
 */

type Props = {
  storeId: number;
  /** Kept for the customers page: this section only loads while it is on screen. */
  visible?: boolean;
  refreshSignal?: number;
};

type Conversation = {
  chatJid: string;
  name: string;
  preview: string;
  outgoing: boolean;
  hasIncoming: boolean;
  at: number;
};

type PendingReply = { id: number | null; chatJid: string; text: string; sentAt: number };

// The only wa_messages columns this app may read. Do not add content_json.
const WA_COLUMNS = 'id,store_id,direction,wamid,chat_jid,counterpart_phone,contact_name,kind,body,status,error,delivered_at,read_at,wa_timestamp,created_at';
const POLL_MS = 3000;
const LIST_SCAN_LIMIT = 400;
const CONVERSATION_LIMIT = 50;
const THREAD_LIMIT = 100;
const MAX_REPLY_LENGTH = 1000;
const SENDING_TIMEOUT_MS = 90_000;
const MATCH_WINDOW_MS = 300_000;
const NAIROBI = 'Africa/Nairobi';

const clockNairobi = new Intl.DateTimeFormat('en-KE', { timeZone: NAIROBI, hour: '2-digit', minute: '2-digit', hour12: false });
const dayNairobi = new Intl.DateTimeFormat('en-KE', { timeZone: NAIROBI, day: 'numeric', month: 'short', year: 'numeric' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: NAIROBI, year: 'numeric', month: '2-digit', day: '2-digit' });

// Phones get the full-screen chat, drawn straight into <body> (the swipe
// pager's transform would otherwise trap a fixed panel and stretch it).
const mobileChatQuery = '(max-width: 720px)';
const subscribeMobileChat = (onChange: () => void) => {
  const query = window.matchMedia(mobileChatQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const getMobileChatSnapshot = () => window.matchMedia(mobileChatQuery).matches;

const textOf = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

/** When the message happened: the WhatsApp time when we have it, else when we stored it. */
function momentOf(message: WhatsAppMessage) {
  const stamp = message.wa_timestamp;
  if (typeof stamp === 'number' && Number.isFinite(stamp)) return stamp > 1e11 ? stamp : stamp * 1000;
  if (typeof stamp === 'string' && stamp.trim()) {
    const trimmed = stamp.trim();
    if (/^\d+$/.test(trimmed)) { const value = Number(trimmed); return value > 1e11 ? value : value * 1000; }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const created = Date.parse(message.created_at || '');
  return Number.isNaN(created) ? 0 : created;
}

const momentIso = (message: WhatsAppMessage) => new Date(momentOf(message)).toISOString();

function dayLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (dayKey.format(date) === dayKey.format(new Date())) return 'Today';
  if (dayKey.format(date) === dayKey.format(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return dayNairobi.format(date);
}

const timeLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : clockNairobi.format(date);
};

/** Times are always shown in Nairobi time. */
const listTimeLabel = (at: number) => {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  if (dayKey.format(date) === dayKey.format(new Date())) return clockNairobi.format(date);
  if (dayKey.format(date) === dayKey.format(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return dayNairobi.format(date);
};

// Every kind except plain text shows a short label instead of its content.
const KIND_LABELS: Record<string, string> = {
  image: '[photo]', photo: '[photo]', picture: '[photo]',
  sticker: '[sticker]',
  audio: '[voice note]', voice: '[voice note]', ptt: '[voice note]', voice_note: '[voice note]',
  video: '[video]',
  document: '[document]', doc: '[document]',
  location: '[location]', contact: '[contact]', contacts: '[contact]',
  reaction: '[reaction]', poll: '[poll]', call: '[call]',
};

const isHidden = (message: WhatsAppMessage) => String(message.kind || '').toLowerCase() === 'unsupported';
const isGroupJid = (chatJid: string) => chatJid.endsWith('@g.us');

function messageText(message: WhatsAppMessage) {
  const kind = String(message.kind || '').toLowerCase();
  if (!kind || kind === 'text') return textOf(message.body).trim();
  return KIND_LABELS[kind] || '[message]';
}

function prettyPhone(value: string) {
  const digits = textOf(value).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('254')) return `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  if (digits.length === 10 && digits.startsWith('0')) return `+254 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return digits ? `+${digits}` : '';
}

/** A readable fallback straight from the chat id. */
function nameFromJid(chatJid: string) {
  const [user, host = ''] = textOf(chatJid).split('@');
  if (host.includes('whatsapp.net') || host.includes('c.us')) return prettyPhone(user) || user;
  return user || 'WhatsApp contact';
}

/** The contact's saved name, or their phone number when there is no name. */
function nameOf(message: WhatsAppMessage) {
  const name = textOf(message.contact_name).trim();
  if (name) return name;
  const phone = textOf(message.counterpart_phone).trim();
  if (phone) return prettyPhone(phone) || phone;
  return nameFromJid(message.chat_jid);
}

function buildConversations(messages: WhatsAppMessage[]): Conversation[] {
  const byJid = new Map<string, Conversation>();
  for (const message of messages) {
    const chatJid = textOf(message.chat_jid);
    if (!chatJid || isGroupJid(chatJid) || isHidden(message)) continue;
    const at = momentOf(message);
    const preview = messageText(message) || '[message]';
    const existing = byJid.get(chatJid);
    if (!existing) {
      byJid.set(chatJid, {
        chatJid,
        name: nameOf(message),
        preview,
        outgoing: message.direction === 'out',
        hasIncoming: message.direction === 'in',
        at,
      });
      continue;
    }
    if (message.direction === 'in') existing.hasIncoming = true;
    if (at >= existing.at) {
      existing.at = at;
      existing.preview = preview;
      existing.outgoing = message.direction === 'out';
    }
  }
  return [...byJid.values()].sort((a, b) => b.at - a.at).slice(0, CONVERSATION_LIMIT);
}

function Ticks({ message }: { message: WhatsAppMessage }) {
  const status = String(message.status || '').toLowerCase();
  if (/fail|error/.test(status)) return <span className="wap-tick wap-tick-failed">Not sent</span>;
  if (message.read_at || status === 'read') return <CheckCheck className="wap-tick wap-tick-read" aria-label="Read" />;
  if (message.delivered_at || status === 'delivered') return <CheckCheck className="wap-tick" aria-label="Delivered" />;
  return <Check className="wap-tick" aria-label="Sent" />;
}

export default function WhatsAppInbox({ storeId, visible = true, refreshSignal = 0 }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [pending, setPending] = useState<PendingReply | null>(null);
  const [sendError, setSendError] = useState('');
  const hasLoadedRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastRefreshSignal = useRef(refreshSignal);
  const isMobile = useSyncExternalStore(subscribeMobileChat, getMobileChatSnapshot, () => false);

  const load = useCallback(async (showSpinner = false) => {
    if (!storeId) return;
    if (showSpinner) setLoading(true); else setRefreshing(true);
    try {
      // Allowed columns only, always filtered by the store being viewed.
      const listResult = await supabase
        .from('wa_messages')
        .select(WA_COLUMNS)
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(LIST_SCAN_LIMIT);
      if (listResult.error) throw listResult.error;
      setConversations(buildConversations((listResult.data || []) as WhatsAppMessage[]));

      if (selectedJid) {
        const threadResult = await supabase
          .from('wa_messages')
          .select(WA_COLUMNS)
          .eq('store_id', storeId)
          .eq('chat_jid', selectedJid)
          .order('created_at', { ascending: false })
          .limit(THREAD_LIMIT);
        if (threadResult.error) throw threadResult.error;
        const rows = ((threadResult.data || []) as WhatsAppMessage[]).filter((row) => !isHidden(row));
        setMessages(rows.reverse());
      }
      setError('');
    } catch (reason) {
      console.warn('WhatsApp inbox could not be refreshed:', reason);
      setError('Could not load WhatsApp messages. Please try again.');
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
      setThreadLoading(false);
    }
  }, [selectedJid, storeId]);

  // Poll every 3 seconds while this section is on screen. No Realtime.
  useEffect(() => {
    if (!visible) return;
    const tick = () => { void load(!hasLoadedRef.current); };
    tick();
    const interval = window.setInterval(() => { if (!document.hidden) tick(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [visible, load]);

  useEffect(() => {
    if (refreshSignal === lastRefreshSignal.current) return;
    lastRefreshSignal.current = refreshSignal;
    if (visible) void load(false);
  }, [refreshSignal, visible, load]);

  // "Sending…" ends when the matching outgoing message arrives from the worker.
  useEffect(() => {
    if (!pending || pending.chatJid !== selectedJid) return;
    const arrived = messages.some((message) => message.direction === 'out'
      && textOf(message.body).trim() === pending.text
      && momentOf(message) >= pending.sentAt - MATCH_WINDOW_MS);
    if (arrived) setPending(null);
  }, [messages, pending, selectedJid]);

  // A queued reply the worker marks as failed becomes a plain sentence.
  useEffect(() => {
    if (!pending?.id) return;
    let cancelled = false;
    const check = async () => {
      try {
        const result = await apiFetch<{ id: number; status: string }>(`/api/media?action=whatsapp-inbox&op=reply-status&id=${pending.id}`);
        if (cancelled || result.status !== 'failed') return;
        setPending(null);
        setReply((current) => current || pending.text);
        setSendError('That message was not sent. Check that the shop phone is online and connected, then try again.');
      } catch { /* a dropped check simply retries on the next poll */ }
    };
    void check();
    const interval = window.setInterval(() => { if (!document.hidden) void check(); }, POLL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [pending]);

  // If the worker never confirms, say so plainly instead of spinning forever.
  useEffect(() => {
    if (!pending) return;
    const { sentAt, text } = pending;
    const timer = window.setTimeout(() => {
      setPending((current) => (current && current.sentAt === sentAt ? null : current));
      setReply((current) => current || text);
      setSendError((current) => current || 'That message is still not confirmed. Check that the shop phone is online, then send it again.');
    }, SENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const selected = useMemo(() => conversations.find((item) => item.chatJid === selectedJid) || null, [conversations, selectedJid]);
  const chatOpen = Boolean(selectedJid);
  const showMobileChat = isMobile && chatOpen && visible;
  const pendingForChat = pending && pending.chatJid === selectedJid ? pending : null;

  const closeThread = useCallback(() => {
    setSelectedJid(null);
    setMessages([]);
    setReply('');
    setSendError('');
    clearHistoryFlag('stoyanguWaChat');
  }, []);

  useEffect(() => {
    if (visible) return;
    clearHistoryFlag('stoyanguWaChat');
  }, [visible]);

  // Phone hardware back button closes the open chat first.
  useEffect(() => {
    if (!showMobileChat) return;
    return pushBackHandler(() => { closeThread(); return true; });
  }, [showMobileChat, closeThread]);

  // Follow the keyboard's visual viewport so the reply box stays visible.
  useEffect(() => {
    if (!showMobileChat) return;
    const viewport = window.visualViewport;
    const update = () => {
      document.documentElement.style.setProperty('--wa-chat-height', `${viewport?.height || window.innerHeight}px`);
      document.documentElement.style.setProperty('--wa-chat-top', `${viewport?.offsetTop || 0}px`);
      window.requestAnimationFrame(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }));
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      document.body.style.overflow = previousOverflow;
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--wa-chat-height');
      document.documentElement.style.removeProperty('--wa-chat-top');
    };
  }, [showMobileChat]);

  useEffect(() => {
    window.requestAnimationFrame(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }));
  }, [messages.length, selectedJid, pendingForChat, showMobileChat]);

  const openThread = (chatJid: string) => {
    setSelectedJid(chatJid);
    setMessages([]);
    setThreadLoading(true);
    setReply('');
    setSendError('');
    if (isMobile) pushHistoryFlag('stoyanguWaChat', chatJid);
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const chatJid = selectedJid;
    const text = reply.trim();
    if (!chatJid || !text || pending) return;
    if (text.length > MAX_REPLY_LENGTH) {
      setSendError(`Messages can be up to ${MAX_REPLY_LENGTH} characters. Please shorten your reply.`);
      return;
    }
    setSendError('');
    setReply('');
    try {
      // One store, one chat, one text message. The server decides the store id.
      const queued = await apiFetch<{ id: number | null; status?: string }>('/api/media?action=whatsapp-inbox&op=reply', {
        method: 'POST',
        body: JSON.stringify({ op: 'reply', storeId, chat_jid: chatJid, text }),
      });
      setPending({ id: queued?.id ?? null, chatJid, text, sentAt: Date.now() });
    } catch (reason) {
      setReply((current) => current || text);
      setSendError(reason instanceof Error ? reason.message : 'That reply could not be sent right now. Please try again.');
    }
  };

  const chatDetail = (
    <div className="wap-thread-detail">
      {selectedJid ? <>
        <header className="wap-thread-head">
          <button type="button" className="wap-back" onClick={closeThread} aria-label="Back to chats"><ArrowLeft /></button>
          <span className="wap-avatar" aria-hidden="true">{(selected?.name || nameFromJid(selectedJid)).trim().charAt(0).toUpperCase()}</span>
          <div className="wap-thread-who">
            <strong>{selected?.name || nameFromJid(selectedJid)}</strong>
            <small>WhatsApp</small>
          </div>
        </header>
        <div className="wap-messages" ref={messagesRef}>
          {threadLoading && !messages.length && <div className="wap-thread-loading" role="status"><Loader2 className="spin" /> Loading messages…</div>}
          {messages.map((message, index) => <Fragment key={message.id}>
            {(index === 0 || dayLabel(momentIso(message)) !== dayLabel(momentIso(messages[index - 1]))) && <div className="wap-day">{dayLabel(momentIso(message))}</div>}
            <div className={`wap-bubble ${message.direction === 'out' ? 'out' : 'in'}`}>
              <p>{messageText(message)}</p>
              <span className="wap-meta">
                {timeLabel(momentIso(message))}
                {message.direction === 'out' && <Ticks message={message} />}
              </span>
            </div>
          </Fragment>)}
          {pendingForChat && <div className="wap-bubble out">
            <p>{pendingForChat.text}</p>
            <span className="wap-meta">Sending…</span>
          </div>}
          {!messages.length && !pendingForChat && !threadLoading && <div className="wap-thread-empty"><p>No messages in this chat yet.</p></div>}
        </div>
        {selected?.hasIncoming === false
          ? <p className="wap-reply-blocked">You can only reply to someone who messaged this shop first.</p>
          : <form className="wap-reply" onSubmit={send}>
            <textarea
              rows={1}
              value={reply}
              maxLength={MAX_REPLY_LENGTH}
              placeholder="Message"
              aria-label="Write a reply"
              onChange={(event) => setReply(event.target.value)}
            />
            <button type="submit" className="wap-send" aria-label="Send message" disabled={!reply.trim() || Boolean(pending)}><Send size={18} /></button>
          </form>}
        {reply.length > 900 && <p className="wap-counter">{reply.length}/{MAX_REPLY_LENGTH}</p>}
        {sendError && <div className="wap-send-error" role="alert">{sendError}</div>}
      </> : <div className="wap-thread-placeholder"><MessagesSquare /><p>Choose a chat to read and reply.</p></div>}
    </div>
  );

  return <section className="wap-inbox" aria-label="WhatsApp inbox">
    <div className="wap-inbox-head">
      <div>
        <h2>WhatsApp</h2>
        <p>Chats from your shop&apos;s WhatsApp number. Tap a chat to read and reply.</p>
      </div>
      <button type="button" className="wap-refresh" onClick={() => void load(false)} disabled={refreshing} aria-label="Refresh WhatsApp chats" title="Refresh WhatsApp chats"><RefreshCw className={refreshing ? 'spin' : ''} /></button>
    </div>
    {error && <div className="form-error">{error}</div>}

    {!conversations.length && loading
      ? <div className="wap-skeleton" role="status" aria-label="Loading WhatsApp chats"><strong>Loading WhatsApp chats…</strong>{Array.from({ length: 4 }, (_, index) => <span key={index} aria-hidden="true" />)}</div>
      : !conversations.length
        ? <div className="wap-empty">
          <InboxIcon />
          {error
            ? <><h3>WhatsApp messages are not available right now</h3><button type="button" className="wap-retry" onClick={() => void load(true)}><RefreshCw /> Try again</button></>
            : <p>No WhatsApp messages yet. Messages that arrive after your number was linked will appear here.</p>}
        </div>
        : <div className={`wap-body ${chatOpen ? 'show-detail' : ''}`}>
          <div className="wap-thread-list" role="list">
            {conversations.map((conversation) => <button
              key={conversation.chatJid}
              type="button"
              role="listitem"
              className={`wap-convo ${selectedJid === conversation.chatJid ? 'active' : ''}`}
              onClick={() => openThread(conversation.chatJid)}
            >
              <span className="wap-avatar" aria-hidden="true">{conversation.name.trim().charAt(0).toUpperCase()}</span>
              <span className="wap-convo-body">
                <span className="wap-convo-top"><strong>{conversation.name}</strong><small>{listTimeLabel(conversation.at)}</small></span>
                <span className="wap-convo-preview">{conversation.outgoing ? 'You: ' : ''}{conversation.preview}</span>
              </span>
            </button>)}
          </div>
          {showMobileChat
            ? createPortal(<div className="wap-chat-overlay">{chatDetail}</div>, document.body)
            : chatDetail}
        </div>}
  </section>;
}