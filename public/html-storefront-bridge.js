/**
 * StoYangu shop:
 *  live products from Manage Store
 *  category chips filter those products
 *  View product → popup (closed on load) → colour / size / delivery / note → WhatsApp
 *  never a cart
 */
(function () {
  var meta = document.querySelector('meta[name="stoyangu-store"], meta[name="stoyangu-slug"]');
  var slug = (meta && (meta.getAttribute('data-slug') || meta.getAttribute('content'))) || '';
  if (!slug) return;

  var session = null;
  try {
    session = sessionStorage.getItem('stoyangu-visit-session');
    if (!session) {
      session = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      sessionStorage.setItem('stoyangu-visit-session', session);
    }
  } catch (e) { session = 'anon'; }

  var store = null;
  var products = [];
  var byId = {};
  var cardTemplate = null;
  var popup = null;
  var lastProduct = null;
  var visited = false;
  var activeImage = '';
  var activeCategory = 'all';
  var popupOpen = false;
  var lastSignature = '';

  function money(v) { return 'KES ' + (Number(v) || 0).toLocaleString('en-KE'); }
  function phoneDigits() { return String((store && store.whatsapp) || (meta && meta.getAttribute('data-whatsapp')) || '').replace(/\D/g, ''); }
  function storeName() { return (store && store.name) || (meta && meta.getAttribute('data-name')) || 'this store'; }
  function photosOf(p) {
    if (!p) return [];
    if (Array.isArray(p.images) && p.images.length) return p.images.filter(Boolean);
    return p.image_url ? [p.image_url] : [];
  }
  function photoOf(p) { return photosOf(p)[0] || ''; }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function norm(s) { return String(s || '').trim().toLowerCase(); }

  function orderUrl(product, extras) {
    var extra = extras || {};
    var text = product
      ? 'Hi ' + storeName() + '! I want to order ' + product.name + ' (' + money(product.price) + ')'
        + (extra.size ? ' in size ' + extra.size : '')
        + (extra.color ? ', colour ' + extra.color : '')
        + '.\nFulfilment: ' + (extra.fulfilment || 'Delivery')
        + (extra.note ? '\nCustomer note: ' + extra.note : '')
        + '\nPlease confirm availability.'
      : 'Hi ' + storeName() + '! I am interested in something from your store.';
    return 'https://wa.me/' + phoneDigits() + '?text=' + encodeURIComponent(text);
  }

  function track(type, productId) {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slug, event_type: type, product_id: productId || 0, session_id: session }),
    }).catch(function () {});
  }

  function hideCart() {
    [
      '#cartBtn', '#cartDrawer', '#cartOverlay', '#cartCount', '#cartFooter',
      '#cartItems', '#cartEmpty', '#checkoutSuccess', '#toast', '.cart-drawer', '.cart-overlay',
    ].forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (node) {
        node.style.setProperty('display', 'none', 'important');
        node.setAttribute('hidden', 'hidden');
      });
    });
  }

  function extrasFromPopup() {
    if (!popup) return {};
    return {
      color: (popup.querySelector('[data-color]') || {}).value || '',
      size: (popup.querySelector('[data-size]') || {}).value || '',
      fulfilment: (popup.querySelector('[data-fulfilment]') || {}).value || 'Delivery',
      note: (popup.querySelector('[data-note]') || {}).value || '',
    };
  }

  function fillSelect(el, items, placeholder) {
    if (!el) return;
    var opts = (items || []).filter(Boolean);
    var wrap = el.closest ? el.closest('label, .sty-field, fieldset') : null;
    if (!opts.length) {
      el.innerHTML = '';
      if (wrap) wrap.style.display = 'none';
      return;
    }
    if (wrap) wrap.style.display = '';
    el.innerHTML = '<option value="">' + (placeholder || 'Choose…') + '</option>' + opts.map(function (item) {
      return '<option value="' + esc(item) + '">' + esc(item) + '</option>';
    }).join('');
  }

  function ensureCss() {
    if (document.getElementById('sty-shop-css')) return;
    var style = document.createElement('style');
    style.id = 'sty-shop-css';
    style.textContent = ''
      + '#cartBtn,#cartDrawer,#cartOverlay,#toast,.cart-drawer,#featuredGrid{display:none!important}'
      + 'html{scroll-padding-top:84px}'
      + '.product-popup:not(.open){display:none!important}'
      + '.product-popup.open{display:flex!important}'
      + '.sty-brand-logo{height:36px;width:auto;max-width:120px;object-fit:contain;display:block}'
      + 'header.sty-sticky-nav,#navbar.sty-sticky-nav,.sty-sticky-nav{position:sticky!important;top:0!important;z-index:60!important}'
      + '#menuBtn,.mobile-menu,#mobileMenu,.sj-menu-trigger{display:none!important}'
      + '.sty-nav{display:flex!important;align-items:center;gap:14px;flex-wrap:nowrap}'
      + '.sty-nav a{white-space:nowrap}'
      + '.sty-empty{padding:28px;text-align:center}';
    document.head.appendChild(style);
  }

  function findDesignedPopup() {
    return document.querySelector('.product-popup, #productModal, .modal-backdrop, [data-product-popup]');
  }

  function ensurePopup() {
    ensureCss();
    popup = findDesignedPopup();
    var designed = Boolean(popup);
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'product-popup';
      popup.innerHTML = '<button type="button" class="sty-close" data-close-popup="1" aria-label="Close">×</button>'
        + '<div class="dialog">'
        + '<img class="popup-image" alt="" data-popup-image />'
        + '<div class="sty-thumbs" data-thumbs></div>'
        + '<div class="content">'
        + '<h3 data-popup-name>Product</h3>'
        + '<p class="popup-price" data-popup-price>KES 0</p>'
        + '<label class="sty-field">Colour <select data-color></select></label>'
        + '<label class="sty-field">Size <select data-size></select></label>'
        + '<label class="sty-field">How would you like to receive it? <select data-fulfilment><option>Delivery</option><option>In-store pickup</option></select></label>'
        + '<label class="sty-field">Delivery or order note <textarea data-note maxlength="300" placeholder="Estate, building, landmark or collection time"></textarea></label>'
        + '<a class="order" data-whatsapp href="#" target="_blank" rel="noopener noreferrer">Order via WhatsApp</a>'
        + '</div></div>';
      document.body.appendChild(popup);
    }
    popup.classList.add('product-popup');
    popup.setAttribute('data-product-popup', '1');
    if (!popup.querySelector('[data-fulfilment]')) {
      var orderBtn = popup.querySelector('[data-whatsapp], a.order');
      var extra = document.createElement('div');
      extra.className = designed ? '' : 'sty-field-wrap';
      extra.innerHTML = '<label>How would you like to receive it?<select data-fulfilment><option>Delivery</option><option>In-store pickup</option></select></label>'
        + '<label>Delivery or order note<textarea data-note maxlength="300" placeholder="Estate, building, landmark or collection time"></textarea></label>';
      if (orderBtn && orderBtn.parentNode) orderBtn.parentNode.insertBefore(extra, orderBtn);
      else popup.appendChild(extra);
    }
    var close = popup.querySelector('[data-close-popup], .sty-close');
    if (!close) {
      close = document.createElement('button');
      close.type = 'button';
      close.className = 'sty-close';
      close.setAttribute('data-close-popup', '1');
      close.setAttribute('aria-label', 'Close');
      close.textContent = '×';
      popup.insertBefore(close, popup.firstChild);
    }
    if (!popupOpen) {
      popup.classList.remove('open');
      popup.style.setProperty('display', 'none', 'important');
    }
    return popup;
  }

  function visibleProducts() {
    if (activeCategory === 'all') return products.slice();
    return products.filter(function (p) { return norm(p.category) === activeCategory; });
  }

  function categoryList() {
    var cats = [];
    var storeCats = store && Array.isArray(store.categories) ? store.categories : [];
    storeCats.concat(products.map(function (p) { return p.category; })).forEach(function (c) {
      var name = String(c || '').trim();
      if (name && cats.indexOf(name) === -1) cats.push(name);
    });
    return cats;
  }

  function paintLogo() {
    var logo = store && store.logo_url;
    if (!logo) return;
    var placed = false;
    document.querySelectorAll('img[data-store-logo], header img, #navbar img, .logo img, .store-logo, .sty-brand-logo').forEach(function (img) {
      if (img.tagName === 'IMG') {
        img.src = logo;
        img.alt = storeName();
        img.classList.add('sty-brand-logo');
        placed = true;
      }
    });
    var brand = document.querySelector('.sty-brand, [data-store-nav] > a, header a, #navbar a');
    if (brand && logo) {
      var existing = brand.querySelector('img');
      if (existing) {
        existing.src = logo;
        existing.alt = storeName();
      } else if (!placed) {
        var img = document.createElement('img');
        img.src = logo;
        img.alt = storeName();
        img.className = 'sty-brand-logo';
        brand.insertBefore(img, brand.firstChild);
      }
    }
  }

  function ensureSection(id, candidates) {
    if (document.getElementById(id)) return document.getElementById(id);
    for (var i = 0; i < candidates.length; i++) {
      var node = document.querySelector(candidates[i]);
      if (node) {
        if (!node.id) node.id = id;
        else if (node.id !== id) {
          var wrap = document.createElement('div');
          wrap.id = id;
          if (node.parentNode) {
            node.parentNode.insertBefore(wrap, node);
            wrap.appendChild(node);
          }
        }
        return document.getElementById(id);
      }
    }
    var created = document.createElement('section');
    created.id = id;
    document.body.appendChild(created);
    return created;
  }

  function paintNav() {
    var header = document.querySelector('header, #navbar, [data-store-nav]');
    if (!header) {
      header = document.createElement('header');
      header.setAttribute('data-store-nav', '1');
      header.innerHTML = '<a class="sty-brand" href="#home">' + esc(storeName()) + '</a>';
      document.body.insertBefore(header, document.body.firstChild);
    }
    header.classList.add('sty-sticky-nav');
    header.style.position = 'sticky';
    header.style.top = '0';
    header.style.zIndex = '60';
    document.querySelectorAll('#menuBtn, .mobile-menu, #mobileMenu, .sj-menu-trigger, .store-menu-button').forEach(function (node) {
      node.style.setProperty('display', 'none', 'important');
    });
    var nav = header.querySelector('nav.sty-nav, [data-app-nav]');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'sty-nav';
      nav.setAttribute('data-app-nav', '1');
      header.appendChild(nav);
    }
    nav.className = ((nav.className || '') + ' sty-nav').replace(/\s+/g, ' ').trim();
    nav.innerHTML = '<a href="#home" data-nav="home">Home</a>'
      + '<a href="#products" data-nav="products">Products</a>'
      + '<a href="#contact" data-nav="contact">Contact</a>';
    ensureSection('home', ['#home', '#top', 'section', 'main']);
    ensureSection('products', ['#products', '#productGrid', '#shop', '[data-product-grid]', '[data-sty-live]']);
    ensureSection('contact', ['#contact', '#visit', 'footer']);
    paintLogo();
  }

  function designedFilterHost() {
    var hosts = [];
    document.querySelectorAll('#filters, [data-category-filters], .sj-product-filters, .store-filters').forEach(function (node) { hosts.push(node); });
    document.querySelectorAll('.filter-chip, [data-filter]').forEach(function (chip) {
      var parent = chip.parentElement;
      if (parent && hosts.indexOf(parent) === -1) hosts.push(parent);
    });
    var best = null;
    var bestScore = -1;
    hosts.forEach(function (host) {
      var chips = host.querySelectorAll('.filter-chip, [data-filter], button');
      var score = chips.length * 2 + (host.id === 'filters' ? 1 : 0) + (host.getAttribute('data-category-filters') ? 3 : 0);
      if (score > bestScore) { best = host; bestScore = score; }
    });
    return best;
  }

  function paintFilters() {
    var cats = categoryList();
    var host = designedFilterHost();
    var chipClass = 'filter-chip';
    if (host) {
      var sample = host.querySelector('.filter-chip, [data-filter], button');
      if (sample) chipClass = sample.className || chipClass;
    }
    document.querySelectorAll('#filters, [data-category-filters], .sj-product-filters, .store-filters').forEach(function (node) {
      if (host && node !== host) node.style.setProperty('display', 'none', 'important');
    });
    document.querySelectorAll('.filter-chip, [data-filter]').forEach(function (chip) {
      var parent = chip.parentElement;
      if (host && parent && parent !== host && !host.contains(parent) && !parent.contains(host)) {
        parent.style.setProperty('display', 'none', 'important');
      }
    });
    if (!host) {
      host = document.createElement('div');
      host.id = 'filters';
      var mount = findMount();
      if (mount && mount.parentNode) mount.parentNode.insertBefore(host, mount);
      else document.body.appendChild(host);
    }
    host.id = host.id || 'filters';
    host.setAttribute('data-category-filters', '1');
    host.style.removeProperty('display');
    if (activeCategory !== 'all' && cats.every(function (c) { return norm(c) !== activeCategory; })) activeCategory = 'all';
    var labels = ['All'].concat(cats);
    host.innerHTML = labels.map(function (label) {
      var key = label === 'All' ? 'all' : norm(label);
      var on = key === activeCategory;
      var cls = chipClass.replace(/\bactive\b/g, '').replace(/\s+/g, ' ').trim() + (on ? ' active' : '');
      return '<button type="button" class="' + esc(cls) + '" data-filter="' + esc(key) + '">' + esc(label) + '</button>';
    }).join('');
  }

  function fillCard(card, product) {
    card.classList.add('product-card');
    card.setAttribute('data-id', String(product.id));
    card.setAttribute('data-name', product.name);
    card.setAttribute('data-category', product.category || '');
    card.setAttribute('data-price', money(product.price));
    card.setAttribute('data-image', photoOf(product));
    card.style.cursor = 'pointer';
    var img = card.querySelector('img');
    if (img) { img.src = photoOf(product); img.alt = product.name; }
    var nameNode = card.querySelector('.product-name, h3');
    if (nameNode && nameNode !== card) nameNode.textContent = product.name;
    var priceNode = card.querySelector('.product-price');
    if (priceNode && priceNode !== card) priceNode.textContent = money(product.price);
    var catNode = card.querySelector('.product-category, .sty-cat');
    if (catNode) catNode.textContent = product.category || '';
    var view = card.querySelector('[data-view-product], .sty-view, .view-product');
    if (!view) {
      view = document.createElement('button');
      view.type = 'button';
      view.className = 'sty-view';
      view.setAttribute('data-view-product', '1');
      view.textContent = 'View product';
      (card.querySelector('.sty-body, .body, .content') || card).appendChild(view);
    } else {
      view.type = 'button';
      view.textContent = 'View product';
      view.setAttribute('data-view-product', '1');
    }
    return card;
  }

  function defaultCard(product) {
    var card = document.createElement('article');
    card.className = 'product-card sty-card';
    card.innerHTML = '<img alt=""><div class="sty-body"><span class="sty-cat"></span><p class="product-name"></p><p class="product-price"></p><button type="button" class="sty-view" data-view-product="1">View product</button></div>';
    return fillCard(card, product);
  }

  function findMount() {
    return document.querySelector('[data-product-grid], #stoyangu-products, #productGrid, #products, #shop');
  }

  function designedCard() {
    if (cardTemplate) return cardTemplate;
    var hold = document.getElementById('stoyangu-card-template');
    if (hold && hold.content && hold.content.querySelector('.product-card')) {
      cardTemplate = hold.content.querySelector('.product-card').cloneNode(true);
      return cardTemplate;
    }
    var existing = document.querySelector('.product-card');
    if (existing) cardTemplate = existing.cloneNode(true);
    return cardTemplate;
  }

  function renderProducts() {
    ensureCss();
    var template = designedCard();
    var host = document.querySelector('#productGrid, [data-product-grid], [data-sty-live="1"]') || findMount();
    if (!host) {
      host = document.createElement('div');
      host.id = 'productGrid';
      host.setAttribute('data-product-grid', '1');
      document.body.appendChild(host);
    }
    host.setAttribute('data-sty-live', '1');
    host.querySelectorAll('.product-card, .sty-empty').forEach(function (node) { node.remove(); });
    document.querySelectorAll('#featuredGrid .product-card').forEach(function (node) { node.remove(); });
    var list = visibleProducts();
    if (!list.length) {
      host.insertAdjacentHTML('beforeend', '<p class="sty-empty">No products in this category yet.</p>');
      return;
    }
    list.forEach(function (product) {
      var card = template ? fillCard(template.cloneNode(true), product) : defaultCard(product);
      card.setAttribute('data-id', String(product.id));
      card.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openProduct(product);
      });
      host.appendChild(card);
    });
  }

  function renderThumbs(product) {
    var thumbs = popup.querySelector('[data-thumbs]');
    var photos = photosOf(product);
    if (!thumbs) {
      thumbs = document.createElement('div');
      thumbs.className = 'sty-thumbs';
      thumbs.setAttribute('data-thumbs', '');
      var img = popup.querySelector('[data-popup-image], .popup-image');
      if (img && img.parentNode) img.parentNode.insertBefore(thumbs, img.nextSibling);
    }
    if (photos.length < 2) { thumbs.innerHTML = ''; return; }
    thumbs.innerHTML = photos.map(function (url) {
      return '<button type="button" data-thumb="' + esc(url) + '" class="' + (url === activeImage ? 'active' : '') + '"><img src="' + esc(url) + '" alt=""></button>';
    }).join('');
  }

  function openProduct(product) {
    if (!product) return;
    lastProduct = product;
    activeImage = photoOf(product);
    track('product_view', product.id);
    ensurePopup();
    var img = popup.querySelector('[data-popup-image], .popup-image');
    var nameEl = popup.querySelector('[data-popup-name]');
    var priceEl = popup.querySelector('[data-popup-price]');
    var noteEl = popup.querySelector('[data-note]');
    if (img) { img.src = activeImage; img.alt = product.name; }
    if (nameEl) nameEl.textContent = product.name;
    if (priceEl) priceEl.textContent = money(product.price);
    fillSelect(popup.querySelector('[data-color]'), product.colors || [], 'Choose colour');
    fillSelect(popup.querySelector('[data-size]'), product.sizes || [], 'Choose size');
    if (noteEl) noteEl.value = '';
    var fulfil = popup.querySelector('[data-fulfilment]');
    if (fulfil) fulfil.value = 'Delivery';
    renderThumbs(product);
    rebuildOrder();
    popupOpen = true;
    popup.classList.add('open');
    popup.removeAttribute('hidden');
    popup.style.setProperty('display', 'flex', 'important');
    popup.style.setProperty('opacity', '1', 'important');
    popup.style.setProperty('visibility', 'visible', 'important');
    popup.style.setProperty('pointer-events', 'auto', 'important');
    popup.style.setProperty('z-index', '90', 'important');
    var panel = popup.querySelector('.dialog, .modal-panel, .content');
    if (panel) {
      panel.style.setProperty('opacity', '1', 'important');
      panel.style.setProperty('transform', 'none', 'important');
    }
    document.body.style.overflow = 'hidden';
  }

  function closePopup() {
    popupOpen = false;
    document.body.style.overflow = '';
    if (!popup) return;
    popup.classList.remove('open');
    popup.style.setProperty('display', 'none', 'important');
  }

  function rebuildOrder() {
    if (!popup || !lastProduct) return;
    var btn = popup.querySelector('[data-whatsapp], a.order');
    if (!btn) return;
    btn.setAttribute('href', orderUrl(lastProduct, extrasFromPopup()));
    btn.setAttribute('target', '_blank');
    btn.setAttribute('rel', 'noopener noreferrer');
  }

  function productFromEvent(target) {
    var card = target.closest && target.closest('.product-card, [data-id]');
    if (!card) return null;
    return byId[String(card.getAttribute('data-id') || '')] || null;
  }

  function bindUi() {
    if (document.documentElement.getAttribute('data-sty-bound') === '1') return;
    document.documentElement.setAttribute('data-sty-bound', '1');
    document.addEventListener('click', function (event) {
      var t = event.target;
      if (!t || !t.closest) return;
      var thumb = t.closest('[data-thumb]');
      if (thumb && popup && popup.contains(thumb)) {
        activeImage = thumb.getAttribute('data-thumb');
        var img = popup.querySelector('[data-popup-image], .popup-image');
        if (img) img.src = activeImage;
        popup.querySelectorAll('[data-thumb]').forEach(function (btn) {
          btn.classList.toggle('active', btn.getAttribute('data-thumb') === activeImage);
        });
        event.preventDefault();
        return;
      }
      if (t.closest('[data-close-popup], .sty-close')) {
        event.preventDefault();
        closePopup();
        return;
      }
      if (popup && popupOpen && t === popup) {
        closePopup();
        return;
      }
      var navLink = t.closest('a[data-nav], nav.sty-nav a, [data-app-nav] a');
      if (navLink) {
        var href = navLink.getAttribute('href') || '';
        var id = href.charAt(0) === '#' ? href.slice(1) : navLink.getAttribute('data-nav');
        var target = id && document.getElementById(id);
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          closePopup();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          try { history.replaceState(null, '', '#' + id); } catch (err) {}
        }
        return;
      }
      var chip = t.closest('[data-filter], .filter-chip, .sty-filter');
      if (chip && !(popup && popup.contains(chip))) {
        var next = chip.getAttribute('data-filter') || chip.textContent;
        activeCategory = norm(next) === 'all' || !String(next).trim() ? 'all' : norm(next);
        paintFilters();
        renderProducts();
        event.preventDefault();
        return;
      }
      var view = t.closest('[data-view-product], .sty-view, .view-product, .product-card');
      if (view && !(popup && popup.contains(view))) {
        var product = productFromEvent(view);
        if (product) {
          event.preventDefault();
          event.stopPropagation();
          openProduct(product);
        }
        return;
      }
    }, true);
    document.addEventListener('change', function (event) {
      if (popup && popup.contains(event.target)) rebuildOrder();
    });
    document.addEventListener('input', function (event) {
      if (popup && popup.contains(event.target)) rebuildOrder();
    });
    document.addEventListener('click', function (event) {
      var order = event.target.closest && event.target.closest('[data-whatsapp]');
      if (order && lastProduct) track('order', lastProduct.id);
    }, true);
    document.addEventListener('keyup', function (event) {
      if (event.key === 'Escape') closePopup();
    });
  }

  function readEmbeddedCatalog() {
    var node = document.getElementById('stoyangu-catalog');
    if (!node) return [];
    try { return JSON.parse(node.textContent || node.innerHTML || '[]'); } catch (e) { return []; }
  }

  function signatureOf(list) {
    return (list || []).map(function (p) {
      return [p.id, p.name, p.price, p.category, photoOf(p), (p.colors || []).join(','), (p.sizes || []).join(',')].join('|');
    }).join(';;');
  }

  function applyStore(data, force) {
    store = data.store || store || {};
    var next = Array.isArray(data.products) ? data.products : products;
    var sig = signatureOf(next);
    products = next;
    byId = {};
    products.forEach(function (p) { byId[String(p.id)] = p; });
    hideCart();
    ensurePopup();
    if (!popupOpen) closePopup();
    paintNav();
    if (force || sig !== lastSignature) {
      lastSignature = sig;
      paintFilters();
      renderProducts();
    }
    bindUi();
    if (!visited) { track('visit', 0); visited = true; }
  }

  function load() {
    fetch('/api/stores?storefront=1&slug=' + encodeURIComponent(slug), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('unavailable'); return res.json(); })
      .then(function (data) { applyStore(data, false); })
      .catch(function () {
        applyStore({ store: store || {}, products: products.length ? products : readEmbeddedCatalog() }, false);
      });
  }

  hideCart();
  applyStore({ store: {}, products: readEmbeddedCatalog() }, true);
  load();
  setInterval(load, 20000);
})();
