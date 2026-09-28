import webpush from 'web-push';
import supabase from './db-client.js';

// Push is delivered only to devices which granted notifications and registered a subscription.
export async function pushStoreEvent(storeId, title, body, tag, url = '/owner') {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return { sent: 0, reason: 'push-not-configured' };
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const { data, error } = await supabase.from('push_subscriptions').select('id,subscription').eq('store_id', storeId);
    if (error) throw error;
    const results = await Promise.allSettled((data || []).map(async entry => {
      try {
        await webpush.sendNotification(entry.subscription, JSON.stringify({ title, body, tag, url }));
        return true;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('id', entry.id);
        throw err;
      }
    }));
    return { sent: results.filter(item => item.status === 'fulfilled').length };
  } catch (err) {
    console.error('Store push failed:', err);
    return { sent: 0, reason: 'push-error' };
  }
}
