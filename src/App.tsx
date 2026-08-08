import { lazy, Suspense } from 'react';
const StorefrontPage = lazy(() => import('./pages/StorefrontPage'));
const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const PlatformApp = lazy(() => import('./PlatformApp'));

function MarketingFallback() {
  return <div className="marketing-prepaint"><header><img src="/stoyangu-logo.png" alt="StoYangu" /><a href="/login">Login</a></header><main><div><span>STORE YAKO. FREE KUANZA.</span><h1>Video Yangu,<br /><em>Store Yangu</em></h1><p>Pata full store for your customers to shop on.</p></div><img src="/images/kenyan-seller.jpg" alt="Kenyan business owner" /></main></div>;
}

function subdomainSlug() {
  const pathMatch = window.location.pathname.match(/^\/s\/([^/?#]+)/);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  const host = window.location.hostname.toLowerCase();
  const rootDomain = String(import.meta.env.VITE_ROOT_DOMAIN || 'stoyangu.com').toLowerCase();
  if (host.endsWith(`.${rootDomain}`)) {
    const part = host.slice(0, -`.${rootDomain}`.length);
    if (part && part !== 'www') return part;
  }
  if (host !== 'localhost' && !host.endsWith('.vercel.app') && !host.endsWith('.arcada.app') && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split('.');
    const twoPartSuffixes = new Set(['co.ke', 'or.ke', 'ac.ke', 'co.uk', 'com.au', 'co.za']);
    const rootLength = twoPartSuffixes.has(parts.slice(-2).join('.')) ? 3 : 2;
    if (parts.length > rootLength && parts[0] !== 'www') return parts[0];
  }
  const query = new URLSearchParams(window.location.search).get('store');
  return query || '';
}

export default function App() {
  const slug = subdomainSlug();
  if (slug) return <Suspense fallback={null}><StorefrontPage forcedSlug={slug} /></Suspense>;
  if (window.location.pathname === '/') return <Suspense fallback={<MarketingFallback />}><MarketingPage /></Suspense>;
  return <Suspense fallback={null}><PlatformApp /></Suspense>;
}
