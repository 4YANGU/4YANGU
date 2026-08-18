// =========================================================================
//  /api/ops — combined store-ops endpoint (Hobby-plan safe pack)
//  Merges products, orders, media, subscriptions into ONE serverless
//  function so the project stays well under Vercel's Hobby limit of 12.
//
//  Public URLs stay exactly the same — vercel.json rewrites them:
//    /api/products      -> /api/ops?fn=products
//    /api/orders        -> /api/ops?fn=orders
//    /api/media         -> /api/ops?fn=media
//    /api/subscriptions -> /api/ops?fn=subscriptions
// =========================================================================

import supabase from '../lib/db-client.js';
import webpush from 'web-push';
import { fallbackOrders, missingOrdersTable, saveFallbackOrder, storeOrders, updateFallbackOrder } from '../lib/order-fallback.js';

// ------------------------------------------------------------------ products
async function profileFor(req) {
  const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token); if (!user) return null;
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const productionHost = host === 'stoyangu.com' || host === 'www.stoyangu.com' || host.endsWith('.stoyangu.com');
  if (productionHost && String(user.email || '').toLowerCase() === 'founder-demo@stoyangu.com') return null;
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

async function productsHandler(req, res) {
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

// ------------------------------------------------------------------ orders
const corsOrders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

const normalisePhone = (value) => {
  const raw = String(value || '').replace(/\D/g, '');
  let digits = raw.startsWith('0') ? `254${raw.slice(1)}` : raw;
  if (!digits.startsWith('254') && /^(7|1)\d{8}$/.test(digits)) digits = `254${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : '';
};

async function profileFromRequest(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
  return profile ? { ...profile, user } : null;
}

async function resolveStore(slug) {
  let { data: store } = await supabase.from('stores').select('*').eq('slug', slug).eq('is_active', true).single();
  if (!store) {
    const { data: alias } = await supabase.from('store_aliases').select('store_id').eq('slug', slug).eq('active', true).single();
    if (alias?.store_id) ({ data: store } = await supabase.from('stores').select('*').eq('id', alias.store_id).eq('is_active', true).single());
  }
  return store || null;
}

async function sendInstantOrderPush(storeId, order, product) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const { data: subscriptions } = await supabase.from('push_subscriptions').select('*').eq('store_id', storeId);
  const variant = [order.color, order.size].filter(Boolean).join(' · ');
  const body = `${variant || 'Confirmed order'}\nCustomer: ${order.customer_phone}`;
  const rootDomain = process.env.ROOT_DOMAIN || 'stoyangu.com';
  const image = product?.image_url ? (product.image_url.startsWith('http') ? product.image_url : `https://${rootDomain}${product.image_url}`) : undefined;
  for (const subscription of subscriptions || []) {
    try {
      await webpush.sendNotification(subscription.subscription, JSON.stringify({ title: `New order: ${order.product_name}`, body, image, icon: image, product: { id: product.id, name: product.name, image }, customer_phone: order.customer_phone, url: '/owner', tag: `order-${order.id}` }));
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
      else console.error('Instant order push failed:', error.message);
    }
  }
}

async function ordersHandler(req, res) {
  corsOrders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
      const productId = Number(body.product_id || 0);
      const customerPhone = normalisePhone(body.customer_phone);
      const orderKey = String(body.order_key || '').replace(/[^a-z0-9-]/gi, '').slice(0, 100) || `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      if (!slug || !productId || !customerPhone) return res.status(400).json({ error: 'Product and a valid customer phone number are required.' });
      const store = await resolveStore(slug);
      if (!store) return res.status(404).json({ error: 'Store not found.' });
      const { data: product } = await supabase.from('products').select('*').eq('id', productId).eq('store_id', store.id).eq('active', true).single();
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      const existingOrders = await storeOrders(supabase, store.id, 200);
      const duplicate = existingOrders.find((order) => order.order_key === orderKey);
      if (duplicate) return res.status(200).json({ order: duplicate, duplicate: true });
      const values = {
        order_key: orderKey,
        store_id: store.id,
        product_id: product.id,
        product_name: product.name,
        product_price: Number(product.price || 0),
        customer_phone: customerPhone,
        color: String(body.color || '').slice(0, 80),
        size: String(body.size || '').slice(0, 80),
        fulfilment: String(body.fulfilment || 'Delivery').slice(0, 80),
        note: String(body.note || '').slice(0, 500),
        status: 'new',
      };
      const inserted = await supabase.from('orders').insert(values).select().single();
      let order = inserted.data;
      let fallbackUsed = false;
      if (inserted.error) {
        if (!missingOrdersTable(inserted.error)) throw inserted.error;
        order = await saveFallbackOrder(supabase, values);
        fallbackUsed = true;
      }
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
      if (!fallbackUsed) { const sessionId = `order-${order.id}`; await supabase.from('store_events').insert({ store_id: store.id, product_id: product.id, event_type: 'order', session_id: sessionId }); }
      const storeIsToday = store.metrics_date === today;
      const productIsToday = product.metrics_date === today;
      await Promise.all([
        supabase.from('stores').update({ orders_total: Number(store.orders_total || 0) + 1, orders_today: (storeIsToday ? Number(store.orders_today || 0) : 0) + 1, metrics_date: today }).eq('id', store.id),
        supabase.from('products').update({ orders_total: Number(product.orders_total || 0) + 1, orders_today: (productIsToday ? Number(product.orders_today || 0) : 0) + 1, metrics_date: today }).eq('id', product.id),
      ]);
      await sendInstantOrderPush(store.id, order, product);
      return res.status(201).json({ order });
    }

    const profile = await profileFromRequest(req);
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });
    if (req.method === 'GET') {
      const requestedStoreId = Number(req.query?.storeId || 0);
      const storeId = profile.role === 'founder' ? requestedStoreId || Number(profile.store_id || 0) : Number(profile.store_id || 0);
      if (!storeId) return res.status(400).json({ error: 'Store is required.' });
      return res.status(200).json(await storeOrders(supabase, storeId, 200));
    }
    if (req.method === 'PUT') {
      const id = Number(req.body?.id || 0);
      const status = String(req.body?.status || '');
      if (!id || !['new', 'contacted', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Valid order and status are required.' });
      if (id < 0) {
        if (profile.role !== 'founder') { const owned = await fallbackOrders(supabase, Number(profile.store_id || 0), 200); if (!owned.some((order) => order.id === id)) return res.status(403).json({ error: 'You cannot change this order.' }); }
        const fallback = await updateFallbackOrder(supabase, id, status);
        if (!fallback) return res.status(404).json({ error: 'Order not found.' });
        return res.status(200).json(fallback);
      }
      const { data: existing, error: existingError } = await supabase.from('orders').select('*').eq('id', id).single();
      if (missingOrdersTable(existingError)) return res.status(404).json({ error: 'Order not found.' });
      if (existingError && existingError.code !== 'PGRST116') throw existingError;
      if (!existing) return res.status(404).json({ error: 'Order not found.' });
      if (profile.role !== 'founder' && Number(profile.store_id) !== Number(existing.store_id)) return res.status(403).json({ error: 'You cannot change this order.' });
      const { data, error } = await supabase.from('orders').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    console.error('Orders API error:', error);
    return res.status(500).json({ error: 'Could not process this order.' });
  }
}

// ------------------------------------------------------------------ media
const ALLOWED_IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|gif|heic|heif|avif|bmp)$/i;
const MAX_BASE64 = 8_400_000;
const MAX_BYTES = 6_291_456;

function applyCorsMedia(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getAuthedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return { error: 'No session token.' };
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: 'Invalid or expired session.' };
  return { user };
}

async function handleProfile(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { user, error } = await getAuthedUser(req);
  if (error) return res.status(401).json({ error });
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const productionHost = host === 'stoyangu.com' || host === 'www.stoyangu.com' || host.endsWith('.stoyangu.com');
  if (productionHost && String(user.email || '').toLowerCase() === 'founder-demo@stoyangu.com') return res.status(403).json({ error: 'Demo access is disabled on production.' });
  const { data, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (profileError || !data) return res.status(403).json({ error: 'No StoYangu workspace is assigned to this account.' });
  return res.status(200).json(data);
}

function sniffImageSignature(buffer, requestedType) {
  const signatures = {
    jpeg: buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    png: buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    webp: buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP',
    gif: ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString()),
    heic: buffer.subarray(4, 8).toString() === 'ftyp',
    avif: buffer.subarray(4, 8).toString() === 'ftyp' && ['avif', 'avis'].includes(buffer.subarray(8, 12).toString()),
    bmp: buffer.subarray(0, 2).toString() === 'BM',
  };
  const type = String(requestedType || '').toLowerCase();
  if (type.includes('jpeg') || type.includes('jpg')) return signatures.jpeg;
  if (type.includes('png')) return signatures.png;
  if (type.includes('webp')) return signatures.webp;
  if (type.includes('gif')) return signatures.gif;
  if (type.includes('avif')) return signatures.avif;
  if (type.includes('bmp')) return signatures.bmp;
  return signatures.heic;
}

function imageExtension(requestedType) {
  const type = String(requestedType || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('avif')) return 'avif';
  if (type.includes('bmp')) return 'bmp';
  if (type.includes('hei')) return 'heic';
  return 'jpg';
}

async function handleUpload(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { user, error } = await getAuthedUser(req);
  if (error) return res.status(401).json({ error });

  const { fileName, fileBase64, contentType, scope } = req.body || {};
  if (!['logos', 'products'].includes(scope)) return res.status(400).json({ error: 'Invalid upload type.' });
  if (!ALLOWED_IMAGE_TYPES.test(String(contentType || ''))) return res.status(400).json({ error: 'Please upload a JPG, PNG, WebP, GIF, HEIC, AVIF or BMP photo.' });
  if (typeof fileBase64 !== 'string' || fileBase64.length > MAX_BASE64) return res.status(400).json({ error: 'Image must be smaller than 6 MB.' });

  const buffer = Buffer.from(fileBase64, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) return res.status(400).json({ error: 'Invalid or oversized image.' });
  if (!sniffImageSignature(buffer, contentType)) return res.status(400).json({ error: 'That file does not contain a valid image.' });

  const extension = imageExtension(contentType);
  const path = `${scope}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const { error: uploadError } = await supabase.storage.from('stoyangu-media').upload(path, buffer, { contentType, upsert: false });
  if (uploadError) {
    console.error('Upload error:', uploadError);
    return res.status(500).json({ error: 'Could not upload that image.' });
  }
  const { data } = supabase.storage.from('stoyangu-media').getPublicUrl(path);
  return res.status(201).json({ url: data.publicUrl });
}

async function mediaHandler(req, res) {
  applyCorsMedia(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const action = String(req.query?.action || '').toLowerCase();
    if (!action) {
      if (req.method === 'GET') return handleProfile(req, res);
      if (req.method === 'POST') return handleUpload(req, res);
      return res.status(400).json({ error: 'Use ?action=profile or ?action=upload.' });
    }
    if (action === 'profile') return handleProfile(req, res);
    if (action === 'upload') return handleUpload(req, res);
    return res.status(400).json({ error: 'Unknown action. Use ?action=profile | upload' });
  } catch (err) {
    console.error('Media API error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}

// ------------------------------------------------------------------ subscriptions
async function owner(req) {
  const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token); if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).single(); return data ? { ...data, user } : null;
}

async function subscriptionsHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const profile = await owner(req); if (!profile || !profile.store_id) return res.status(401).json({ error: 'Store owner login required.' });
    if (req.method === 'GET') { const [{ data }, { data: installation }] = await Promise.all([supabase.from('push_subscriptions').select('id').eq('user_id', profile.user.id).limit(1), supabase.from('pwa_installations').select('*').eq('user_id', profile.user.id).limit(1)]); return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || '', registered: Boolean(data?.length), installation: installation?.[0] || null }); }
    if (req.method === 'POST') {
      const subscription = req.body?.subscription;
      const endpoint = String(subscription?.endpoint || '');
      const hasSubscription = Boolean(endpoint);
      if (hasSubscription && (!endpoint.startsWith('https://') || endpoint.length > 2000)) return res.status(400).json({ error: 'Invalid push subscription.' });
      if (!hasSubscription && req.body?.installed === undefined) return res.status(400).json({ error: 'Nothing to update.' });
      let savedSubscription = null;
      if (hasSubscription) {
        const { data: existing } = await supabase.from('push_subscriptions').select('id').eq('endpoint', endpoint).limit(1);
        const values = { store_id: profile.store_id, user_id: profile.user.id, endpoint, subscription };
        const result = existing?.length ? await supabase.from('push_subscriptions').update(values).eq('id', existing[0].id).select().single() : await supabase.from('push_subscriptions').insert(values).select().single();
        if (result.error) throw result.error;
        savedSubscription = result.data;
      }
      const { data: installationRows } = await supabase.from('pwa_installations').select('*').eq('user_id', profile.user.id).limit(1);
      const existingInstallation = installationRows?.[0] || null;
      const installationValues = {
        user_id: profile.user.id,
        store_id: profile.store_id,
        installed: req.body?.installed === undefined ? Boolean(existingInstallation?.installed) : Boolean(req.body.installed),
        notifications_enabled: hasSubscription ? true : Boolean(existingInstallation?.notifications_enabled),
        user_agent: String(req.body?.user_agent || existingInstallation?.user_agent || '').slice(0, 500),
        last_seen_at: new Date().toISOString(),
      };
      const installationResult = existingInstallation ? await supabase.from('pwa_installations').update(installationValues).eq('id', existingInstallation.id).select().single() : await supabase.from('pwa_installations').insert(installationValues).select().single();
      if (installationResult.error) throw installationResult.error;
      let welcomeSent = Boolean(installationResult.data.welcome_sent_at);
      if (hasSubscription && !welcomeSent && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
        try {
          await webpush.sendNotification(subscription, JSON.stringify({ title: 'Karibu StoYangu 👋', body: 'Your app and daily notifications are ready. You can now manage your products easily from your phone.', url: '/owner', tag: 'stoyangu-welcome' }));
          welcomeSent = true;
          await supabase.from('pwa_installations').update({ welcome_sent_at: new Date().toISOString() }).eq('id', installationResult.data.id);
        } catch (pushError) { console.error('Welcome push failed:', pushError.message); }
      }
      return res.status(201).json({ subscription: savedSubscription, installation: installationResult.data, welcomeSent });
    }
    if (req.method === 'DELETE') { const endpoint = String(req.body?.endpoint || ''); const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', profile.user.id).eq('endpoint', endpoint); if (error) throw error; return res.status(200).json({ ok: true }); }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Subscriptions API error:', err);
    return res.status(500).json({ error: 'Could not update notifications.' });
  }
}

// -------------------------------------------------------------- dispatcher
export default async function handler(req, res) {
  const fn = String(req.query?.fn || '').toLowerCase();
  if (fn === 'products') return productsHandler(req, res);
  if (fn === 'orders') return ordersHandler(req, res);
  if (fn === 'media') return mediaHandler(req, res);
  if (fn === 'subscriptions') return subscriptionsHandler(req, res);
  // Fallback: if no fn, try to be helpful for direct calls
  if (req.method === 'GET' && !req.query?.action) return mediaHandler(req, res);
  return res.status(400).json({ error: 'Unknown ops function. Use ?fn=products|orders|media|subscriptions' });
}
