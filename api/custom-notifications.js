import supabase from '../lib/db-client.js';
import webpush from 'web-push';

// Sends a one-off custom notification to every installed owner device
// (or only the selected store accounts) from the founder notification centre.

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

async function founderProfile(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
  return profile ? { ...profile, user } : null;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const profile = await founderProfile(req);
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });
    if (profile.role !== 'founder') return res.status(403).json({ error: 'Founder access required.' });
    const title = String(req.body?.title || '').trim().slice(0, 80);
    const body = String(req.body?.body || '').trim().slice(0, 800);
    if (!title || !body) return res.status(400).json({ error: 'Add a notification title and message.' });
    const storeIds = Array.isArray(req.body?.store_ids) ? req.body.store_ids.map(Number).filter(Boolean) : [];
    let query = supabase.from('push_subscriptions').select('*');
    if (storeIds.length) query = query.in('store_id', storeIds);
    const { data: subscriptions, error } = await query;
    if (error) throw error;
    const batchKey = `custom-${Date.now()}`;
    const notificationRows = (storeIds.length ? storeIds : []).map((storeId) => ({ store_id: storeId, batch_key: batchKey, store_name: '', title, body, edited_body: '', status: 'sent', sent_at: new Date().toISOString() }));
    if (notificationRows.length) await supabase.from('notifications').insert(notificationRows);
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return res.status(200).json({ sent: 0, failed: 0, installedRecipients: (subscriptions || []).length, queued: true, note: 'Push keys are not configured; the message was saved but not delivered.' });
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    let sent = 0; let failed = 0;
    for (const subscription of subscriptions || []) {
      try {
        await webpush.sendNotification(subscription.subscription, JSON.stringify({ title, body, url: '/owner', tag: `custom-${batchKey}` }));
        sent += 1;
      } catch (pushError) {
        failed += 1;
        if (pushError.statusCode === 404 || pushError.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
      }
    }
    return res.status(200).json({ sent, failed, installedRecipients: (subscriptions || []).length });
  } catch (err) {
    console.error('Custom notifications API error:', err);
    return res.status(500).json({ error: 'Could not send the custom notification.' });
  }
}
