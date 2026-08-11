import supabase from '../lib/db-client.js';
import { createHash } from 'node:crypto';

async function withinRateLimit(req) {
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

async function founder(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).eq('role', 'founder').single();
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'POST') {
      if (!(await withinRateLimit(req))) return res.status(429).json({ error: 'Too many applications from this connection. Please try again later.' });
      if (req.body?.website) return res.status(201).json({ ok: true });
      const name = String(req.body?.name || '').trim().slice(0, 100);
      const phone = String(req.body?.phone || '').trim().slice(0, 24);
      const tiktok = String(req.body?.tiktok || '').trim().replace(/^@/, '').slice(0, 30);
      if (name.length < 2 || !/^\+?[0-9\s-]{9,16}$/.test(phone)) return res.status(400).json({ error: 'Please add a valid name and phone number.' });
      if (tiktok && !/^[A-Za-z0-9._-]{2,30}$/.test(tiktok)) return res.status(400).json({ error: 'Please add a valid TikTok username.' });
      const applicationName = tiktok ? `${name} · TikTok: @${tiktok}` : name;
      const { data, error } = await supabase.from('applications').insert({ name: applicationName.slice(0, 150), phone, status: 'new' }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    const profile = await founder(req);
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
