import supabase from '../lib/db-client.js';
import webpush from 'web-push';
import { fallbackOrders, missingOrdersTable, saveFallbackOrder, storeOrders, updateFallbackOrder } from '../lib/order-fallback.js';

const cors = (res) => {
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
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@stoyangu.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  } catch (vapidError) {
    // Wame fix: invalid VAPID keys used to throw here on EVERY order, which
    // turned the whole order request into a 500 after the order was already
    // saved — customers never reached WhatsApp. Push now simply stays off
    // until the keys are fixed.
    console.error('VAPID keys are invalid - order push disabled until they are corrected:', vapidError.message);
    return;
  }
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

export default async function handler(req, res) {
  cors(res);
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
        // Wame fix: use the event-log fallback for ANY insert failure, not only
        // a missing table, so a confirmed order is never lost to a database hiccup.
        console.error('Orders table insert failed, using event-log fallback:', inserted.error.message || inserted.error);
        order = await saveFallbackOrder(supabase, values);
        fallbackUsed = true;
      }
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
      // Wame fix: everything below is a side effect. The order is already saved,
      // so none of it may ever turn the customer's response into a 500 — that is
      // what used to stop WhatsApp from opening after a successful order.
      if (!fallbackUsed) {
        try { const sessionId = `order-${order.id}`; await supabase.from('store_events').insert({ store_id: store.id, product_id: product.id, event_type: 'order', session_id: sessionId }); }
        catch (eventError) { console.error('Order event tracking failed (order is safe):', eventError.message); }
      }
      const storeIsToday = store.metrics_date === today;
      const productIsToday = product.metrics_date === today;
      try {
        await Promise.all([
          supabase.from('stores').update({ orders_total: Number(store.orders_total || 0) + 1, orders_today: (storeIsToday ? Number(store.orders_today || 0) : 0) + 1, metrics_date: today }).eq('id', store.id),
          supabase.from('products').update({ orders_total: Number(product.orders_total || 0) + 1, orders_today: (productIsToday ? Number(product.orders_today || 0) : 0) + 1, metrics_date: today }).eq('id', product.id),
        ]);
      } catch (metricsError) { console.error('Order metrics update failed (order is safe):', metricsError.message); }
      try {
        await sendInstantOrderPush(store.id, order, product);
      } catch (pushError) { console.error('Instant order push failed (order is safe):', pushError.message); }
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
