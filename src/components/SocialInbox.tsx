import { ArrowLeft, CheckCheck, Inbox as InboxIcon, MessageCircle, RefreshCw, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';

type SocialAccount = {
  id: number;
  platform: string;
  handle: string;
  display_name: string;
  status: string;
};

type SocialMessage = {
  id: number;
  platform: string;
  conversation_id: string;
  sender: string;
  sender_handle: string;
  body: string;
  direction: 'in' | 'out';
  kind: string;
  post_ref: string;
  read: boolean;
  created_at: string;
};

type Conversation = {
  id: string;
  platform: string;
  kind: string;
  sender: string;
  last: SocialMessage;
  unread: number;
  messages: SocialMessage[];
};

const PLATFORMS = [
  { key: 'tiktok', label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'threads', label: 'Threads' },
];

const platformLabel = (key: string) => PLATFORMS.find((item) => item.key === key)?.label || key;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return 'now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

export default function SocialInbox({ storeId }: { storeId: number }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [mockMode, setMockMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'dm' | 'comment'>('all');
  const [activeConvo, setActiveConvo] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [connecting, setConnecting] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [busyAccount, setBusyAccount] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await apiFetch<{ mockMode: boolean; messages: SocialMessage[]; accounts: SocialAccount[] }>(
        `/api/media?action=social&op=inbox&storeId=${storeId}`
      );
      setMockMode(data.mockMode);
      setMessages(data.messages || []);
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the inbox.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const conversations: Conversation[] = useMemo(() => {
    const filtered = messages.filter(
      (message) =>
        (platformFilter === 'all' || message.platform === platformFilter) &&
        (kindFilter === 'all' || message.kind === kindFilter)
    );
    const grouped = new Map<string, SocialMessage[]>();
    filtered.forEach((message) => {
      const list = grouped.get(message.conversation_id) || [];
      list.push(message);
      grouped.set(message.conversation_id, list);
    });
    return [...grouped.entries()]
      .map(([id, list]) => {
        const sorted = [...list].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
        const last = sorted[sorted.length - 1];
        const firstInbound = sorted.find((message) => message.direction === 'in');
        return {
          id,
          platform: last.platform,
          kind: last.kind,
          sender: firstInbound?.sender || last.sender || 'Customer',
          last,
          unread: sorted.filter((message) => message.direction === 'in' && !message.read).length,
          messages: sorted,
        };
      })
      .sort((a, b) => +new Date(b.last.created_at) - +new Date(a.last.created_at));
  }, [messages, platformFilter, kindFilter]);

  const active = conversations.find((conversation) => conversation.id === activeConvo) || null;
  const totalUnread = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);

  const openConvo = async (id: string) => {
    setActiveConvo(id);
    setMessages((current) =>
      current.map((message) => (message.conversation_id === id ? { ...message, read: true } : message))
    );
    try {
      await apiFetch('/api/media?action=social&op=read', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, conversation_id: id }),
      });
    } catch {
      /* already marked read locally */
    }
  };

  const sendReply = async () => {
    if (!active || !reply.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const data = await apiFetch<{ message: SocialMessage }>('/api/media?action=social&op=reply', {
        method: 'POST',
        body: JSON.stringify({
          store_id: storeId,
          conversation_id: active.id,
          platform: active.platform,
          kind: active.kind,
          body: reply.trim(),
        }),
      });
      setMessages((current) => [...current, data.message]);
      setReply('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that reply.');
    } finally {
      setSending(false);
    }
  };

  const connect = async (platform: string) => {
    if (!handleInput.trim() || busyAccount) return;
    setBusyAccount(true);
    setError('');
    try {
      const data = await apiFetch<{ account: SocialAccount }>('/api/media?action=social&op=connect', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, platform, handle: handleInput.trim() }),
      });
      setAccounts((current) => [...current.filter((item) => item.platform !== platform), data.account]);
      setConnecting('');
      setHandleInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect that account.');
    } finally {
      setBusyAccount(false);
    }
  };

  const disconnect = async (account: SocialAccount) => {
    if (!window.confirm(`Disconnect ${platformLabel(account.platform)} (${account.handle})?`)) return;
    setBusyAccount(true);
    try {
      await apiFetch('/api/media?action=social&op=disconnect', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, id: account.id }),
      });
      setAccounts((current) => current.filter((item) => item.id !== account.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect that account.');
    } finally {
      setBusyAccount(false);
    }
  };

  if (loading) {
    return <section className="social-inbox"><div className="social-loading"><RefreshCw className="spin" /><p>Opening your inbox…</p></div></section>;
  }

  return <section className="social-inbox">
    <header className="social-inbox-head">
      <div>
        <span className="eyebrow light">TikTok · Instagram · Facebook · YouTube · Threads</span>
        <h2>Inbox {totalUnread > 0 && <em>{totalUnread} new</em>}</h2>
        <p>Every DM and comment in one place. Reply once — it goes back to the right app.</p>
      </div>
      <div className="social-head-actions">
        {mockMode && <span className="mock-badge">Demo data</span>}
        <button className="secondary-button" onClick={() => { setLoading(true); load(); }}><RefreshCw /> Refresh</button>
      </div>
    </header>
    {error && <div className="dashboard-error social-error">{error}</div>}
    <div className="social-accounts">
      {PLATFORMS.map((item) => {
        const account = accounts.find((row) => row.platform === item.key);
        return <div key={item.key} className={`social-account ${account ? 'connected' : ''}`}>
          <span className={`platform-dot platform-${item.key}`} />
          <strong>{item.label}</strong>
          {account ? <><small>{account.handle}</small><button className="account-x" onClick={() => disconnect(account)} disabled={busyAccount} aria-label={`Disconnect ${item.label}`}><X /></button></> : connecting === item.key ? <span className="connect-inline"><input value={handleInput} onChange={(event) => setHandleInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') connect(item.key); }} placeholder="@yourhandle" autoFocus /><button onClick={() => connect(item.key)} disabled={busyAccount || !handleInput.trim()}>Save</button><button onClick={() => { setConnecting(''); setHandleInput(''); }} aria-label="Cancel"><X /></button></span> : <button className="connect-btn" onClick={() => { setConnecting(item.key); setHandleInput(''); }}>Connect</button>}
        </div>;
      })}
    </div>
    <div className="social-filters">
      <div className="filter-group">
        {[{ key: 'all', label: 'All apps' }, ...PLATFORMS].map((item) => <button key={item.key} className={platformFilter === item.key ? 'active' : ''} onClick={() => setPlatformFilter(item.key)}>{item.label}</button>)}
      </div>
      <div className="filter-group">
        {(['all', 'dm', 'comment'] as const).map((kind) => <button key={kind} className={kindFilter === kind ? 'active' : ''} onClick={() => setKindFilter(kind)}>{kind === 'all' ? 'Everything' : kind === 'dm' ? 'DMs' : 'Comments'}</button>)}
      </div>
    </div>
    <div className={`social-body ${active ? 'thread-open' : ''}`}>
      <div className="convo-list">
        {conversations.length ? conversations.map((conversation) => <button key={conversation.id} className={`convo-item ${conversation.id === activeConvo ? 'active' : ''}`} onClick={() => openConvo(conversation.id)}>
          <span className="convo-avatar">{(conversation.sender[0] || '?').toUpperCase()}</span>
          <span className="convo-main"><strong>{conversation.sender}</strong><small>{conversation.last.direction === 'out' ? 'You: ' : ''}{conversation.last.body}</small></span>
          <span className="convo-meta"><em className={`platform-tag platform-${conversation.platform}`}>{platformLabel(conversation.platform)}</em><small>{timeAgo(conversation.last.created_at)}</small>{conversation.unread > 0 && <b>{conversation.unread}</b>}</span>
        </button>) : <div className="convo-empty"><InboxIcon /><p>No conversations here yet. Connect an account above, then post from the + button to start getting replies.</p></div>}
      </div>
      <div className="thread">
        {active ? <>
          <div className="thread-head">
            <button className="thread-back" onClick={() => setActiveConvo('')} aria-label="Back to conversations"><ArrowLeft /></button>
            <strong>{active.sender}</strong>
            <em className={`platform-tag platform-${active.platform}`}>{platformLabel(active.platform)}</em>
            <small>{active.kind === 'comment' ? 'Comment thread' : 'Direct messages'}</small>
            {active.unread === 0 && <span className="all-read"><CheckCheck /> Caught up</span>}
          </div>
          <div className="thread-messages">
            {active.messages.map((message) => <div key={message.id} className={`bubble ${message.direction === 'out' ? 'bubble-out' : 'bubble-in'}`}><p>{message.body}</p><small>{timeAgo(message.created_at)}{message.direction === 'out' ? ' · You' : ''}</small></div>)}
          </div>
          <div className="reply-bar">
            <input value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendReply(); }} placeholder={`Reply to ${active.sender}…`} />
            <button className="button-primary" onClick={sendReply} disabled={sending || !reply.trim()}><Send /> {sending ? 'Sending…' : 'Send'}</button>
          </div>
        </> : <div className="thread-empty"><MessageCircle /><p>Select a conversation to read and reply.</p></div>}
      </div>
    </div>
  </section>;
}
