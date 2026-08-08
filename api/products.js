import supabase from '../lib/db-client.js';

async function profileFor(req) {
  const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token); if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).single(); return data;
}
const cleanList = (value) => Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim().slice(0, 50)).filter(Boolean))].slice(0, 40) : [];
const cleanImages = (value, fallback = '') => {
  const source = Array.isArray(value) ? value : fallback ? [fallback] : [];
  return [...new Set(source.map((item) => String(item || '').trim().slice(0, 1000)).filter((item) => item.startsWith('/') || item.startsWith('https://')))];
};
async function withImages(products) {
  if (!products?.length) return [];
  const { data, error } = await supabase.from('product_images').select('*').in('product_id', products.map((product) => product.id)).order('sort_order', { ascending: true });
  if (error) throw error;
  return products.map((product) => {
    const images = (data || []).filter((image) => image.product_id === product.id).map((image) => image.url).slice(0, 7);
    return { ...product, images: images.length ? images : [product.image_url].filter(Boolean) };
  });
}
async function ensureStoreCategory(storeId, category) {
  const { data: store } = await supabase.from('stores').select('categories').eq('id', storeId).single();
  const categories = Array.isArray(store?.categories) ? store.categories.map(String) : [];
  if (!categories.some((item) => item.toLowerCase() === category.toLowerCase())) await supabase.from('stores').update({ categories: [...categories, category].slice(0, 50) }).eq('id', storeId);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const profile = await profileFor(req); if (!profile) return res.status(401).json({ error: 'Please login again.' });
    if (req.method === 'GET') {
      const storeId = profile.role === 'founder' ? Number(req.query?.storeId) : profile.store_id;
      const { data, error } = await supabase.from('products').select('*').eq('store_id', storeId).eq('active', true).order('created_at', { ascending: false }); if (error) throw error; return res.status(200).json(await withImages(data || []));
    }
    if (req.method === 'POST') {
      const body = req.body || {}; const storeId = Number(body.store_id); if (!storeId || profile.role !== 'founder' && profile.store_id !== storeId) return res.status(403).json({ error: 'You cannot add products to this store.' });
      const images = cleanImages(body.images, body.image_url); if (images.length > 7) return res.status(400).json({ error: 'A product can have a maximum of 7 photos.' });
      const name = String(body.name || '').trim().slice(0, 120); const price = Number(body.price); const image = images[0] || ''; const category = String(body.category || 'General').trim().slice(0, 80);
      if (name.length < 2 || category.length < 2 || !Number.isFinite(price) || price <= 0 || !image) return res.status(400).json({ error: 'Photo, product name, category and a valid price are required.' });
      const { data, error } = await supabase.from('products').insert({ store_id: storeId, name, price, category, colors: cleanList(body.colors), sizes: cleanList(body.sizes), image_url: image, views_total: 0, views_today: 0, orders_total: 0, orders_today: 0, metrics_date: new Date().toISOString().slice(0, 10), active: true }).select().single(); if (error) throw error;
      const { error: mediaError } = await supabase.from('product_images').insert(images.map((url, sort_order) => ({ product_id: data.id, store_id: storeId, url, sort_order })));
      if (mediaError) { await supabase.from('products').delete().eq('id', data.id); throw mediaError; }
      await ensureStoreCategory(storeId, category);
      await supabase.from('stores').update({ updated_at: new Date().toISOString() }).eq('id', storeId);
      return res.status(201).json({ ...data, images });
    }
    const id = Number(req.body?.id); if (!id) return res.status(400).json({ error: 'Product is required.' });
    const { data: existing } = await supabase.from('products').select('*').eq('id', id).single(); if (!existing) return res.status(404).json({ error: 'Product not found.' });
    if (profile.role !== 'founder' && profile.store_id !== existing.store_id) return res.status(403).json({ error: 'You cannot change this product.' });
    if (req.method === 'PUT') {
      const body = req.body || {}; const name = String(body.name || '').trim().slice(0, 120); const price = Number(body.price); const category = String(body.category || 'General').trim().slice(0, 80); if (name.length < 2 || category.length < 2 || !Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Product name, category and a valid price are required.' });
      const images = cleanImages(body.images, body.image_url || existing.image_url); if (!images.length || images.length > 7) return res.status(400).json({ error: 'Keep between 1 and 7 product photos.' });
      const { data, error } = await supabase.from('products').update({ name, price, category, colors: cleanList(body.colors), sizes: cleanList(body.sizes), image_url: images[0], updated_at: new Date().toISOString() }).eq('id', id).select().single(); if (error) throw error;
      await supabase.from('product_images').delete().eq('product_id', id);
      const { error: mediaError } = await supabase.from('product_images').insert(images.map((url, sort_order) => ({ product_id: id, store_id: existing.store_id, url, sort_order })));
      if (mediaError) throw mediaError;
      await ensureStoreCategory(existing.store_id, category);
      await supabase.from('stores').update({ updated_at: new Date().toISOString() }).eq('id', existing.store_id);
      return res.status(200).json({ ...data, images });
    }
    if (req.method === 'DELETE') { await supabase.from('product_images').delete().eq('product_id', id); const { error } = await supabase.from('products').delete().eq('id', id); if (error) throw error; await supabase.from('stores').update({ updated_at: new Date().toISOString() }).eq('id', existing.store_id); return res.status(200).json({ ok: true }); }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Products API error:', err);
    return res.status(500).json({ error: 'Could not process that product.' });
  }
}
