import supabase from '../lib/db-client.js';
import webpush from 'web-push';
import { storePushIcon } from '../lib/push-events.js';

async function owner(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
  return data ? { ...data, user } : null;
}

function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configurePush() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const profile = await owner(req);
    if (!profile || !profile.store_id) return res.status(401).json({ error: 'Store owner login required.' });

    if (req.method === 'GET') {
      const [{ data: subscriptions }, { data: installations }] = await Promise.all([
        supabase.from('push_subscriptions').select('id').eq('user_id', profile.user.id).limit(1),
        supabase.from('pwa_installations').select('*').eq('user_id', profile.user.id).limit(1),
      ]);
      return res.status(200).json({
        publicKey: process.env.VAPID_PUBLIC_KEY || '',
        pushConfigured: pushConfigured(),
        registered: Boolean(subscriptions?.length),
        installation: installations?.[0] || null,
      });
    }

    if (req.method === 'POST') {
      const subscription = req.body?.subscription;
      const endpoint = String(subscription?.endpoint || '');
      const hasSubscription = Boolean(endpoint);
      if (hasSubscription && (!endpoint.startsWith('https://') || endpoint.length > 2000 || !subscription?.keys?.p256dh || !subscription?.keys?.auth)) {
        return res.status(400).json({ error: 'Invalid push subscription.' });
      }
      if (!hasSubscription && req.body?.installed === undefined) return res.status(400).json({ error: 'Nothing to update.' });

      // Store a separate browser/app endpoint for every device. An owner may
      // have more than one subscribed phone, and all receive store events.
      let savedSubscription = null;
      if (hasSubscription) {
        const { data: existing, error: lookupError } = await supabase.from('push_subscriptions').select('id').eq('endpoint', endpoint).limit(1);
        if (lookupError) throw lookupError;
        const values = { store_id: profile.store_id, user_id: profile.user.id, endpoint, subscription };
        const result = existing?.length
          ? await supabase.from('push_subscriptions').update(values).eq('id', existing[0].id).select().single()
          : await supabase.from('push_subscriptions').insert(values).select().single();
        if (result.error) throw result.error;
        savedSubscription = result.data;
      }

      // Keep installation and notification permission separate. Allowing push
      // does not by itself mean the user installed the PWA.
      const { data: installationRows, error: installationLookupError } = await supabase
        .from('pwa_installations').select('*').eq('user_id', profile.user.id).limit(1);
      if (installationLookupError) throw installationLookupError;
      const existingInstallation = installationRows?.[0] || null;
      const installationValues = {
        user_id: profile.user.id,
        store_id: profile.store_id,
        // Only a confirmed install event may flip this to true. Opening the
        // Allow notifications button from a normal browser tab must not erase a
        // prior installation reported for this owner.
        installed: req.body?.installed === true || Boolean(existingInstallation?.installed),
        notifications_enabled: hasSubscription ? true : Boolean(existingInstallation?.notifications_enabled),
        user_agent: String(req.body?.user_agent || existingInstallation?.user_agent || '').slice(0, 500),
        last_seen_at: new Date().toISOString(),
      };
      const installationResult = existingInstallation
        ? await supabase.from('pwa_installations').update(installationValues).eq('id', existingInstallation.id).select().single()
        : await supabase.from('pwa_installations').insert(installationValues).select().single();
      if (installationResult.error) throw installationResult.error;

      let welcomeSent = Boolean(installationResult.data.welcome_sent_at);
      let testSent = false;
      let testError = '';
      if (hasSubscription && req.body?.test === true) {
        if (!pushConfigured()) {
          testError = 'Push keys are not configured on this deployment yet.';
        } else {
          try {
            configurePush();
            await webpush.sendNotification(subscription, JSON.stringify({
              title: 'Notifications are working',
              body: 'This phone is ready for new orders, messages, comments, and post updates.',
              url: '/owner',
              icon: await storePushIcon(profile.store_id),
              tag: `notification-test-${Date.now()}`,
            }));
            testSent = true;
          } catch (pushError) {
            testError = pushError instanceof Error ? pushError.message : 'The test notification could not be delivered.';
            console.error('Notification test push failed:', testError);
            if (pushError?.statusCode === 404 || pushError?.statusCode === 410) {
              await supabase.from('push_subscriptions').delete().eq('id', savedSubscription?.id);
            }
          }
        }
      } else if (hasSubscription && !welcomeSent && pushConfigured()) {
        try {
          configurePush();
          await webpush.sendNotification(subscription, JSON.stringify({
            title: 'Karibu StoYangu 👋',
            body: 'Notifications are on for this device. You can receive alerts for orders, messages, comments, and post updates.',
            url: '/owner',
            icon: await storePushIcon(profile.store_id),
            tag: 'stoyangu-welcome',
          }));
          welcomeSent = true;
          await supabase.from('pwa_installations').update({ welcome_sent_at: new Date().toISOString() }).eq('id', installationResult.data.id);
        } catch (pushError) {
          console.error('Welcome push failed:', pushError instanceof Error ? pushError.message : pushError);
        }
      }

      return res.status(201).json({
        subscription: savedSubscription,
        installation: installationResult.data,
        welcomeSent,
        testSent,
        testError,
        pushConfigured: pushConfigured(),
      });
    }

    if (req.method === 'DELETE') {
      const endpoint = String(req.body?.endpoint || '');
      const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', profile.user.id).eq('endpoint', endpoint);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Subscriptions API error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Could not update notifications.' });
  }
}
