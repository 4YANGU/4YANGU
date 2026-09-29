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
  plugins: {
    // Keeps the store's logo on screen (from res/drawable/splash.png, generated per-store
    // in prepare-store-apk.mjs) for the whole time the site is loading, instead of the
    // brief OS icon flash. The site itself never has to call hide() — it just auto-hides
    // after a fixed delay long enough to cover a normal load.
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: true,
      backgroundColor: '#101f30',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};
export default config;
