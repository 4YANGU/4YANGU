import { lazy, Suspense } from 'react';
const StorefrontPage = lazy(() => import('./pages/StorefrontPage'));
const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const PlatformApp = lazy(() => import('./PlatformApp'));

function Loading() { return <div className="auth-loader" role="status"><img src="/stoyangu-logo.png" alt="StoYangu" width="150" /><span className="loading-line" /><p>Opening StoYangu…</p></div>; }
function MarketingFallback() { return <div className="marketing-prepaint"><header><img src="/stoyangu-logo.png" alt="StoYangu" /><a href="/login">Login</a></header><main><div><span>STORE YAKO. FREE KUANZA.</span><h1>Video Yangu,<br /><em>Store Yangu</em></h1><p>Pata full store for your customers to shop on.</p></div><img src="/images/kenyan-seller.jpg" alt="Kenyan business owner" /></main></div>; }
function subdomainSlug() {
  const pathMatch = window.location.pathname.match(/^\/s\/([^/?#]+)/);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  const host = window.location.hostname.toLowerCase();
  const rootDomain = String(import.meta.env.VITE_ROOT_DOMAIN || 'stoyangu.com').toLowerCase();
  if (host.endsWith(`.${rootDomain}`)) { const part = host.slice(0, -`.${rootDomain}`.length); if (part && part !== 'www') return part; }
  return new URLSearchParams(window.location.search).get('store') || '';
}
export default function ReplicaApp() {
  const slug = subdomainSlug();
  if (slug) return <Suspense fallback={<Loading />}><StorefrontPage forcedSlug={slug} /></Suspense>;
  if (window.location.pathname === '/') return <Suspense fallback={<MarketingFallback />}><MarketingPage /></Suspense>;
  return <Suspense fallback={<Loading />}><PlatformApp /></Suspense>;
}
