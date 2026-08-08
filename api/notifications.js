import supabase from '../lib/db-client.js';

async function founder(req) {
  const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token); if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).eq('role', 'founder').single(); return data ? { ...data, user } : null;
}
const selectHighlights = (products) => {
  const ranked = [...products].sort((a, b) => Number(b.orders_today) - Number(a.orders_today) || Number(b.views_today) - Number(a.views_today));
  const winner = ranked[0]; const needs = [...products].filter((product) => product.id !== winner?.id && Number(product.views_today) >= 1).sort((a, b) => (Number(b.views_today) - Number(b.orders_today) * 3) - (Number(a.views_today) - Number(a.orders_today) * 3))[0];
  return { winner, needs };
};
const makeBody = (store, products) => {
  const { winner, needs } = selectHighlights(products);
  return `Today: ${store.visitor_today || 0} store visits and ${store.orders_today || 0} WhatsApp order clicks.\n\nToday's champion product: ${winner ? `${winner.name} (${winner.orders_today || 0} orders, ${winner.views_today || 0} views)` : 'No product activity yet.'}\n\nNeeds a look: ${needs ? `${needs.name}, ${needs.views_today || 0} views and ${needs.orders_today || 0} orders. Try checking the photo or price.` : 'Keep sharing your products to build more activity.'}\n\nReminder: Mention your store link in your videos so customers always know where to shop.`;
};
const marker = (store) => `=== STORE ${store.id}: ${store.name} ===`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const profile = await founder(req); if (!profile) return res.status(403).json({ error: 'Founder access required.' });
    if (req.method === 'GET') {
      const batchKey = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: existing } = await supabase.from('notifications').select('*').eq('batch_key', batchKey).order('store_id', { ascending: true });
      if (existing?.length) return res.status(200).json({ batchKey, combinedText: existing.map((item) => `${marker({ id: item.store_id, name: item.store_name })}\n${item.edited_body || item.body}`).join('\n\n') });
      const [{ data: stores }, { data: products }] = await Promise.all([supabase.from('stores').select('*').eq('is_active', true).order('name', { ascending: true }), supabase.from('products').select('*').eq('active', true)]);
      const dateLabel = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
      const rows = (stores || []).map((store) => ({ store_id: store.id, batch_key: batchKey, store_name: store.name, title: `StoYangu daily update, ${dateLabel}`, body: makeBody(store, (products || []).filter((item) => item.store_id === store.id)), edited_body: '', status: 'draft' }));
      if (rows.length) {
        const { data: created, error } = await supabase.from('notifications').insert(rows).select(); if (error) throw error;
        const highlightRows = (created || []).map((notification) => { const selected = selectHighlights((products || []).filter((product) => product.store_id === notification.store_id)); return { notification_id: notification.id, store_id: notification.store_id, batch_key: batchKey, winner_product_id: selected.winner?.id || null, needs_product_id: selected.needs?.id || null }; });
        if (highlightRows.length) { const { error: highlightError } = await supabase.from('notification_highlights').insert(highlightRows); if (highlightError) throw highlightError; }
      }
      const combinedText = rows.map((item) => `${marker({ id: item.store_id, name: item.store_name })}\n${item.body}`).join('\n\n');
      await supabase.from('daily_batches').insert({ batch_key: batchKey, status: 'draft', combined_text: combinedText });
      return res.status(200).json({ batchKey, combinedText });
    }
    if (req.method === 'POST') {
      const batchKey = String(req.body?.batchKey || '').slice(0, 20); const combined = String(req.body?.combinedText || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(batchKey) || !combined) return res.status(400).json({ error: 'A generated daily review is required.' });
      if (combined.length > 2000000) return res.status(400).json({ error: 'The combined review is too large to send safely.' });
      const { data: drafts } = await supabase.from('notifications').select('*').eq('batch_key', batchKey); if (!drafts?.length) return res.status(404).json({ error: 'Daily review not found.' });
      const now = new Date();
      const sendAt = new Date(now); sendAt.setUTCHours(16, 30, 0, 0);
      if (sendAt <= now) sendAt.setUTCDate(sendAt.getUTCDate() + 1);
      const { data: existingJob } = await supabase.from('scheduled_notifications').select('*').eq('batch_key', batchKey).eq('status', 'scheduled').limit(1);
      if (existingJob?.length) return res.status(200).json({ scheduled: true, scheduledFor: existingJob[0].send_at, alreadyScheduled: true });
      for (const draft of drafts) {
        const start = combined.indexOf(marker({ id: draft.store_id, name: draft.store_name })); let body = draft.body;
        if (start >= 0) { const contentStart = start + marker({ id: draft.store_id, name: draft.store_name }).length; const next = combined.indexOf('\n\n=== STORE ', contentStart); body = combined.slice(contentStart, next >= 0 ? next : undefined).trim() || draft.body; }
        await supabase.from('notifications').update({ edited_body: body, status: 'scheduled' }).eq('id', draft.id);
      }
      const { error: scheduleError } = await supabase.from('scheduled_notifications').insert({ batch_key: batchKey, send_at: sendAt.toISOString(), status: 'scheduled', combined_text: combined, created_by: profile.user.id });
      if (scheduleError) throw scheduleError;
      await supabase.from('daily_batches').update({ status: 'scheduled', combined_text: combined, confirmed_at: new Date().toISOString() }).eq('batch_key', batchKey);
      return res.status(200).json({ scheduled: true, scheduledFor: sendAt.toISOString() });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Notifications API error:', err);
    return res.status(500).json({ error: 'Could not process daily notifications.' });
  }
}
