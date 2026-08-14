import supabase from '../lib/db-client.js';

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
      // Show today's counters as zero on a fresh Nairobi day even before the first
      // event lands, so yesterday's numbers never masquerade as today's.
      const nairobiToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
      const dayStart = `${nairobiToday}T00:00:00+03:00`;
      const { data: todayEvents } = await supabase.from('store_events').select('event_type').eq('store_id', storeId).gte('created_at', dayStart);
      const countedVisits = (todayEvents || []).filter((row) => row.event_type === 'visit').length;
      const countedOrders = (todayEvents || []).filter((row) => row.event_type === 'order').length;
      if (store.metrics_date !== nairobiToday || Number(store.visitor_today || 0) !== countedVisits || Number(store.orders_today || 0) !== countedOrders) {
        store.visitor_today = countedVisits;
        store.orders_today = countedOrders;
        store.metrics_date = nairobiToday;
        await supabase.from('stores').update({ visitor_today: countedVisits, orders_today: countedOrders, metrics_date: nairobiToday }).eq('id', store.id);
      }
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
      return res.status(200).json({ profile, store, products: liveProducts, notifications: enrichedNotifications });
    }
    if (profile.role !== 'founder') return res.status(403).json({ error: 'Founder access required.' });
    const [{ data: stores }, { data: products }, { data: applications }, { data: installations }] = await Promise.all([
      supabase.from('stores').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('id,store_id,active'),
      supabase.from('applications').select('*').order('created_at', { ascending: false }),
      supabase.from('pwa_installations').select('store_id,installed,notifications_enabled,welcome_sent_at,last_seen_at'),
    ]);
    // Fresh Nairobi day before the first event: show zero for today's counters.
    const nairobiToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    const dayStart = `${nairobiToday}T00:00:00+03:00`;
    const { data: todayEvents } = await supabase.from('store_events').select('store_id,event_type').gte('created_at', dayStart);
    const visitMap = {};
    const orderMap = {};
    (todayEvents || []).forEach((row) => {
      if (row.event_type === 'visit') visitMap[row.store_id] = (visitMap[row.store_id] || 0) + 1;
      if (row.event_type === 'order') orderMap[row.store_id] = (orderMap[row.store_id] || 0) + 1;
    });
    for (const store of stores || []) {
      const visits = visitMap[store.id] || 0;
      const orders = orderMap[store.id] || 0;
      if (store.metrics_date !== nairobiToday || Number(store.visitor_today || 0) !== visits || Number(store.orders_today || 0) !== orders) {
        store.visitor_today = visits;
        store.orders_today = orders;
        store.metrics_date = nairobiToday;
        await supabase.from('stores').update({ visitor_today: visits, orders_today: orders, metrics_date: nairobiToday }).eq('id', store.id);
      }
    }
    const now = Date.now();
    for (const store of stores || []) {
      const paid = store.billing_paid_until && new Date(store.billing_paid_until).getTime() > now;
      const overdue = store.is_active && store.billing_started_at && now > new Date(store.billing_started_at).getTime() + 35 * 86400000 && !paid;
      if (overdue) { store.is_active = false; await supabase.from('stores').update({ is_active: false }).eq('id', store.id); }
    }
    const liveProducts = (products || []).filter((product) => product.active);
    const analytics = { activeStores: (stores || []).filter((store) => store.is_active).length, visitors: (stores || []).reduce((sum, store) => sum + Number(store.visitor_total || 0), 0), visitorsToday: (stores || []).reduce((sum, store) => sum + Number(store.visitor_today || 0), 0), orders: (stores || []).reduce((sum, store) => sum + Number(store.orders_total || 0), 0), ordersToday: (stores || []).reduce((sum, store) => sum + Number(store.orders_today || 0), 0), products: liveProducts.length };
    const productCounts = liveProducts.reduce((map, product) => ({ ...map, [product.store_id]: (map[product.store_id] || 0) + 1 }), {});
    const installationStatus = (installations || []).reduce((map, item) => ({ ...map, [item.store_id]: item }), {});
    return res.status(200).json({ profile, analytics, stores: stores || [], applications: applications || [], productCounts, installations: installationStatus });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return res.status(500).json({ error: 'Could not load the dashboard.' });
  }
}
