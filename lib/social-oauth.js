import { randomBytes } from 'node:crypto';
import { REPLIZ_PLATFORMS, REPLIZ_SINGLE_STEP, REPLIZ_TWO_STEP, replizAuthorizeUrl, replizCallbackUrl, replizConnectOAuth, replizExchangeCode, replizGetAccount, replizListOAuthChoices, replizMode } from './repliz.js';

const MAX_AGE = 30 * 60000;
function errorResponse(res, code, error) { return res.status(code).json({ error }); }
export function safeReturnPath(path, storeId) { return String(path || '').split('?')[0] === `/manage/${storeId}` ? `/manage/${storeId}?inbox=1` : '/owner?inbox=1'; }
function publicChoices(choices) { return (Array.isArray(choices) ? choices : []).map(c => ({ id: String(c.id), name: String(c.name || 'Account'), username: String(c.username || ''), picture: String(c.picture || '') })); }
function outcome(saved) { return { state: saved.token, platform: saved.platform, status: saved.status || 'pending', ...(saved.status === 'needs_pick' ? { choices: publicChoices(saved.data?.choices) } : {}), ...(saved.status === 'failed' ? { error: saved.data?.error || 'Connection failed. Please try again.' } : {}) }; }
function boundTo(saved, profile, storeId) { return saved && Number(saved.store_id) === Number(storeId) && saved.data?.user_id === profile.user_id; }
function valid(saved) { return saved && new Date(saved.expires_at).getTime() > Date.now(); }
async function readState(db, token) { const { data, error } = await db.from('social_oauth_states').select('*').eq('token', token).maybeSingle(); if (error) throw error; return data; }
async function updateState(db, saved, status, patch = {}) { const { data, error } = await db.from('social_oauth_states').update({ status, data: { ...saved.data, ...patch } }).eq('id', saved.id).select('*').single(); if (error) throw error; return data; }
async function claimState(db, saved, expected, next) { const { data, error } = await db.from('social_oauth_states').update({ status: next }).eq('id', saved.id).eq('status', expected).select('*').maybeSingle(); if (error) throw error; return data; }
export async function saveConnection(db, storeId, platform, result) {
  if (!result.accountId) throw new Error('Approval completed but no account ID was returned. Please reconnect.');
  let account = result.account;
  if (!account) { try { account = await replizGetAccount(result.accountId); } catch { account = null; } }
  if (account?.platform && account.platform !== platform) throw new Error('The returned account does not match the selected platform.');
  const { data: assignments, error: assignmentError } = await db.from('social_connections').select('id,store_id').eq('platform', platform).eq('account_id', result.accountId);
  if (assignmentError) throw assignmentError;
  if (assignments?.some(a => Number(a.store_id) !== Number(storeId))) throw new Error('This social account is already assigned to another store. Disconnect it there first.');
  const { data: existing, error: findError } = await db.from('social_connections').select('id').eq('store_id', storeId).eq('platform', platform).limit(1).maybeSingle();
  if (findError) throw findError;
  const values = { store_id: storeId, platform, account_id: result.accountId, account_handle: account?.handle || account?.display_name || 'Connected account', connection_status: 'connected', auth_payload: { display_name: account?.display_name || '', avatar_url: account?.avatar_url || '' }, updated_at: new Date().toISOString() };
  const query = existing ? db.from('social_connections').update(values).eq('id', existing.id) : db.from('social_connections').insert(values);
  const { data, error } = await query.select('*').single(); if (error) throw error; return data;
}
export async function startOAuth(req, res, db, profile, storeId) {
  const platform = String(req.body?.platform || '').toLowerCase();
  if (!REPLIZ_PLATFORMS.includes(platform)) return errorResponse(res, 400, 'Choose a supported platform.');
  if (replizMode() !== 'live') return errorResponse(res, 503, 'Social connections need REPLIZ_ACCESS_KEY and REPLIZ_SECRET_KEY. Ask your administrator to configure them. No account has been connected.');
  await db.from('social_oauth_states').delete().lt('expires_at', new Date().toISOString());
  const state = randomBytes(32).toString('hex');
  const callback = new URL(`${replizCallbackUrl(req)}/${state}`);
  const origin = callback.origin;
  const returnTo = safeReturnPath(req.body?.return_to, storeId);
  const { data: saved, error } = await db.from('social_oauth_states').insert({ store_id: storeId, token: state, platform, status: 'pending', data: { user_id: profile.user_id, origin, return_to: returnTo, redirect: callback.href, version: 12 }, expires_at: new Date(Date.now() + MAX_AGE).toISOString() }).select('*').single();
  if (error) return errorResponse(res, 503, 'Connection storage is not ready. Run the woyoyo-012 Supabase migration, then retry.');
  try {
    // Never add to or decode this URL. Repliz owns its internal OAuth state.
    const authorizeUrl = await replizAuthorizeUrl({ platform, redirect: callback.href });
    const parsed = new URL(authorizeUrl); if (parsed.protocol !== 'https:') throw new Error('The provider returned an insecure authorization URL.');
    return res.status(200).json({ oauth: true, state, authorize_url: authorizeUrl });
  } catch (e) { await updateState(db, saved, 'failed', { error: e.message }); return errorResponse(res, 502, e.message || 'Unable to start the connection.'); }
}
export async function resumeOAuth(req, res, db, profile, storeId) {
  const state = String(req.query?.state || req.body?.state || '');
  if (!/^[a-f0-9]{64}$/.test(state)) return errorResponse(res, 400, 'Invalid connection request.');
  const saved = await readState(db, state);
  if (!boundTo(saved, profile, storeId)) return errorResponse(res, 403, 'This approval belongs to another session or store.');
  if (!valid(saved)) return errorResponse(res, 410, 'This approval expired. Tap Connect again.');
  return res.status(200).json(outcome(saved));
}
export async function pendingOAuth(req, res, db, profile, storeId) {
  const { data, error } = await db.from('social_oauth_states').select('*').eq('store_id', storeId).eq('status', 'needs_pick').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(10);
  if (error) throw error;
  const saved = (data || []).find(row => row.data?.user_id === profile.user_id);
  return res.status(200).json({ pending: saved ? outcome(saved) : null });
}
export async function pickOAuth(req, res, db, profile, storeId) {
  const state = String(req.body?.state || ''); const selectionId = String(req.body?.selection_id || '');
  const saved = await readState(db, state);
  if (!boundTo(saved, profile, storeId)) return errorResponse(res, 403, 'This approval belongs to another session or store.');
  if (!valid(saved)) return errorResponse(res, 410, 'This approval expired. Tap Connect again.');
  if (saved.status === 'complete') return res.status(200).json(outcome(saved));
  if (!REPLIZ_TWO_STEP.includes(saved.platform) || saved.status !== 'needs_pick' || !saved.data?.token) return errorResponse(res, 409, 'This approval is not ready for selection.');
  const selection = (saved.data.choices || []).find(c => c.id === selectionId);
  if (!selection) return errorResponse(res, 400, 'Choose a Page or channel from this approval.');
  const claimed = await claimState(db, saved, 'needs_pick', 'selecting');
  if (!claimed) return errorResponse(res, 409, 'This selection is already being processed.');
  try {
    const result = await replizConnectOAuth({ platform: saved.platform, token: selection.token || saved.data.token, selectionId });
    const connection = await saveConnection(db, storeId, saved.platform, result);
    const finished = await updateState(db, saved, 'complete', { token: null, choices: [], connection_id: connection.id });
    return res.status(200).json({ ...outcome(finished), connection });
  } catch (e) { await updateState(db, saved, 'needs_pick', { error: e.message }); return errorResponse(res, 502, e.message || 'Unable to connect the selected account.'); }
}
function finishPage(res, saved, fallbackError = '') {
  const payload = saved ? { source: 'stoyangu-oauth', ...outcome(saved) } : { source: 'stoyangu-oauth', status: 'failed', error: fallbackError };
  const origin = saved?.data?.origin || '';
  const returnTo = saved?.data?.return_to || '/login';
  const destination = origin ? new URL(returnTo, origin) : null;
  if (destination) { destination.searchParams.set('oauth_state', saved.token); destination.searchParams.set('oauth', 'resume'); }
  const back = destination?.href || '/login';
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const message = saved?.status === 'complete' ? 'Account connected.' : saved?.status === 'needs_pick' ? 'Permission received. Choose your Page or channel back in the app.' : saved?.status === 'failed' ? saved.data?.error : fallbackError || 'Returning to your store…';
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StoYangu · Account connection</title></head><body style="margin:0;min-height:100vh;background:#f7f5ee;color:#101f30;font:16px system-ui;display:grid;place-items:center"><main style="max-width:420px;padding:32px;text-align:center"><img src="/stoyangu-logo.png" width="140" alt="StoYangu"><h1 style="font-size:24px">${escape(message || 'Return to your store')}</h1><p>Your approval is saved securely. You can return to the app.</p><a id="back" href="${escape(back)}" style="display:inline-block;padding:14px 24px;background:#5a966e;color:#fff;border-radius:12px;text-decoration:none">Return to StoYangu</a></main><script>(function(){var p=${json(payload)},o=${json(origin)},b=${json(back)};try{if(window.opener&&!window.opener.closed&&o){window.opener.postMessage(p,o);setTimeout(function(){window.close()},250);return}}catch(e){}if(o)setTimeout(function(){window.location.replace(b)},800)})();</script></body></html>`);
}
export async function callbackOAuth(req, res, db) {
  const pathToken = String(req.url || '').match(/\/api\/social-callback\/([a-f0-9]{64})/i)?.[1] || '';
  const state = String(pathToken || req.query?.s || req.query?.stoyangu_state || '');
  if (!/^[a-f0-9]{64}$/.test(state)) return finishPage(res, null, 'The provider did not return a valid connection reference. Please connect again.');
  let saved = await readState(db, state);
  if (!valid(saved)) return finishPage(res, null, 'This approval has expired. Please connect again.');
  if (['complete', 'needs_pick', 'failed', 'processing', 'selecting'].includes(saved.status)) return finishPage(res, saved);
  const code = String(req.query?.code || req.query?.auth_code || req.query?.authorization_code || '');
  const failure = req.query?.error_description || req.query?.error;
  if (failure) { saved = await updateState(db, saved, 'failed', { error: `Permission was not granted: ${String(failure).slice(0, 160)}. You can connect again.` }); return finishPage(res, saved); }
  if (!code) { saved = await updateState(db, saved, 'failed', { error: 'The provider did not return an authorization code. Please connect again.' }); return finishPage(res, saved); }
  const claimed = await claimState(db, saved, 'pending', 'processing');
  if (!claimed) return finishPage(res, await readState(db, state));
  try {
    if (REPLIZ_SINGLE_STEP.includes(saved.platform)) {
      const result = await replizConnectOAuth({ platform: saved.platform, code });
      const connection = await saveConnection(db, saved.store_id, saved.platform, result);
      saved = await updateState(db, saved, 'complete', { connection_id: connection.id });
    } else if (REPLIZ_TWO_STEP.includes(saved.platform)) {
      const token = await replizExchangeCode({ platform: saved.platform, code });
      const choices = await replizListOAuthChoices({ platform: saved.platform, token });
      if (!choices.length) throw new Error('No eligible Pages or channels were returned. Check your permissions and connect again.');
      saved = await updateState(db, saved, 'needs_pick', { token, choices });
    } else throw new Error('Unsupported platform.');
  } catch (e) { saved = await updateState(db, saved, 'failed', { token: null, choices: [], error: e.message || 'Unable to complete approval. Please try again.' }); }
  return finishPage(res, saved);
}
