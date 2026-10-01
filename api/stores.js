import supabase from '../lib/db-client.js';
import originalHandler from '../server/stores.js';
import { handlePwaIcon, handlePwaManifest, handlePwaStore } from '../server/pwa.js';
import { handleDarajaRequest } from '../server/mpesa.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  // Per-store web app install (PWA) endpoints. Kept inside this function so
  // the project stays at Vercel Hobby's 12-function limit.
  const pwa = req.query?.pwa;
  if (pwa === 'store') {
    try { return await handlePwaStore(req, res); }
    catch (e) { console.error('PWA store lookup error:', e); return res.status(500).json({ error: 'Could not load the store. Please retry.' }); }
  }
  if (pwa === 'manifest') {
    try { return await handlePwaManifest(req, res); }
    catch (e) { console.error('PWA manifest error:', e); return res.status(500).json({ error: 'Could not load the app details.' }); }
  }
  if (pwa === 'icon') {
    try { return await handlePwaIcon(req, res); }
    catch (e) { console.error('PWA icon error:', e); return res.status(500).json({ error: 'Could not load the app icon.' }); }
  }
  if (req.query?.daraja) return await handleDarajaRequest(req, res);
  void supabase;
  try { return await originalHandler(req, res); } catch (e) { return res.status(500).json({ error: 'Unable to process the store. Please retry.' }); }
}
