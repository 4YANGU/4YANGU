// =========================================================================
//  /api/engage — combined public engagement endpoint (Vfixed pack)
//  Merges the old /api/track and /api/applications functions into ONE
//  serverless function so the project stays comfortably under Vercel's
//  Hobby-plan limit of 12 functions.
//
//  Public URLs stay exactly the same — vercel.json rewrites them:
//    /api/track        -> /api/engage?fn=track
//    /api/applications -> /api/engage?fn=applications
// =========================================================================

import supabase from '../lib/db-client.js';
import { createHash } from 'node:crypto';

// ------------------------------------------------------------------ track
async function trackRateLimit(req) {
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

async function trackHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!(await trackRateLimit(req))) return res.status(429).json({ error: 'Too many events. Please try again later.' });
    const slug = String(req.body?.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60); const requestedType = String(req.body?.event_type || ''); const type = requestedType === 'order' ? 'order_click' : requestedType; const productId = Number(req.body?.product_id || 0); const sessionId = String(req.body?.session_id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 80);
    if (!slug || !['visit', 'product_view', 'order_click'].includes(type) || !sessionId) return res.status(400).json({ error: 'Invalid event.' });
    let { data: store } = await supabase.from('stores').select('*').eq('slug', slug).eq('is_active', true).single();
    if (!store) { const { data: alias } = await supabase.from('store_aliases').select('store_id').eq('slug', slug).eq('active', true).single(); if (alias?.store_id) ({ data: store } = await supabase.from('stores').select('*').eq('id', alias.store_id).eq('is_active', true).single()); }
    if (!store) return res.status(404).json({ error: 'Store not found.' });
    if (productId) { const { data: product } = await supabase.from('products').select('id,store_id').eq('id', productId).eq('store_id', store.id).single(); if (!product) return res.status(400).json({ error: 'Product not found.' }); }
    const { data: duplicate } = await supabase.from('store_events').select('id').eq('store_id', store.id).eq('event_type', type).eq('session_id', sessionId).eq('product_id', productId || 0).limit(1);
    if (duplicate?.length && type !== 'order') return res.status(200).json({ ok: true, duplicate: true });
    // Count days by Kenya time so midnight-3am Nairobi activity is never folded
    // into the wrong day by UTC dates.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    await supabase.from('store_events').insert({ store_id: store.id, product_id: productId || 0, event_type: type, session_id: sessionId });
    if (type === 'visit') {
      const isToday = store.metrics_date === today;
      const changes = { visitor_total: Number(store.visitor_total || 0) + 1, visitor_today: (isToday ? Number(store.visitor_today || 0) : 0) + 1, metrics_date: today };
      await supabase.from('stores').update(changes).eq('id', store.id);
    }
    if (productId && type === 'product_view') {
      const { data: product } = await supabase.from('products').select('*').eq('id', productId).single(); const isToday = product.metrics_date === today;
      const changes = { views_total: Number(product.views_total || 0) + 1, views_today: (isToday ? Number(product.views_today || 0) : 0) + 1, metrics_date: today };
      await supabase.from('products').update(changes).eq('id', productId);
    }
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Tracking API error:', err);
    return res.status(500).json({ error: 'Could not record event.' });
  }
}

// ----------------------------------------------------------- applications
async function applicationRateLimit(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const keyHash = createHash('sha256').update(`application:${ip}`).digest('hex');
  const { data } = await supabase.from('api_rate_limits').select('*').eq('key_hash', keyHash).eq('action', 'application').order('window_started_at', { ascending: false }).limit(1);
  const row = data?.[0];
  const expired = !row || Date.now() - new Date(row.window_started_at).getTime() > 60 * 60 * 1000;
  if (expired) {
    if (row) await supabase.from('api_rate_limits').update({ request_count: 1, window_started_at: new Date().toISOString() }).eq('id', row.id);
    else await supabase.from('api_rate_limits').insert({ key_hash: keyHash, action: 'application', request_count: 1 });
    return true;
  }
  if (row.request_count >= 8) return false;
  await supabase.from('api_rate_limits').update({ request_count: row.request_count + 1 }).eq('id', row.id);
  return true;
}

async function applicationsFounder(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).eq('role', 'founder').single();
  return data;
}

async function applicationsHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'POST') {
      if (!(await applicationRateLimit(req))) return res.status(429).json({ error: 'Too many applications from this connection. Please try again later.' });
      if (req.body?.website) return res.status(201).json({ ok: true });
      const name = String(req.body?.name || '').trim().slice(0, 100);
      const business = String(req.body?.business || '').trim().slice(0, 100);
      const phone = String(req.body?.phone || '').trim().slice(0, 24);
      const tiktok = String(req.body?.tiktok || '').trim().replace(/^@/, '').slice(0, 30);
      if (name.length < 2 || !/^\+?[0-9\s-]{9,16}$/.test(phone)) return res.status(400).json({ error: 'Please add a valid name and WhatsApp number.' });
      if (business.length < 2) return res.status(400).json({ error: 'Please add your business or store name.' });
      if (!tiktok) return res.status(400).json({ error: 'Please add your TikTok username — we need it to build your perfect store based on your business.' });
      if (!/^[A-Za-z0-9._-]{2,30}$/.test(tiktok)) return res.status(400).json({ error: 'Please add a valid TikTok username.' });
      const applicationName = `${name} · ${business} · TikTok: @${tiktok}`;
      const { data, error } = await supabase.from('applications').insert({ name: applicationName.slice(0, 150), phone, status: 'new' }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    const profile = await applicationsFounder(req);
    if (!profile) return res.status(403).json({ error: 'Founder access required.' });
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('applications').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json(data);
    }
    if (req.method === 'PUT') {
      const id = Number(req.body?.id); const status = String(req.body?.status || '');
      if (!id || !['new', 'contacted', 'approved', 'closed'].includes(status)) return res.status(400).json({ error: 'Invalid update.' });
      const { data, error } = await supabase.from('applications').update({ status }).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Applications API error:', err);
    return res.status(500).json({ error: 'Could not process that application.' });
  }
}

// -------------------------------------------------------------- dispatcher
export default async function handler(req, res) {
  const fn = String(req.query?.fn || 'track');
  if (fn === 'applications') return applicationsHandler(req, res);
  return trackHandler(req, res);
}
