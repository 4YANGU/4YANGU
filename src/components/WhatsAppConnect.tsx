import { CheckCircle2, Clock, Copy, Link as LinkIcon, Loader2, RefreshCw, Smartphone, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import supabase from '../lib/supabase';
import type { WhatsAppSession } from '../types';

type Props = {
  storeId: number;
  storeName: string;
};

type UiStatus = 'idle' | 'waiting' | 'connected' | 'offline' | 'relink' | 'error';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function normalizeDisplay(digits: string) {
  const s = String(digits || '').replace(/[^\d]/g, '');
  if (s.length !== 12 || !s.startsWith('254')) return s;
  const rest = s.slice(3);
  return `+254 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
}

function formatCountdown(ms: number) {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Map wa_sessions.status + failure reasons to simple human messages.
function deriveUiState(session: WhatsAppSession | null) {
  if (!session) return { ui: 'idle', badge: 'Not connected', detail: 'Link your shop\'s WhatsApp to reply to customers from this app.' };
  const st = String(session.status || '');
  const reason = String(session.disconnect_reason || session.last_error || '').toLowerCase();

  if (st === 'connected' && session.registered) {
    return {
      ui: 'connected',
      badge: 'Connected',
      detail: session.phone_number
        ? `Linked to ${normalizeDisplay(session.phone_number)}${session.last_connected_at ? ` · active since ${new Date(session.last_connected_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}` : ''}`
        : 'WhatsApp is linked and ready to send and receive messages.',
    };
  }
  if (st === 'pending' && session.pairing_code) {
    return { ui: 'waiting', badge: 'Waiting for code', detail: 'Enter the 8-digit code on your phone using "Link with phone number instead".' };
  }
  if (st === 'pending') {
    return { ui: 'waiting', badge: 'Preparing code…', detail: 'Getting a linking code ready — this takes a few seconds.' };
  }
  if (st === 'logged_out' || /401:loggedout|logged.?out/.test(reason)) {
    return { ui: 'idle', badge: 'Not connected', detail: 'The link was removed from inside WhatsApp. You can pair again below.' };
  }
  if (st === 'relink_required' || /relink|bad.?session/.test(reason)) {
    return { ui: 'relink', badge: 'Needs relinking', detail: 'WhatsApp needs to be linked again. Use the three steps below to pair this phone again.' };
  }
  if (st === 'offline' || /offline|connection.?failure|515/.test(reason)) {
    return { ui: 'offline', badge: 'Phone offline', detail: 'Wait for the phone to come back online — messages will send once it reconnects.' };
  }
  if (st === 'error' || /error|refused|denied|401/.test(reason)) {
    const hint = reason.includes('401') && reason.includes('loggedout') === false
      ? 'WhatsApp refused the pairing code. Check the number and try again in a few minutes.'
      : 'Something went wrong while linking. Try again.';
    return { ui: 'error', badge: 'Could not link', detail: hint };
  }
  return { ui: 'idle', badge: 'Not connected', detail: 'Link your shop\'s WhatsApp to reply to customers from this app.' };
}

export default function WhatsAppConnect({ storeId, storeName }: Props) {
  const [phone, setPhone] = useState('07');
  const [session, setSession] = useState<WhatsAppSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const tickRef = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const { data, error: readErr } = await supabase
        .from('wa_sessions')
        .select('store_id,status,pairing_code,pairing_code_expires_at,last_error,disconnect_reason,registered,me_jid,last_connected_at,phone_number')
        .eq('store_id', storeId)
        .maybeSingle();
      if (readErr) throw readErr;
      setSession(data || null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load WhatsApp status.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  // Poll every 3 seconds (browser reads wa_sessions via RLS).
  useEffect(() => {
    load();
    const interval = window.setInterval(load, 3000);
    return () => window.clearInterval(interval);
  }, [load]);

  // Countdown ticker.
  useEffect(() => {
    tickRef.current = window.setInterval(() => setNow(Date.now()), 500);
    return () => { if (tickRef.current) window.clearInterval(tickRef.current); };
  }, []);

  const state = useMemo(() => deriveUiState(session), [session]);

  const codeExpiresAt = session?.pairing_code_expires_at ? new Date(session.pairing_code_expires_at).getTime() : 0;
  const remaining = session?.pairing_code && codeExpiresAt ? Math.max(0, codeExpiresAt - now) : 0;
  const codeExpired = session?.pairing_code && remaining === 0;

  const codeGroups = useMemo(() => {
    const code = String(session?.pairing_code || '').replace(/\D/g, '').slice(0, 8);
    if (code.length < 8) return '';
    return `${code.slice(0, 4)} ${code.slice(4, 8)}`;
  }, [session?.pairing_code]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiFetch('/api/media?action=whatsapp', {
        method: 'POST',
        body: JSON.stringify({ op: 'pair', phoneNumber: phone }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start pairing.');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!session?.pairing_code) return;
    try {
      await navigator.clipboard.writeText(session.pairing_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this pairing code:', session.pairing_code);
    }
  };

  return (
    <section className="settings-section wa-connect" aria-labelledby="wa-connect-title">
      <div className="settings-section-heading">
        <Smartphone size={22} color="#25D366" />
        <div>
          <h2 id="wa-connect-title">WhatsApp</h2>
          <small>Reply to customers from WhatsApp Business on this phone. Linked devices stay signed in even when you close this app.</small>
        </div>
      </div>

      {loading ? (
        <div className="wa-skeleton"><span /><span /><span /></div>
      ) : (
        <>
          <div className={`wa-status-badge wa-${state.ui}`}>
            {state.ui === 'connected' && <CheckCircle2 size={16} />}
            {state.ui === 'waiting' && <Clock size={16} />}
            {(state.ui === 'relink' || state.ui === 'error') && <XCircle size={16} />}
            {(state.ui === 'offline') && <Loader2 size={16} className="spin" />}
            {state.ui === 'idle' && <LinkIcon size={16} />}
            <strong>{state.badge}</strong>
          </div>
          <p className="wa-detail">{state.detail}</p>
          {error && <div className="form-error">{error}</div>}

          {/* Pairing code panel */}
          {(state.ui === 'waiting') && session?.pairing_code && (
            <div className={`wa-code-panel ${codeExpired ? 'expired' : ''}`}>
              <div className="wa-code-row">
                <span className="wa-code">{codeGroups || session.pairing_code}</span>
                <button className="secondary-button small" onClick={copyCode} type="button" aria-label="Copy pairing code">
                  {copied ? <><CheckCircle2 size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                </button>
              </div>
              <div className="wa-timer">
                <Clock size={14} />
                <span>{codeExpired ? 'Code expired — press "Get new code" to try again.' : `Expires in ${formatCountdown(remaining)}`}</span>
                {codeExpired && (
                  <button className="wa-resend" type="button" onClick={submit} disabled={busy}>
                    <RefreshCw size={13} /> {busy ? 'Getting code…' : 'Get new code'}
                  </button>
                )}
              </div>

              <ol className="wa-steps">
                <li>
                  <span className="wa-step-num">1</span>
                  <span>Open <strong>WhatsApp</strong> on the phone you want linked.</span>
                </li>
                <li>
                  <span className="wa-step-num">2</span>
                  <span>Go to <strong>Settings → Linked devices</strong> and tap <strong>Link a device</strong>.</span>
                </li>
                <li>
                  <span className="wa-step-num">3</span>
                  <span>Tap <strong>Link with phone number instead</strong> and type the 8-digit code above.</span>
                </li>
              </ol>
              <p className="wa-plain">The code works for 5 minutes. If the phone says "Couldn't link device", check the number and get a new code.</p>
            </div>
          )}

          {/* Start-pairing form */}
          {(state.ui === 'idle' || state.ui === 'error' || state.ui === 'relink' || (state.ui === 'waiting' && !session?.pairing_code)) && (
            <form className="wa-pair-form" onSubmit={submit}>
              <label className="wa-phone">
                <span>WhatsApp number on this shop's phone</span>
                <div className="wa-phone-input">
                  <b>+254</b>
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, '').slice(0, 10))}
                    placeholder="0712 345 678"
                    autoComplete="off"
                  />
                </div>
                <small>Use the number that's installed in WhatsApp on the phone you'll hold next to you right now. We'll add the +254 country code automatically.</small>
              </label>
              <button className="button-primary compact wa-pair-button" type="submit" disabled={busy || !/^0[17]\d{8}$/.test(phone)}>
                {busy ? <><Loader2 size={16} className="spin" /> Getting code…</> : <><LinkIcon size={16} /> Get linking code</>}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
