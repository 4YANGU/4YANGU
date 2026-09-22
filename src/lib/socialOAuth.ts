import { apiFetch } from './api';
export type OAuthChoice = { id: string; name: string; username: string; picture: string };
export type OAuthOutcome = { state: string; platform: string; status: 'pending' | 'processing' | 'needs_pick' | 'selecting' | 'complete' | 'failed'; choices?: OAuthChoice[]; error?: string };
export const pendingKey = (storeId: number) => `stoyangu-oauth-resume-${storeId}`;
export function getPendingState(storeId: number): string {
  const queryState = new URLSearchParams(window.location.search).get('oauth_state');
  if (queryState) return queryState;
  try { const pending = JSON.parse(localStorage.getItem(pendingKey(storeId)) || 'null'); return pending && Date.now() - pending.savedAt < 30 * 60000 ? pending.state : ''; } catch { return ''; }
}
export async function resumeConnection(storeId: number, state: string): Promise<OAuthOutcome> {
  return apiFetch(`/api/media?action=social&op=oauth_resume&storeId=${storeId}&state=${encodeURIComponent(state)}`);
}
export function clearOAuthReturn(storeId: number, finished = true) {
  try { if (finished) localStorage.removeItem(pendingKey(storeId)); } catch { /* Server state remains authoritative. */ }
  const params = new URLSearchParams(window.location.search);
  for (const key of ['oauth', 'oauth_state', 'oauth_pick', 'oauth_error', 'platform']) params.delete(key);
  window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
}
export async function startConnection(storeId: number, platform: string): Promise<OAuthOutcome> {
  // Open synchronously, before any await. Browsers otherwise block this window.
  const phone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const popup = window.open('about:blank', `stoyangu-connect-${platform}`, phone ? '' : 'width=560,height=700');
  try { if (popup) { popup.document.title = 'Connecting your account'; popup.document.body.textContent = 'Opening the secure connection page…'; } } catch { /* A reused provider window may be cross-origin. */ }
  let state = '';
  try {
    const result = await apiFetch<{ authorize_url: string; state: string }>('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'connect', store_id: storeId, platform, return_to: window.location.pathname }) });
    state = result.state;
    if (!state || !/^https:\/\//i.test(result.authorize_url)) throw new Error('The connection service returned an invalid authorization link.');
    try { localStorage.setItem(pendingKey(storeId), JSON.stringify({ state, platform, savedAt: Date.now() })); } catch { /* Pending selections can also be recovered from the server. */ }
    if (!popup) {
      if (window.top === window.self) { window.location.assign(result.authorize_url); return new Promise(() => undefined); }
      throw new Error('Allow pop-ups for this site, then tap Connect again.');
    }
    popup.location.href = result.authorize_url;
    return await new Promise<OAuthOutcome>((resolve, reject) => {
      let done = false; let polling = false; let closedAt = 0;
      const timeout = window.setTimeout(() => finish(null, 'Approval is taking longer than expected. Return to Accounts to resume, or connect again.'), 10 * 60000);
      const finish = (outcome: OAuthOutcome | null, error?: string) => {
        if (done) return; done = true;
        window.clearInterval(timer); window.clearTimeout(timeout); window.removeEventListener('message', message); window.removeEventListener('focus', poll);
        if (outcome) { try { popup.close(); } catch { /* A provider may isolate its window. */ } resolve(outcome); } else reject(new Error(error));
      };
      const poll = async () => {
        if (done || polling) return; polling = true;
        try {
          const outcome = await resumeConnection(storeId, state);
          if (['complete', 'needs_pick', 'failed'].includes(outcome.status)) { finish(outcome); return; }
          // The database, not popup.closed, is the source of truth (COOP can sever an opener).
          if (popup.closed && outcome.status === 'pending') { if (!closedAt) closedAt = Date.now(); if (Date.now() - closedAt > 60000) finish(null, 'The approval window closed. Open Accounts to resume or reconnect.'); }
        } catch { /* A short network interruption must not cancel consent. The deadline still applies. */ }
        finally { polling = false; }
      };
      const message = (event: MessageEvent) => { if (event.origin === window.location.origin && event.data?.source === 'stoyangu-oauth' && event.data.state === state) void poll(); };
      const timer = window.setInterval(poll, 1800);
      window.addEventListener('message', message); window.addEventListener('focus', poll); void poll();
    });
  } catch (e) { try { popup?.close(); } catch { /* Already closed. */ } throw e; }
}
