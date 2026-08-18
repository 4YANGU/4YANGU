import supabase from '../lib/db-client.js';

// Founder-only endpoint that safeguards orders extracted when a store is turned
// off, lists them, and restores them back into the live orders table on demand.

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

async function founderProfile(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
  return profile ? { ...profile, user } : null;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const profile = await founderProfile(req);
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });
    if (profile.role !== 'founder') return res.status(403).json({ error: 'Founder access required.' });
    const storeId = Number(req.query?.storeId || req.body?.storeId || 0);
    if (!storeId) return res.status(400).json({ error: 'Store is required.' });

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('archived_orders')
        .select('*')
        .eq('store_id', storeId)
        .order('order_created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      if (req.query?.summary !== undefined) return res.status(200).json({ count: (data || []).length });
      return res.status(200).json({ count: (data || []).length, orders: data || [] });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '');
      if (action !== 'restore') return res.status(400).json({ error: 'Unknown archived-orders action.' });
      const { data: archived, error: fetchError } = await supabase
        .from('archived_orders')
        .select('*')
        .eq('store_id', storeId)
        .order('order_created_at', { ascending: true });
      if (fetchError) throw fetchError;
      if (!archived?.length) return res.status(200).json({ restored: 0 });
      const rows = archived.map((row) => ({
        order_key: String(row.order_key || `restored-${row.id}`),
        store_id: storeId,
        product_id: Number(row.product_id || 0),
        product_name: String(row.product_name || ''),
        product_price: Number(row.product_price || 0),
        customer_phone: String(row.customer_phone || ''),
        color: String(row.color || ''),
        size: String(row.size || ''),
        fulfilment: String(row.fulfilment || ''),
        note: String(row.note || ''),
        status: String(row.status || 'new'),
        created_at: row.order_created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      const { error: insertError } = await supabase.from('orders').insert(rows);
      if (insertError) throw insertError;
      const { error: clearError } = await supabase.from('archived_orders').delete().eq('store_id', storeId);
      if (clearError) throw clearError;
      const { data: store } = await supabase.from('stores').select('orders_total').eq('id', storeId).single();
      if (store) {
        await supabase.from('stores').update({ orders_total: Number(store.orders_total || 0) + rows.length, updated_at: new Date().toISOString() }).eq('id', storeId);
      }
      return res.status(200).json({ restored: rows.length });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    console.error('Archived orders API error:', error);
    return res.status(500).json({ error: 'Could not process the archived orders.' });
  }
}
