/**
 * StoYangu skin bridge — tracking-only. Skins arrive fully stamped with live
 * data by the server; this script exists solely to record visits, product views
 * and order clicks. It never mutates the page and never blocks it.
 */
(function () {
  var meta = document.querySelector('meta[name="stoyangu-slug"]');
  var slug = meta && meta.content;
  if (!slug) return;
  var session = 'anon';
  try {
    session = sessionStorage.getItem('stoyangu-visit-session');
    if (!session) { session = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)); sessionStorage.setItem('stoyangu-visit-session', session); }
  } catch (e) { /* private mode */ }

  function track(type, productId) {
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug, event_type: type, product_id: Number(productId || 0), session_id: session }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* never block the skin */ }
  }

  // Page view (per tab session).
  track('visit', 0);

  // Product clicks → order taps.
  document.addEventListener('click', function (event) {
    var order = event.target && event.target.closest ? event.target.closest('[data-sty-order]') : null;
    if (order) track('order', order.getAttribute('data-product') || 0);
  }, { passive: true });

  // Product views: cards entering viewport, or a stamped product page.
  var pageProduct = (document.querySelector('meta[name="stoyangu-product"]') || {}).content;
  if (pageProduct) track('product_view', pageProduct);
  if ('IntersectionObserver' in window) {
    var seen = {};
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.getAttribute('data-product');
        if (id && !seen[id]) { seen[id] = true; track('product_view', id); }
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.45 });
    document.querySelectorAll('[data-sty-card][data-product]').forEach(function (node) { observer.observe(node); });
  }
})();
