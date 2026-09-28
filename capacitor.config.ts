import type { CapacitorConfig } from '@capacitor/cli';

const slug = String(process.env.STORE_SLUG || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 42) || 'store';
const storeId = String(process.env.STORE_ID || '0').replace(/[^0-9]/g, '');
const appId = `com.stoyangu.store.s_${storeId}`;
const origin = String(process.env.STOYANGU_LIVE_URL || 'https://stoyangu.com').replace(/\/$/, '');
const host = new URL(origin).hostname;
const config: CapacitorConfig = {
  appId,
  appName: 'StoYangu',
  webDir: 'dist',
  server: { url: `${origin}/owner?nativeStore=${encodeURIComponent(slug)}`, cleartext: false, allowNavigation: [host] },
  android: { allowMixedContent: false },
};
export default config;
