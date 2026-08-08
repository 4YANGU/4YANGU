import supabase from './db-client.js';

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
  } catch (err) {
    console.error('Daily cron API error:', err);
    return res.status(500).json({ error: 'Could not generate the daily review.' });
  }
}
