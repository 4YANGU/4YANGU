import supabase from '../lib/db-client.js';

const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 55);
const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  const normalized = digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
  return normalized.length >= 10 && normalized.length <= 15 ? `+${normalized}` : '';
};
const ownerAuthEmail = (phone) => `phone-${String(phone).replace(/\D/g, '')}@owners.stoyangu.invalid`;
const safeDesign = (value) => {
  if (typeof value === 'string') {
    if (value.length > 2000000) throw new Error('Design JSON is too large.');
    return JSON.parse(value);
  }
  const text = JSON.stringify(value || {});
  if (text.length > 2000000) throw new Error('Design JSON is too large.');
  return value && typeof value === 'object' ? value : {};
};
async function authProfile(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
  return data ? { ...data, user } : null;
}
const expired = (store) => {
  if (!store.is_active || !store.billing_started_at || store.billing_paid_until && new Date(store.billing_paid_until) > new Date()) return false;
  return Date.now() > new Date(store.billing_started_at).getTime() + 35 * 86400000;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'GET' && (req.query?.slug || req.query?.featured)) {
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
      let result;
      if (req.query.slug) {
        const requestedSlug = slugify(req.query.slug);
        result = await supabase.from('stores').select('*').eq('is_active', true).eq('slug', requestedSlug).single();
        if (result.error || !result.data) {
          const { data: alias } = await supabase.from('store_aliases').select('store_id').eq('slug', requestedSlug).eq('active', true).single();
          if (alias?.store_id) result = await supabase.from('stores').select('*').eq('is_active', true).eq('id', alias.store_id).single();
        }
      }
      else {
        result = await supabase.from('stores').select('*').eq('is_active', true).eq('slug', slugify(process.env.FEATURED_STORE_SLUG || 'stevo-jerseys')).single();
        if (result.error || !result.data) result = await supabase.from('stores').select('*').eq('is_active', true).order('created_at', { ascending: true }).limit(1).single();
      }
      const { data: store, error } = result;
      if (error || !store) return res.status(404).json({ error: 'Store not found or currently offline.' });
      if (expired(store)) { await supabase.from('stores').update({ is_active: false }).eq('id', store.id); return res.status(404).json({ error: 'This store is currently offline.' }); }
      const { data: products, error: productsError } = await supabase.from('products').select('*').eq('store_id', store.id).eq('active', true).order('created_at', { ascending: false });
      if (productsError) throw productsError;
      const { data: media, error: mediaError } = products?.length ? await supabase.from('product_images').select('*').in('product_id', products.map((product) => product.id)).order('sort_order', { ascending: true }) : { data: [], error: null };
      if (mediaError) throw mediaError;
      const liveProducts = (products || []).map((product) => { const images = (media || []).filter((image) => image.product_id === product.id).map((image) => image.url).slice(0, 7); return { ...product, images: images.length ? images : [product.image_url].filter(Boolean) }; });
      return res.status(200).json({ store, products: liveProducts });
    }
    const profile = await authProfile(req);
    if (!profile) return res.status(401).json({ error: 'Please login again.' });
    if (req.method === 'GET') {
      let query = supabase.from('stores').select('*').order('created_at', { ascending: false });
      if (profile.role !== 'founder') query = query.eq('id', profile.store_id);
      const { data, error } = await query; if (error) throw error; return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      if (profile.role !== 'founder') return res.status(403).json({ error: 'Founder access required.' });
      const body = req.body || {}; const name = String(body.name || '').trim().slice(0, 100); const whatsapp = normalizePhone(body.whatsapp); const password = String(body.owner_password || '');
      if (name.length < 2 || !whatsapp || password.length < 8) return res.status(400).json({ error: 'Store name, owner WhatsApp number and a temporary password of at least 8 characters are required.' });
      let slug = slugify(name); if (!slug) return res.status(400).json({ error: 'Store name needs letters or numbers.' });
      const { data: taken } = await supabase.from('stores').select('slug').like('slug', `${slug}%`);
      if (taken?.some((item) => item.slug === slug)) { let suffix = 2; while (taken.some((item) => item.slug === `${slug}-${suffix}`)) suffix++; slug = `${slug}-${suffix}`; }
      const { data: store, error } = await supabase.from('stores').insert({ name, slug, owner_name: 'Store owner', owner_email: '', whatsapp, phone: whatsapp, logo_url: String(body.logo_url || '').slice(0, 1000), categories: Array.isArray(body.categories) ? body.categories.slice(0, 50) : [], design_json: safeDesign(body.design_json), is_active: true, billing_started_at: new Date().toISOString(), visitor_total: 0, visitor_today: 0, orders_total: 0, orders_today: 0, metrics_date: new Date().toISOString().slice(0, 10) }).select().single();
      if (error) throw error;
      const authEmail = ownerAuthEmail(whatsapp);
      const { data: created, error: userError } = await supabase.auth.admin.createUser({ email: authEmail, password, email_confirm: true, user_metadata: { role: 'owner', store_name: name, whatsapp } });
      if (userError) { await supabase.from('stores').delete().eq('id', store.id); throw userError; }
      const { error: profileError } = await supabase.from('profiles').insert({ user_id: created.user.id, email: authEmail, phone: whatsapp, full_name: 'Store owner', role: 'owner', store_id: store.id });
      if (profileError) throw profileError;
      return res.status(201).json(store);
    }
    if (req.method === 'PUT') {
      const id = Number(req.body?.id); if (!id) return res.status(400).json({ error: 'Store is required.' });
      if (profile.role !== 'founder' && profile.store_id !== id) return res.status(403).json({ error: 'You cannot change this store.' });
      if (req.body.action === 'details') {
        if (profile.role !== 'founder') return res.status(403).json({ error: 'Founder access required.' });
        const { data: existing } = await supabase.from('stores').select('*').eq('id', id).single();
        if (!existing) return res.status(404).json({ error: 'Store not found.' });
        const name = String(req.body.name || '').trim().slice(0, 100); const whatsapp = normalizePhone(req.body.whatsapp); const newPassword = String(req.body.owner_password || '');
        if (name.length < 2 || !whatsapp || newPassword && newPassword.length < 8) return res.status(400).json({ error: 'Add a valid store name, WhatsApp number and optional password of at least 8 characters.' });
        let slug = slugify(name); const { data: taken } = await supabase.from('stores').select('id').eq('slug', slug).neq('id', id).limit(1); if (taken?.length) return res.status(400).json({ error: 'Another store already uses that name or subdomain.' });
        if (existing.slug !== slug) await supabase.from('store_aliases').upsert({ store_id: id, slug: existing.slug, active: true }, { onConflict: 'slug' });
        const categories = Array.isArray(req.body.categories) ? req.body.categories.map((item) => String(item).trim()).filter(Boolean).slice(0, 50) : existing.categories;
        const changes = { name, slug, whatsapp, phone: whatsapp, owner_name: 'Store owner', owner_email: '', logo_url: String(req.body.logo_url ?? existing.logo_url).slice(0, 1000), categories, updated_at: new Date().toISOString() };
        const { data: ownerProfile } = await supabase.from('profiles').select('user_id').eq('store_id', id).eq('role', 'owner').single();
        if (ownerProfile?.user_id) {
          const authEmail = ownerAuthEmail(whatsapp);
          const attributes = { email: authEmail, email_confirm: true, user_metadata: { role: 'owner', store_name: name, whatsapp }, ...(newPassword ? { password: newPassword } : {}) };
          const { error: authUpdateError } = await supabase.auth.admin.updateUserById(ownerProfile.user_id, attributes); if (authUpdateError) throw authUpdateError;
          await supabase.from('profiles').update({ phone: whatsapp, email: authEmail }).eq('user_id', ownerProfile.user_id);
        }
        const { data, error } = await supabase.from('stores').update(changes).eq('id', id).select().single(); if (error) throw error; return res.status(200).json(data);
      }
      if (req.body.action === 'billing') {
        if (profile.role !== 'founder') return res.status(403).json({ error: 'Founder access required.' });
        const active = Boolean(req.body.is_active); const changes = active ? { is_active: true, billing_started_at: new Date().toISOString(), updated_at: new Date().toISOString() } : { is_active: false, updated_at: new Date().toISOString() };
        const { data, error } = await supabase.from('stores').update(changes).eq('id', id).select().single(); if (error) throw error; return res.status(200).json(data);
      }
      if (req.body.action === 'design') {
        if (profile.role !== 'founder') return res.status(403).json({ error: 'Founder access required.' });
        const { data, error } = await supabase.from('stores').update({ design_json: safeDesign(req.body.design_json), updated_at: new Date().toISOString() }).eq('id', id).select().single(); if (error) throw error; return res.status(200).json(data);
      }
      return res.status(400).json({ error: 'Unknown store update.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Stores API error:', err);
    return res.status(500).json({ error: err.message === 'Design JSON is too large.' ? err.message : 'Could not process that store.' });
  }
}
