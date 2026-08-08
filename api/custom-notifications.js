import supabase from './db-client.js';
import webpush from 'web-push';

async function founder(req) {
  const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token); if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).eq('role', 'founder').single();
  return data ? { ...data, user } : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const profile = await founder(req); if (!profile) return res.status(403).json({ error: 'Founder access required.' });
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pwa_installations').select('*').order('last_seen_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json(data || []);
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const title = String(req.body?.title || '').trim().slice(0, 80);
    const body = String(req.body?.body || '').trim().slice(0, 800);
    const requestedIds = Array.isArray(req.body?.store_ids) ? [...new Set(req.body.store_ids.map(Number).filter(Number.isFinite))].slice(0, 500) : [];
    if (title.length < 2 || body.length < 2) return res.status(400).json({ error: 'Add a notification title and message.' });
    const configured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    if (!configured) return res.status(503).json({ error: 'Push notification keys are not configured.' });
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    let storeQuery = supabase.from('stores').select('id,name');
    if (requestedIds.length) storeQuery = storeQuery.in('id', requestedIds);
    const { data: stores, error: storeError } = await storeQuery;
    if (storeError) throw storeError;
    const storeIds = (stores || []).map((store) => store.id);
    if (!storeIds.length) return res.status(400).json({ error: 'Choose at least one store.' });
    const { data: subscriptions, error: subscriptionError } = await supabase.from('push_subscriptions').select('*').in('store_id', storeIds);
    if (subscriptionError) throw subscriptionError;
    let sent = 0; let failed = 0;
    for (const item of subscriptions || []) {
      try {
        await webpush.sendNotification(item.subscription, JSON.stringify({ title, body, url: '/owner', tag: `custom-${Date.now()}` })); sent++;
      } catch (pushError) {
        failed++;
        if (pushError.statusCode === 404 || pushError.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('id', item.id);
      }
    }
    const batchKey = `custom-${new Date().toISOString()}`;
    const rows = (stores || []).map((store) => ({ store_id: store.id, batch_key: batchKey, store_name: store.name, title, body, edited_body: '', status: (subscriptions || []).some((item) => item.store_id === store.id) ? 'sent' : 'no_subscription', sent_at: new Date().toISOString() }));
    if (rows.length) await supabase.from('notifications').insert(rows);
    return res.status(200).json({ sent, failed, recipients: storeIds.length, installedRecipients: new Set((subscriptions || []).map((item) => item.store_id)).size });
  } catch (err) {
    console.error('Custom notifications API error:', err);
    return res.status(500).json({ error: 'Could not send that notification.' });
  }
}
