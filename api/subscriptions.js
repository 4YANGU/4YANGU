import supabase from '../lib/db-client.js';
import webpush from 'web-push';

async function owner(req) {
  const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token); if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).single(); return data ? { ...data, user } : null;
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const profile = await owner(req); if (!profile || !profile.store_id) return res.status(401).json({ error: 'Store owner login required.' });
    if (req.method === 'GET') { const [{ data }, { data: installation }] = await Promise.all([supabase.from('push_subscriptions').select('id').eq('user_id', profile.user.id).limit(1), supabase.from('pwa_installations').select('*').eq('user_id', profile.user.id).limit(1)]); return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || '', registered: Boolean(data?.length), installation: installation?.[0] || null }); }
    if (req.method === 'POST') {
      const subscription = req.body?.subscription;
      const endpoint = String(subscription?.endpoint || '');
      const hasSubscription = Boolean(endpoint);
      if (hasSubscription && (!endpoint.startsWith('https://') || endpoint.length > 2000)) return res.status(400).json({ error: 'Invalid push subscription.' });
      if (!hasSubscription && req.body?.installed === undefined) return res.status(400).json({ error: 'Nothing to update.' });
      // 1. Save the push subscription when one is provided (notifications allowed).
      let savedSubscription = null;
      if (hasSubscription) {
        const { data: existing } = await supabase.from('push_subscriptions').select('id').eq('endpoint', endpoint).limit(1);
        const values = { store_id: profile.store_id, user_id: profile.user.id, endpoint, subscription };
        const result = existing?.length ? await supabase.from('push_subscriptions').update(values).eq('id', existing[0].id).select().single() : await supabase.from('push_subscriptions').insert(values).select().single();
        if (result.error) throw result.error;
        savedSubscription = result.data;
      }
      // 2. Always keep the installation record up to date, even when the owner has not
      //    allowed notifications yet, so the founder dashboard reflects reality.
      const { data: installationRows } = await supabase.from('pwa_installations').select('*').eq('user_id', profile.user.id).limit(1);
      const existingInstallation = installationRows?.[0] || null;
      const installationValues = {
        user_id: profile.user.id,
        store_id: profile.store_id,
        installed: req.body?.installed === undefined ? Boolean(existingInstallation?.installed) : Boolean(req.body.installed),
        notifications_enabled: hasSubscription ? true : Boolean(existingInstallation?.notifications_enabled),
        user_agent: String(req.body?.user_agent || existingInstallation?.user_agent || '').slice(0, 500),
        last_seen_at: new Date().toISOString(),
      };
      const installationResult = existingInstallation ? await supabase.from('pwa_installations').update(installationValues).eq('id', existingInstallation.id).select().single() : await supabase.from('pwa_installations').insert(installationValues).select().single();
      if (installationResult.error) throw installationResult.error;
      // 3. Welcome push is only sent once, and only when we actually have a subscription.
      let welcomeSent = Boolean(installationResult.data.welcome_sent_at);
      if (hasSubscription && !welcomeSent && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
        try {
          await webpush.sendNotification(subscription, JSON.stringify({ title: 'Karibu StoYangu 👋', body: 'Your app and daily notifications are ready. You can now manage your products easily from your phone.', url: '/owner', tag: 'stoyangu-welcome' }));
          welcomeSent = true;
          await supabase.from('pwa_installations').update({ welcome_sent_at: new Date().toISOString() }).eq('id', installationResult.data.id);
        } catch (pushError) { console.error('Welcome push failed:', pushError.message); }
      }
      return res.status(201).json({ subscription: savedSubscription, installation: installationResult.data, welcomeSent });
    }
    if (req.method === 'DELETE') { const endpoint = String(req.body?.endpoint || ''); const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', profile.user.id).eq('endpoint', endpoint); if (error) throw error; return res.status(200).json({ ok: true }); }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Subscriptions API error:', err);
    return res.status(500).json({ error: 'Could not update notifications.' });
  }
}
