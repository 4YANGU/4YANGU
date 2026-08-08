import supabase from './db-client.js';

const xml = (value) => String(value).replace(/[<>&'\"]/g, (character) => ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[character]));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
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
