import supabase from '../lib/db-client.js';
import originalHandler from '../server/products.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end(); void supabase;
  try { return await originalHandler(req, res); } catch (e) { return res.status(500).json({ error: 'Unable to process the product. Please retry.' }); }
}
