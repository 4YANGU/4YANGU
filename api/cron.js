import supabase from '../lib/db-client.js';
import webpush from 'web-push';

const todayInKenya = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const selectHighlights = (products) => {
  const ranked = [...products].sort((a, b) => Number(b.orders_today) - Number(a.orders_today) || Number(b.views_today) - Number(a.views_today));
  const winner = ranked[0];
  const needs = [...products].filter((product) => product.id !== winner?.id && Number(product.views_today) >= 1).sort((a, b) => (Number(b.views_today) - Number(b.orders_today) * 3) - (Number(a.views_today) - Number(a.orders_today) * 3))[0];
  return { winner, needs };
};
const makeBody = (store, products) => {
  const { winner, needs } = selectHighlights(products);
  return `Today: ${store.visitor_today || 0} store visits and ${store.orders_today || 0} WhatsApp order clicks.\n\nToday's champion product: ${winner ? `${winner.name} (${winner.orders_today || 0} orders, ${winner.views_today || 0} views)` : 'No product activity yet.'}\n\nNeeds a look: ${needs ? `${needs.name}, ${needs.views_today || 0} views and ${needs.orders_today || 0} orders. Try checking the photo or price.` : 'Keep sharing your products to build more activity.'}\n\nReminder: Mention your store link in your videos so customers always know where to shop.`;
};
const marker = (item) => `=== STORE ${item.store_id}: ${item.store_name} ===`;

async function runDaily(req, res) {
  const batchKey = todayInKenya();
  const { data: existing } = await supabase.from('notifications').select('id').eq('batch_key', batchKey).limit(1);
  if (existing?.length) return res.status(200).json({ ok: true, batchKey, alreadyGenerated: true });
  const [{ data: stores, error: storeError }, { data: products, error: productError }] = await Promise.all([
    supabase.from('stores').select('*').eq('is_active', true).order('name', { ascending: true }),
    supabase.from('products').select('*').eq('active', true),
  ]);
  if (storeError || productError) throw storeError || productError;
  const dateLabel = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  const rows = (stores || []).map((store) => ({
    store_id: store.id,
    batch_key: batchKey,
    store_name: store.name,
    title: `StoYangu daily update, ${dateLabel}`,
    body: makeBody(store, (products || []).filter((product) => product.store_id === store.id)),
    edited_body: '',
    status: 'draft',
  }));
  if (rows.length) {
    const { data: created, error } = await supabase.from('notifications').insert(rows).select();
    if (error) throw error;
    const highlightRows = (created || []).map((notification) => { const selected = selectHighlights((products || []).filter((product) => product.store_id === notification.store_id)); return { notification_id: notification.id, store_id: notification.store_id, batch_key: batchKey, winner_product_id: selected.winner?.id || null, needs_product_id: selected.needs?.id || null }; });
    if (highlightRows.length) { const { error: highlightError } = await supabase.from('notification_highlights').insert(highlightRows); if (highlightError) throw highlightError; }
  }
  const combinedText = rows.map((item) => `=== STORE ${item.store_id}: ${item.store_name} ===\n${item.body}`).join('\n\n');
  const { error: batchError } = await supabase.from('daily_batches').insert({ batch_key: batchKey, status: 'draft', combined_text: combinedText });
  if (batchError) throw batchError;
  return res.status(201).json({ ok: true, batchKey, generated: rows.length });
}

async function runSend(req, res) {
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
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const expected = process.env.CRON_SECRET;
    const provided = req.headers.authorization?.replace('Bearer ', '');
    if (!expected) return res.status(503).json({ error: 'Daily schedule secret is not configured.' });
    if (provided !== expected) return res.status(401).json({ error: 'Unauthorized schedule request.' });

    const job = req.query?.job;
    if (job === 'daily') return await runDaily(req, res);
    if (job === 'send') return await runSend(req, res);
    return res.status(400).json({ error: 'Unknown or missing job. Use ?job=daily | send' });
  } catch (err) {
    console.error('Cron API error:', err);
    return res.status(500).json({ error: 'Could not run the scheduled job.' });
  }
}
