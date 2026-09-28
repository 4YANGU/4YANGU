import supabase from './db-client.js';

const repo = () => process.env.STOYANGU_GITHUB_REPO || '4YANGU/4YANGU';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sign in to view your app.' });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
    const { data: profile, error: profileError } = await supabase.from('profiles').select('role,store_id').eq('user_id', user.id).single();
    if (profileError || !profile) return res.status(403).json({ error: 'No workspace is assigned.' });
    const storeId = profile.role === 'founder' ? Number(req.query?.storeId || req.body?.store_id) : Number(profile.store_id);
    if (!Number.isSafeInteger(storeId) || storeId <= 0) return res.status(400).json({ error: 'Choose a valid store.' });
    const { data: store, error: storeError } = await supabase.from('stores').select('id,slug,name,logo_url').eq('id', storeId).single();
    if (storeError || !store) return res.status(404).json({ error: 'Store not found.' });
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('store_apks').select('status,apk_url,error,version_code,updated_at').eq('store_id', storeId).maybeSingle();
      if (error) throw error;
      return res.status(200).json(data || { status: 'not_started', apk_url: null, error: null });
    }
    if (profile.role !== 'founder') return res.status(403).json({ error: 'Only the founder can build store apps.' });
    if (!store.logo_url || !(store.logo_url.startsWith('/') || store.logo_url.startsWith('https://'))) return res.status(400).json({ error: 'Add a store logo before building the app.' });
    const githubToken = process.env.STOYANGU_GITHUB_TOKEN;
    if (!githubToken) return res.status(503).json({ error: 'Add STOYANGU_GITHUB_TOKEN to this Vercel project before building an APK.' });
    const repository = repo();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) return res.status(500).json({ error: 'Invalid STOYANGU_GITHUB_REPO setting.' });
    const { data: existing } = await supabase.from('store_apks').select('status,apk_url').eq('store_id', storeId).maybeSingle();
    if (existing?.status === 'building') return res.status(409).json({ error: 'This store app is already building.' });
    const now = new Date().toISOString();
    const { data: build, error: saveError } = await supabase.from('store_apks').upsert({ store_id: storeId, status: 'building', apk_url: existing?.apk_url || null, error: null, updated_at: now }, { onConflict: 'store_id' }).select('status,apk_url,error,updated_at').single();
    if (saveError) throw saveError;
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/build-store-apk.yml/dispatches`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${githubToken}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'StoYangu-App-Builder' },
      body: JSON.stringify({ ref: process.env.STOYANGU_GITHUB_REF || 'main', inputs: { store_id: String(store.id), slug: store.slug, logo_url: store.logo_url } }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const message = `GitHub could not start the build (${response.status}). ${String(detail?.message || 'Check the Actions token, repository, workflow and branch.').slice(0, 180)}`;
      await supabase.from('store_apks').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('store_id', storeId);
      return res.status(502).json({ error: message });
    }
    return res.status(202).json(build);
  } catch (err) {
    console.error('Store APK API error:', err);
    return res.status(500).json({ error: 'Unable to check or start this store app build. Please retry.' });
  }
}
