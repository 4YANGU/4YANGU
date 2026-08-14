import supabase from '../lib/db-client.js';

const UPKEEP_PERIOD_MS = 30 * 86400000;
const upkeepPeriod = (store, now = Date.now()) => {
  const started = new Date(store.billing_started_at || store.created_at || now).getTime();
  const anchor = Number.isFinite(started) ? started : now;
  const periodNumber = Math.max(0, Math.floor((now - anchor) / UPKEEP_PERIOD_MS));
  const startsAt = anchor + periodNumber * UPKEEP_PERIOD_MS;
  return { startsAt, endsAt: startsAt + UPKEEP_PERIOD_MS };
};
const addUpkeepPlan = (store, periodOrders, period) => ({ ...store, orders_this_period: periodOrders, upkeep_plan: periodOrders > 5 ? 'PRO' : 'FREE', upkeep_due: periodOrders > 5 ? 999 : 0, upkeep_period_starts_at: new Date(period.startsAt).toISOString(), upkeep_period_ends_at: new Date(period.endsAt).toISOString() });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data: { user } } = await supabase.auth.getUser(token); if (!user) return res.status(401).json({ error: 'Invalid session' });
    const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single(); if (!profile) return res.status(403).json({ error: 'Workspace not assigned.' });
    const requested = Number(req.query?.storeId || 0);
    if (profile.role === 'owner' || requested) {
      const storeId = profile.role === 'founder' ? requested : profile.store_id;
      if (!storeId) return res.status(404).json({ error: 'No store is assigned.' });
      const [{ data: store, error }, { data: products }, { data: notifications }] = await Promise.all([
        supabase.from('stores').select('*').eq('id', storeId).single(),
        supabase.from('products').select('*').eq('store_id', storeId).eq('active', true).order('created_at', { ascending: false }),
        supabase.from('notifications').select('id,batch_key,title,body,edited_body,status,created_at').eq('store_id', storeId).order('created_at', { ascending: false }).limit(5),
      ]);
      if (error || !store) return res.status(404).json({ error: 'Store not found.' });
      const period = upkeepPeriod(store);
      const { data: periodOrders } = await supabase.from('store_events').select('id').eq('store_id', storeId).eq('event_type', 'order').gte('created_at', new Date(period.startsAt).toISOString()).lt('created_at', new Date(period.endsAt).toISOString());
      // Show today's counters as zero on a fresh Nairobi day even before the first
      // event lands, so yesterday's numbers never masquerade as today's.
      const nairobiToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
      if (store.metrics_date !== nairobiToday) { store.visitor_today = 0; store.orders_today = 0; }
      const { data: media, error: mediaError } = products?.length ? await supabase.from('product_images').select('*').in('product_id', products.map((product) => product.id)).order('sort_order', { ascending: true }) : { data: [], error: null };
      if (mediaError) throw mediaError;
      const liveProducts = (products || []).map((product) => { const images = (media || []).filter((image) => image.product_id === product.id).map((image) => image.url).slice(0, 7); if (product.metrics_date !== nairobiToday) { product.views_today = 0; product.orders_today = 0; } return { ...product, images: images.length ? images : [product.image_url].filter(Boolean) }; });
      const { data: highlights, error: highlightError } = notifications?.length ? await supabase.from('notification_highlights').select('*').in('notification_id', notifications.map((notification) => notification.id)) : { data: [], error: null };
      if (highlightError) throw highlightError;
      const ranked = [...liveProducts].sort((a, b) => Number(b.orders_today) - Number(a.orders_today) || Number(b.views_today) - Number(a.views_today));
      const fallbackWinner = ranked[0] || null;
      const fallbackNeeds = [...liveProducts].filter((product) => product.id !== fallbackWinner?.id).sort((a, b) => (Number(b.views_today) - Number(b.orders_today) * 3) - (Number(a.views_today) - Number(a.orders_today) * 3))[0] || null;
      const quietDay = Number(store.visitor_today || 0) === 0 && Number(store.orders_today || 0) === 0;
      const enrichedNotifications = (notifications || []).map((item) => { const highlight = (highlights || []).find((row) => row.notification_id === item.id); const isCustomMessage = String(item.batch_key || '').startsWith('custom-'); const noProduct = isCustomMessage || quietDay; return { ...item, body: item.edited_body || item.body, winner_product: noProduct ? null : liveProducts.find((product) => product.id === highlight?.winner_product_id) || fallbackWinner, needs_product: noProduct ? null : liveProducts.find((product) => product.id === highlight?.needs_product_id) || fallbackNeeds }; });
      return res.status(200).json({ profile, store: addUpkeepPlan(store, periodOrders?.length || 0, period), products: liveProducts, notifications: enrichedNotifications });
    }
    if (profile.role !== 'founder') return res.status(403).json({ error: 'Founder access required.' });
    const [{ data: stores }, { data: products }, { data: applications }, { data: installations }, { data: recentOrders }] = await Promise.all([
      supabase.from('stores').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('id,store_id,active'),
      supabase.from('applications').select('*').order('created_at', { ascending: false }),
      supabase.from('pwa_installations').select('store_id,installed,notifications_enabled,welcome_sent_at,last_seen_at'),
      supabase.from('store_events').select('store_id,created_at').eq('event_type', 'order').gte('created_at', new Date(Date.now() - UPKEEP_PERIOD_MS).toISOString()),
    ]);
    // Fresh Nairobi day before the first event: show zero for today's counters.
    const nairobiToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    for (const store of stores || []) { if (store.metrics_date !== nairobiToday) { store.visitor_today = 0; store.orders_today = 0; } }
    const storesWithPlans = (stores || []).map((store) => { const period = upkeepPeriod(store); const count = (recentOrders || []).filter((event) => event.store_id === store.id && new Date(event.created_at).getTime() >= period.startsAt && new Date(event.created_at).getTime() < period.endsAt).length; return addUpkeepPlan(store, count, period); });
    const liveProducts = (products || []).filter((product) => product.active);
    const analytics = { activeStores: storesWithPlans.filter((store) => store.is_active).length, visitors: storesWithPlans.reduce((sum, store) => sum + Number(store.visitor_total || 0), 0), visitorsToday: storesWithPlans.reduce((sum, store) => sum + Number(store.visitor_today || 0), 0), orders: storesWithPlans.reduce((sum, store) => sum + Number(store.orders_total || 0), 0), ordersToday: storesWithPlans.reduce((sum, store) => sum + Number(store.orders_today || 0), 0), products: liveProducts.length };
    const productCounts = liveProducts.reduce((map, product) => ({ ...map, [product.store_id]: (map[product.store_id] || 0) + 1 }), {});
    const installationStatus = (installations || []).reduce((map, item) => ({ ...map, [item.store_id]: item }), {});
    return res.status(200).json({ profile, analytics, stores: storesWithPlans, applications: applications || [], productCounts, installations: installationStatus });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return res.status(500).json({ error: 'Could not load the dashboard.' });
  }
}
