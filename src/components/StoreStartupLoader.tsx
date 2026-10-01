import { readSplashCache, splashCacheKey } from '../lib/pwa';
import '../pwa-splash.css';

type Props = { message?: string };

function cachedStoreLogoForCurrentRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const managedStore = path.match(/^\/manage\/(\d+)/);
  const cacheKey = managedStore
    ? splashCacheKey(managedStore[1])
    : path === '/owner' || path === '/app'
      ? splashCacheKey(undefined)
      : null;
  return cacheKey ? readSplashCache(cacheKey)?.logo_url || '' : '';
}

export default function StoreStartupLoader({ message = 'Opening your workspace…' }: Props) {
  const logoUrl = cachedStoreLogoForCurrentRoute();

  return <div className="auth-loader store-startup-loader" role="status">
    {logoUrl && <img className="store-splash-logo" src={logoUrl} alt="" />}
    <span className="loading-line" aria-hidden="true" />
    <p>{message}</p>
  </div>;
}
