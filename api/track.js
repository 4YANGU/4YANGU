import supabase from '../lib/db-client.js';
import { createHash } from 'node:crypto';

async function withinRateLimit(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const keyHash = createHash('sha256').update(`track:${ip}`).digest('hex');
  const { data } = await supabase.from('api_rate_limits').select('*').eq('key_hash', keyHash).eq('action', 'track').order('window_started_at', { ascending: false }).limit(1);
  const row = data?.[0];
  const expired = !row || Date.now() - new Date(row.window_started_at).getTime() > 60 * 60 * 1000;
  if (expired) {
    if (row) await supabase.from('api_rate_limits').update({ request_count: 1, window_started_at: new Date().toISOString() }).eq('id', row.id);
    else await supabase.from('api_rate_limits').insert({ key_hash: keyHash, action: 'track', request_count: 1 });
    return true;
  }
  if (row.request_count >= 500) return false;
  await supabase.from('api_rate_limits').update({ request_count: row.request_count + 1 }).eq('id', row.id);
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!(await withinRateLimit(req))) return res.status(429).json({ error: 'Too many events. Please try again later.' });
    const slug = String(req.body?.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60); const type = String(req.body?.event_type || ''); const productId = Number(req.body?.product_id || 0); const sessionId = String(req.body?.session_id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 80);
    if (!slug || !['visit', 'product_view', 'order'].includes(type) || !sessionId) return res.status(400).json({ error: 'Invalid event.' });
    let { data: store } = await supabase.from('stores').select('*').eq('slug', slug).eq('is_active', true).single();
    if (!store) { const { data: alias } = await supabase.from('store_aliases').select('store_id').eq('slug', slug).eq('active', true).single(); if (alias?.store_id) ({ data: store } = await supabase.from('stores').select('*').eq('id', alias.store_id).eq('is_active', true).single()); }
    if (!store) return res.status(404).json({ error: 'Store not found.' });
    if (productId) { const { data: product } = await supabase.from('products').select('id,store_id').eq('id', productId).eq('store_id', store.id).single(); if (!product) return res.status(400).json({ error: 'Product not found.' }); }
    const { data: duplicate } = await supabase.from('store_events').select('id').eq('store_id', store.id).eq('event_type', type).eq('session_id', sessionId).eq('product_id', productId || 0).limit(1);
    if (duplicate?.length && type !== 'order') return res.status(200).json({ ok: true, duplicate: true });
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('store_events').insert({ store_id: store.id, product_id: productId || 0, event_type: type, session_id: sessionId });
    if (type === 'visit' || type === 'order') {
      const isToday = store.metrics_date === today;
      const changes = type === 'visit' ? { visitor_total: Number(store.visitor_total || 0) + 1, visitor_today: (isToday ? Number(store.visitor_today || 0) : 0) + 1, metrics_date: today } : { orders_total: Number(store.orders_total || 0) + 1, orders_today: (isToday ? Number(store.orders_today || 0) : 0) + 1, metrics_date: today };
      await supabase.from('stores').update(changes).eq('id', store.id);
    }
    if (productId && (type === 'product_view' || type === 'order')) {
      const { data: product } = await supabase.from('products').select('*').eq('id', productId).single(); const isToday = product.metrics_date === today;
      const changes = type === 'product_view' ? { views_total: Number(product.views_total || 0) + 1, views_today: (isToday ? Number(product.views_today || 0) : 0) + 1, metrics_date: today } : { orders_total: Number(product.orders_total || 0) + 1, orders_today: (isToday ? Number(product.orders_today || 0) : 0) + 1, metrics_date: today };
      await supabase.from('products').update(changes).eq('id', productId);
    }
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Tracking API error:', err);
    return res.status(500).json({ error: 'Could not record event.' });
  }
}
