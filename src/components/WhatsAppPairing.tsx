import { CheckCircle2, Copy, ExternalLink, Link as LinkIcon, Lock, RefreshCw, Smartphone, Unlink, AlertTriangle, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import PlatformLogo from './PlatformLogo';

type PairStatus = 'pending' | 'paired' | 'failed' | 'relink_required';

type Pair = {
  id: number;
  store_id: number;
  pairing_code: string;
  status: PairStatus;
  display_phone: string | null;
  verified_name: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_error: string;
  consent_given_at: string;
  connected_at: string | null;
};

type Props = {
  storeId: number;
  storeName: string;
  onChanged?: () => void;
  inline?: boolean;
};

type StatusResponse = { pair: Pair | null; mode: 'live' | 'mock'; unread?: number; threads?: number };

function timeAgo(iso?: string | null) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function WhatsAppPairing({ storeId, storeName, onChanged, inline = false }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [consentChecked, setConsentChecked] = useState(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const result = await apiFetch<StatusResponse>(`/api/media?action=whatsapp&op=status&storeId=${storeId}`);
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load WhatsApp status.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { const t = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(t); }, [load]);

  const startPairing = async () => {
    if (!consentChecked) { setError('Please accept the consent notice first.'); return; }
    setBusy(true); setError('');
    try {
      await apiFetch('/api/media?action=whatsapp', { method: 'POST', body: JSON.stringify({ op: 'pair', store_id: storeId }) });
      await load(true);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start pairing.');
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect WhatsApp from this store? You can pair it again any time.')) return;
    setBusy(true); setError('');
    try {
      await apiFetch('/api/media?action=whatsapp', { method: 'POST', body: JSON.stringify({ op: 'disconnect', store_id: storeId }) });
      await load(true);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally { setBusy(false); }
  };

  const copyCode = async () => {
    if (!status?.pair?.pairing_code) return;
    try {
      await navigator.clipboard.writeText(status.pair.pairing_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this pairing code:', status.pair.pairing_code);
    }
  };

  const pair = status?.pair;
  const deepLink = useMemo(() => {
    if (!pair?.pairing_code) return '';
    // The deep link opens the WhatsApp Business onboarding flow with the code
    // prefilled. Until the approved number binds, the link falls back to
    // opening the WhatsApp app with a pre-filled hello so the owner can at
    // least test in mock mode.
    return `https://wa.me/254700000000?text=${encodeURIComponent(`Pair StoYangu · ${storeName} · code ${pair.pairing_code}`)}`;
  }, [pair?.pairing_code, storeName]);

  const frame = inline ? 'div' : 'section';
  const Wrapper: any = frame;
  return (
    <Wrapper className={`settings-section whatsapp-pairing ${inline ? 'inline' : ''}`} aria-labelledby="whatsapp-pairing-title">
      <div className="settings-section-heading">
        <PlatformLogo platform="whatsapp" size={24} />
        <div>
          <h2 id="whatsapp-pairing-title">WhatsApp</h2>
          <small>Reply to customers directly from your Inbox. Messages send from your store's own WhatsApp number.</small>
        </div>
        {!loading && <button className="settings-refresh-accounts" onClick={() => load(true)} aria-label="Refresh WhatsApp status"><RefreshCw /></button>}
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      {loading && !status ? <div className="social-inbox-skeleton"><span className="social-skeleton-copy"><i /><i /><i /></span></div> :
        pair && (pair.status === 'paired' || pair.status === 'relink_required') ? (
          <div className="whatsapp-paired-card">
            <span className="whatsapp-status-dot" style={{ background: pair.status === 'paired' ? '#25D366' : '#f5a623' }} />
            <div className="whatsapp-paired-info">
              <strong>{pair.verified_name || 'WhatsApp connected'}</strong>
              <small>{pair.display_phone || 'Number linked'}{pair.connected_at ? ` · linked ${timeAgo(pair.connected_at)}` : ''}</small>
              {pair.last_inbound_at && <small className="whatsapp-meta">Last inbound message {timeAgo(pair.last_inbound_at)}{pair.last_outbound_at ? ` · last reply ${timeAgo(pair.last_outbound_at)}` : ''}</small>}
              {pair.status === 'relink_required' && <div className="form-error whatsapp-relink"><AlertTriangle size={16} /> Relink required: {pair.last_error || 'WhatsApp needs you to pair again.'}</div>}
            </div>
            <button className="social-unlink" onClick={disconnect} disabled={busy} aria-label="Disconnect WhatsApp" title="Disconnect"><Unlink size={16} /></button>
            {pair.status === 'relink_required' && <button className="social-link whatsapp-relink-button" onClick={startPairing} disabled={busy}>{busy ? 'Preparing…' : <>Relink <ExternalLink size={14} /></>}</button>}
          </div>
        ) : (
          <div className="whatsapp-setup">
            <div className="whatsapp-consent">
              <label className="consent-toggle">
                <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
                <Lock size={14} />
                <span><strong>Consent to message customers on WhatsApp.</strong> StoYangu will send and receive WhatsApp messages on behalf of <em>{storeName}</em> for customer replies and order updates. You can disconnect at any time, and we never message customers outside threads you choose.</span>
              </label>
            </div>

            {pair?.status === 'pending' && pair.pairing_code ? (
              <div className="whatsapp-code-panel">
                <div className="whatsapp-code-row">
                  <span className="whatsapp-code-label">Pairing code</span>
                  <span className="whatsapp-code">{pair.pairing_code}</span>
                  <button className="secondary-button small" onClick={copyCode} aria-label="Copy pairing code">{copied ? <><CheckCircle2 size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button>
                </div>
                <p className="whatsapp-code-help">Open <strong>WhatsApp Business app → Settings → Linked devices → Link a device</strong> and type this code, or tap the button below to open WhatsApp directly. The code expires after 10 minutes.</p>
                <div className="whatsapp-actions">
                  <a className="button-primary compact" href={deepLink} target="_blank" rel="noreferrer"><Smartphone /> Open WhatsApp to pair</a>
                  <button className="secondary-button" onClick={startPairing} disabled={busy}>{busy ? 'Refreshing…' : <><RefreshCw size={14} /> New code</>}</button>
                  <button className="secondary-button" onClick={disconnect}><X size={14} /> Cancel</button>
                </div>
                {status?.mode === 'mock' && <p className="whatsapp-mock-note"><AlertTriangle size={14} /> WhatsApp Cloud API credentials are not configured yet. Pairing works locally in demo mode (messages save to your inbox; you can test the UI). Add <code>WHATSAPP_ACCESS_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code> and <code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code> in Vercel to send real messages.</p>}
              </div>
            ) : (
              <div className="whatsapp-start">
                <p>Tap below to generate a 6-digit pairing code. You'll use it once in WhatsApp Business to link this store.</p>
                <button className="button-primary compact" onClick={startPairing} disabled={busy}>{busy ? 'Preparing code…' : <><LinkIcon size={16} /> Start WhatsApp pairing</>}</button>
              </div>
            )}
          </div>
        )}
    </Wrapper>
  );
}
