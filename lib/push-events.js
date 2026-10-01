import webpush from 'web-push';
import supabase from './db-client.js';

function storeIcon(store) {
  if (!store?.slug) return '/favicon-192.png';
  const slug = encodeURIComponent(store.slug);
  const version = store.updated_at ? `&v=${encodeURIComponent(store.updated_at)}` : '';
  return `/api/store-pwa/icon?slug=${slug}${version}&size=192`;
}

export async function storePushIcon(storeId) {
  try {
    const { data } = await supabase.from('stores').select('slug,updated_at').eq('id', storeId).maybeSingle();
    return storeIcon(data);
  } catch {
    return '/favicon-192.png';
  }
}

// Send a consistent, store-branded alert to every device that opted in.
// Push uses the store logo as its icon; message/order imagery is optional and
// remains a large-image preview rather than replacing the app identity.
export async function pushStoreEvent(storeId, title, body, tag, url = '/owner', extras = {}) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return { sent: 0, failed: 0, reason: 'push-not-configured' };
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const { data: subscriptions, error } = await supabase.from('push_subscriptions').select('id,subscription').eq('store_id', storeId);
    if (error) throw error;
    if (!subscriptions?.length) return { sent: 0, failed: 0, reason: 'no-subscribers' };

    const icon = await storePushIcon(storeId);
    const payload = JSON.stringify({
      title,
      body,
      tag,
      storeId: Number(storeId),
      url,
      icon,
      badge: '/favicon-32.png',
      ...(typeof extras.image === 'string' && extras.image ? { image: extras.image } : {}),
    });
    const results = await Promise.allSettled(subscriptions.map(async entry => {
      try {
        await webpush.sendNotification(entry.subscription, payload);
        return true;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('id', entry.id);
        throw err;
      }
    }));
    const sent = results.filter(item => item.status === 'fulfilled').length;
    const failed = results.length - sent;
    if (failed) console.warn('Some store push subscriptions failed:', { storeId, sent, failed });
    return { sent, failed };
  } catch (err) {
    console.error('Store push failed:', { storeId, message: err instanceof Error ? err.message : String(err), statusCode: err?.statusCode });
    return { sent: 0, failed: 0, reason: 'push-error' };
  }
}
