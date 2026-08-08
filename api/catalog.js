import supabase from './db-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const root = process.env.ROOT_DOMAIN || String(req.headers.host || 'stoyangu.com').replace(/^www\./, '');
    const [{ data: stores, error: storeError }, { data: products, error: productError }] = await Promise.all([
      supabase.from('stores').select('id,name,slug,categories,logo_url,updated_at').eq('is_active', true).order('name', { ascending: true }),
      supabase.from('products').select('id,store_id,name,price,category,image_url,active,updated_at').eq('active', true).order('name', { ascending: true }),
    ]);
    if (storeError || productError) throw storeError || productError;
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).json({ name: 'StoYangu public store directory', generated_at: new Date().toISOString(), stores: (stores || []).map((store) => ({ name: store.name, url: `https://${store.slug}.${root}/`, categories: store.categories, logo: store.logo_url, updated_at: store.updated_at, products: (products || []).filter((product) => product.store_id === store.id).map((product) => ({ name: product.name, category: product.category, price_kes: Number(product.price), image: product.image_url, updated_at: product.updated_at })) })) });
  } catch (err) {
    console.error('Catalog API error:', err);
    return res.status(500).json({ error: 'Could not generate the public catalog.' });
  }
}
