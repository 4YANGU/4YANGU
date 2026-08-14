// Storefront HTML must bring its own complete plain CSS. The app does not add
// framework or CDN styling at runtime.

export function isAllowedDesignHost(url) {
  try {
    const host = new URL(String(url).startsWith('//') ? `https:${url}` : url).hostname.toLowerCase();
    return /(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com)$/i.test(host);
  } catch {
    return false;
  }
}

export function ensureDesignRuntime(html) {
  return String(html || '');
}

export function isSelfContainedDesign(html) {
  const text = String(html || '');
  return /<style\b|data-product-grid|stoyangu-card-template|#productGrid|#featuredGrid/i.test(text);
}
