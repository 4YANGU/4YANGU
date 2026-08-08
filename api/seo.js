import supabase from '../lib/db-client.js';

const xml = (value) => String(value).replace(/[<>&'\"]/g, (character) => ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[character]));

async function handleRobots(req, res) {
  const root = process.env.ROOT_DOMAIN || String(req.headers.host || 'stoyangu.com').replace(/^www\./, '');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(`User-agent: *\nAllow: /\nDisallow: /founder\nDisallow: /owner\nDisallow: /manage/\nDisallow: /api/profile\nDisallow: /api/dashboard\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n\nUser-agent: Applebot-Extended\nAllow: /\n\nSitemap: https://${root}/sitemap.xml\n`);
}

async function handleSitemap(req, res) {
  try {
    const root = process.env.ROOT_DOMAIN || String(req.headers.host || 'stoyangu.com').replace(/^www\./, '');
    const { data: stores, error } = await supabase.from('stores').select('slug,updated_at').eq('is_active', true).order('slug', { ascending: true });
    if (error) throw error;
    const urls = [`<url><loc>https://${xml(root)}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`, ...(stores || []).flatMap((store) => [
      `<url><loc>https://${xml(store.slug)}.${xml(root)}/</loc><lastmod>${new Date(store.updated_at).toISOString()}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`,
      `<url><loc>https://${xml(root)}/s/${xml(store.slug)}</loc><lastmod>${new Date(store.updated_at).toISOString()}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`,
    ])];
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  } catch (err) {
    console.error('Sitemap API error:', err);
    return res.status(500).send('Could not generate sitemap.');
  }
}

async function handleCatalog(req, res) {
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const type = req.query?.type;
  if (type === 'robots') return handleRobots(req, res);
  if (type === 'sitemap') return handleSitemap(req, res);
  if (type === 'catalog') return handleCatalog(req, res);
  return res.status(400).json({ error: 'Unknown or missing type. Use ?type=robots | sitemap | catalog' });
}
