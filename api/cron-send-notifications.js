import supabase from './db-client.js';
import webpush from 'web-push';

const marker = (item) => `=== STORE ${item.store_id}: ${item.store_name} ===`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const expected = process.env.CRON_SECRET;
    const provided = req.headers.authorization?.replace('Bearer ', '');
    if (!expected) return res.status(503).json({ error: 'CRON_SECRET is not configured.' });
    if (provided !== expected) return res.status(401).json({ error: 'Unauthorized schedule request.' });
    const configured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    if (!configured) return res.status(503).json({ error: 'Push notification keys are not configured.' });
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const { data: jobs, error } = await supabase.from('scheduled_notifications').select('*').eq('status', 'scheduled').lte('send_at', new Date().toISOString()).order('send_at', { ascending: true }).limit(10);
    if (error) throw error;
    let sent = 0; let failed = 0;
    for (const job of jobs || []) {
      const { data: claimed, error: claimError } = await supabase.from('scheduled_notifications').update({ status: 'processing' }).eq('id', job.id).eq('status', 'scheduled').select('id');
      if (claimError) throw claimError;
      if (!claimed?.length) continue;
      const jobSentBefore = sent; const jobFailedBefore = failed;
      const { data: drafts } = await supabase.from('notifications').select('*').eq('batch_key', job.batch_key).order('store_id', { ascending: true });
      for (const draft of drafts || []) {
        const start = job.combined_text.indexOf(marker(draft));
        let body = draft.edited_body || draft.body;
        if (start >= 0) {
          const contentStart = start + marker(draft).length;
          const next = job.combined_text.indexOf('\n\n=== STORE ', contentStart);
          body = job.combined_text.slice(contentStart, next >= 0 ? next : undefined).trim() || body;
        }
        const { data: highlightRows } = await supabase.from('notification_highlights').select('*').eq('notification_id', draft.id).limit(1);
        const highlight = highlightRows?.[0];
        const productIds = [highlight?.winner_product_id, highlight?.needs_product_id].filter(Boolean);
        const { data: highlightedProducts } = productIds.length ? await supabase.from('products').select('id,name,image_url').in('id', productIds) : { data: [] };
        const winner = (highlightedProducts || []).find((product) => product.id === highlight?.winner_product_id);
        const needs = (highlightedProducts || []).find((product) => product.id === highlight?.needs_product_id);
        const rootDomain = process.env.ROOT_DOMAIN || 'stoyangu.com';
        const winnerImage = winner?.image_url ? (winner.image_url.startsWith('http') ? winner.image_url : `https://${rootDomain}${winner.image_url}`) : undefined;
        const { data: subscriptions } = await supabase.from('push_subscriptions').select('*').eq('store_id', draft.store_id);
        let status = subscriptions?.length ? 'sent' : 'no_subscription';
        for (const subscription of subscriptions || []) {
          try {
            await webpush.sendNotification(subscription.subscription, JSON.stringify({ title: draft.title, body, image: winnerImage, winner: winner?.name, needs: needs?.name, url: '/owner', tag: `daily-${job.batch_key}` }));
            sent++;
          } catch (pushError) {
            failed++; status = 'partially_failed';
            if (pushError.statusCode === 404 || pushError.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
          }
        }
        await supabase.from('notifications').update({ edited_body: body, status, sent_at: new Date().toISOString() }).eq('id', draft.id);
      }
      const jobSent = sent - jobSentBefore; const jobFailed = failed - jobFailedBefore;
      await supabase.from('scheduled_notifications').update({ status: jobFailed ? 'completed_with_errors' : 'sent', sent_at: new Date().toISOString(), result: { sent: jobSent, failed: jobFailed } }).eq('id', job.id);
      await supabase.from('daily_batches').update({ status: jobFailed ? 'completed_with_errors' : 'sent' }).eq('batch_key', job.batch_key);
    }
    return res.status(200).json({ processed: jobs?.length || 0, sent, failed });
  } catch (err) {
    console.error('Scheduled notification API error:', err);
    return res.status(500).json({ error: 'Could not send scheduled notifications.' });
  }
}
