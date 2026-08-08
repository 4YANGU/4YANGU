import supabase from '../lib/db-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid session' });
    const { data, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
    if (error || !data) return res.status(403).json({ error: 'No StoYangu workspace is assigned to this account.' });
    return res.status(200).json(data);
  } catch (err) {
    console.error('Profile API error:', err);
    return res.status(500).json({ error: 'Could not load your profile.' });
  }
}
