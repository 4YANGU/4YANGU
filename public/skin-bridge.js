/**
 * StoYangu skin bridge — injected into uploaded AI-built storefronts.
 * Wires the skin's outward shell to the app's live internals:
 *  - live store name + link
 *  - per-product WhatsApp order links
 *  - optional live product grid injection
 *  - visit + product-view tracking
 */
(function () {
  var meta = document.querySelector('meta[name="stoyangu-slug"]');
  var slug = meta && meta.content;
  if (!slug) return;
  var session = null;
  try {
    session = sessionStorage.getItem('stoyangu-visit-session');
    if (!session) { session = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)); sessionStorage.setItem('stoyangu-visit-session', session); }
  } catch (e) { session = 'anon'; }

  var store = null;
  var products = [];
  var byName = {};
  function money(v) { return 'KES ' + (Number(v) || 0).toLocaleString('en-KE'); }
  function orderUrl(product) {
    var phone = String(store.whatsapp || '').replace(/\D/g, '');
    var text = product
      ? 'Hi ' + store.name + '! I want to order: ' + product.name + ' (' + money(product.price) + '). Please confirm availability.'
      : 'Hi ' + store.name + '! I am interested in something from your store. Please help me order.';
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  }
  function track(type, productId) {
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: slug, event_type: type, product_id: productId || 0, session_id: session }) }).catch(function () {});
  }

  function attachOrderButtons() {
    document.querySelectorAll('[data-wa-order]').forEach(function (node) {
      var holder = node.closest('[data-product]');
      var name = node.getAttribute('data-product') || (holder && holder.getAttribute('data-product')) || '';
      var product = name ? byName[name] || null : null;
      var target = orderUrl(product);
      if (node.tagName === 'A') { node.setAttribute('href', target); node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noreferrer'); }
      else { node.style.cursor = 'pointer'; node.addEventListener('click', function () { window.open(target, '_blank', 'noreferrer'); }); }
      node.addEventListener('click', function () { track('order', product && product.id); }, { passive: true });
    });
  }

  function watchViews() {
    if (!('IntersectionObserver' in window)) return;
    var seen = {};
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var name = entry.target.getAttribute('data-product');
        var product = name && byName[name];
        if (product && !seen[product.id]) { seen[product.id] = true; track('product_view', product.id); }
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.45 });
    document.querySelectorAll('[data-product]').forEach(function (node) { observer.observe(node); });
  }

  function renderGrid() {
    var mount = document.querySelector('[data-product-grid], #stoyangu-products');
    if (!mount) return;
    var style = document.createElement('style');
    style.textContent = '.sty-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:18px 0}.sty-card{border-radius:16px;overflow:hidden;background:rgba(127,127,127,.06);display:flex;flex-direction:column}.sty-card img{width:100%;aspect-ratio:4/4.6;object-fit:cover;display:block;background:rgba(127,127,127,.08)}.sty-body{padding:12px;display:grid;gap:6px}.sty-cat{font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;font-weight:700}.sty-name{font-weight:700;font-size:14px;line-height:1.25}.sty-price{font-weight:800;font-size:13px;opacity:.85}.sty-order{margin-top:6px;background:#111;color:#fff;border-radius:10px;padding:10px 12px;font-weight:800;font-size:12px;text-align:center;text-decoration:none;display:block}';
    document.head.appendChild(style);
    var grid = document.createElement('div');
    grid.className = 'sty-grid';
    products.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'sty-card';
      card.setAttribute('data-product', p.name);
      card.innerHTML = '<img loading="lazy" src="' + (p.image_url || '') + '" alt=""><div class="sty-body"><span class="sty-cat">' + (p.category || '') + '</span><span class="sty-name">' + p.name + '</span><strong class="sty-price">' + money(p.price) + '</strong><a class="sty-order" data-wa-order="1" target="_blank" rel="noreferrer" href="' + orderUrl(p) + '">Order via WhatsApp</a></div>';
      card.querySelector('a').addEventListener('click', function () { track('order', p.id); });
      grid.appendChild(card);
    });
    mount.appendChild(grid);
  }

  function fillNames() {
    document.querySelectorAll('[data-store-name]').forEach(function (n) { n.textContent = store.name; });
    document.querySelectorAll('[data-store-domain]').forEach(function (n) { n.textContent = slug + '.stoyangu.com'; });
    document.querySelectorAll('[data-wa-link]').forEach(function (n) { if (n.tagName === 'A') n.href = 'https://wa.me/' + String(store.whatsapp).replace(/\D/g, ''); });
  }

  fetch('/api/stores?storefront=1&slug=' + encodeURIComponent(slug), { cache: 'no-store' })
    .then(function (res) { if (!res.ok) throw new Error('store unavailable'); return res.json(); })
    .then(function (data) {
      store = data.store || {};
      products = data.products || [];
      products.forEach(function (p) { byName[p.name] = p; });
      fillNames();
      attachOrderButtons();
      renderGrid();
      watchViews();
      track('visit', 0);
    })
    .catch(function () { track('visit', 0); });
})();
