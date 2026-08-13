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

  function paintPills(kind, items) {
    if (!popup) return;
    var select = popup.querySelector('[data-' + kind + ']');
    if (!select) return;
    fillSelect(select, items, kind === 'color' ? 'Choose colour' : 'Choose size');
    var host = select.parentNode || popup;
    var pills = host.querySelector('.sty-pills[data-pills="' + kind + '"]');
    if (!pills) {
      pills = document.createElement('div');
      pills.className = 'sty-pills';
      pills.setAttribute('data-pills', kind);
      host.appendChild(pills);
    }
    if (!items || !items.length) { pills.innerHTML = ''; return; }
    pills.innerHTML = items.map(function (item) {
      return '<button type="button" class="sty-pill" data-pill="' + kind + '" data-value="' + esc(item) + '">' + esc(item) + '</button>';
    }).join('');
  }

  function ensureCss() {
    if (document.getElementById('sty-shop-css')) return;
    var style = document.createElement('style');
    style.id = 'sty-shop-css';
    style.textContent = ''
      + '#cartBtn,#cartDrawer,#cartOverlay,#toast,.cart-drawer{display:none!important}'
      + 'html{scroll-padding-top:84px}'
      + '.sty-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:18px 0 28px;align-items:stretch}'
      + '@media(min-width:720px){.sty-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}}'
      + '@media(min-width:1100px){.sty-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}}'
      + '.sty-grid .product-card,.sty-card{display:flex;flex-direction:column;height:100%;min-width:0;border-radius:18px;overflow:hidden;border:1px solid rgba(127,127,127,.16);background:rgba(255,255,255,.04);box-shadow:0 10px 28px rgba(0,0,0,.06)}'
      + '.sty-grid .product-card>img,.sty-card>img,.sty-grid .product-card .sty-photo{width:100%;aspect-ratio:4/5;object-fit:cover;display:block;background:rgba(0,0,0,.06)}'
      + '.sty-body{padding:12px 12px 14px;display:flex;flex-direction:column;gap:5px;flex:1}'
      + '.sty-cat,.product-category{font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.6;font-weight:700}'
      + '.product-name{margin:0;font-weight:700;font-size:14px;line-height:1.3}'
      + '.product-price{margin:0;font-weight:800;font-size:13px}'
      + '.sty-view,[data-view-product]{margin-top:auto;background:currentColor;color:#fff;mix-blend-mode:multiply;border:0;border-radius:10px;padding:10px 12px;font-weight:800;font-size:12px;cursor:pointer;width:100%;background:#171717;color:#fff}'
      + '.sty-empty{grid-column:1/-1;padding:28px;text-align:center;opacity:.7}'
      + '.product-popup{position:fixed;inset:0;z-index:90;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(10,10,10,.62);backdrop-filter:blur(8px)}'
      + '.product-popup.open{display:flex!important}'
      + '.product-popup .dialog{width:min(860px,100%);max-height:88vh;overflow:auto;display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:0;border-radius:22px}'
      + '.product-popup .popup-image,[data-popup-image]{width:100%;max-height:min(420px,46vh);height:auto;aspect-ratio:4/5;object-fit:cover;display:block}'
      + '.product-popup .content{padding:22px 24px 26px;display:grid;gap:11px;align-content:start}'
      + '.sty-close{position:fixed;top:14px;right:14px;z-index:97;border:0;width:42px;height:42px;border-radius:50%;background:#fff;color:#111;font-size:22px;line-height:42px;padding:0;cursor:pointer;box-shadow:0 10px 24px rgba(0,0,0,.28)}'
      + '.sty-thumbs{display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px 0}'
      + '.sty-thumbs button{width:52px;height:52px;padding:0;border:2px solid transparent;border-radius:8px;overflow:hidden;background:none}'
      + '.sty-thumbs button.active{border-color:#25D366}'
      + '.sty-thumbs img{width:100%;height:100%;object-fit:cover;display:block}'
      + '.sty-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}'
      + '.sty-pill{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer}'
      + '.sty-pill.active{background:#171717;color:#fff;border-color:#171717}'
      + '.product-popup select[data-color],.product-popup select[data-size]{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}'
      + '.sty-brand-logo{height:36px;width:auto;max-width:120px;object-fit:contain;display:block}'
      + '.filter-chip,.sty-filter{cursor:pointer}'
      + 'header.sty-sticky-nav,#navbar.sty-sticky-nav,.sty-sticky-nav{position:sticky!important;top:0!important;z-index:60!important}'
      + '#menuBtn,.mobile-menu,#mobileMenu,.sj-menu-trigger{display:none!important}'
      + '.sty-nav{display:flex!important;align-items:center;gap:14px;flex-wrap:nowrap}'
      + '.sty-nav a{white-space:nowrap;text-decoration:none;font-size:13px;font-weight:700}'
      + '.sty-filters{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 8px}'
      + '.sty-filters .sty-filter{border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;border-radius:999px;padding:8px 14px;font-size:12px;font-weight:700}'
      + '.sty-filters .sty-filter.active{background:#171717;color:#fff;border-color:#171717}'
      + '@media(max-width:760px){.product-popup .dialog{grid-template-columns:1fr;max-height:92vh}.product-popup .popup-image,[data-popup-image]{max-height:220px;aspect-ratio:16/11}.sty-nav{gap:10px}.sty-nav a{font-size:12px}}';
    document.head.appendChild(style);
  }

  function ensurePopup() {
    ensureCss();
    popup = document.querySelector('.product-popup');
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
    if (!popup.querySelector('[data-fulfilment]')) {
      var orderBtn = popup.querySelector('[data-whatsapp], a.order');
      var extra = document.createElement('div');
      extra.className = designed ? '' : 'sty-field-wrap';
      extra.innerHTML = '<label>How would you like to receive it?<select data-fulfilment><option>Delivery</option><option>In-store pickup</option></select></label>'
        + '<label>Delivery or order note<textarea data-note maxlength="300" placeholder="Estate, building, landmark or collection time"></textarea></label>';
      if (orderBtn && orderBtn.parentNode) orderBtn.parentNode.insertBefore(extra, orderBtn);
      else popup.appendChild(extra);
    }
    var close = popup.querySelector('.sty-close, [data-close-popup]');
    if (!close) {
      close = document.createElement('button');
      close.type = 'button';
      close.className = 'sty-close';
      close.setAttribute('data-close-popup', '1');
      close.setAttribute('aria-label', 'Close');
      close.textContent = '×';
      popup.insertBefore(close, popup.firstChild);
    } else if (close.parentNode !== popup) {
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

  function paintFilters() {
    var host = document.querySelector('#filters, [data-category-filters]');
    var cats = categoryList();
    if (!host) {
      host = document.createElement('div');
      host.id = 'filters';
      var mount = findMount();
      if (mount && mount.parentNode) mount.parentNode.insertBefore(host, mount);
      else document.body.appendChild(host);
    }
    host.classList.add('sty-filters');
    host.setAttribute('data-category-filters', '1');
    if (activeCategory !== 'all' && cats.every(function (c) { return norm(c) !== activeCategory; })) activeCategory = 'all';
    var labels = ['All'].concat(cats);
    host.innerHTML = labels.map(function (label) {
      var key = label === 'All' ? 'all' : norm(label);
      var on = key === activeCategory ? ' active' : '';
      return '<button type="button" class="filter-chip sty-filter' + on + '" data-filter="' + esc(key) + '">' + esc(label) + '</button>';
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

  function renderProducts() {
    ensureCss();
    var existing = document.querySelector('.product-card');
    if (existing && !cardTemplate) cardTemplate = existing.cloneNode(true);
    document.querySelectorAll('.product-card').forEach(function (node) {
      if (!node.closest('[data-sty-live="1"]')) node.remove();
    });
    document.querySelectorAll('#featuredGrid .product-card, [data-sample-product]').forEach(function (node) { node.remove(); });
    var host = document.querySelector('[data-sty-live="1"]') || findMount();
    if (!host) {
      host = document.createElement('section');
      host.id = 'stoyangu-products';
      document.body.appendChild(host);
    }
    var wrap = host.matches && host.matches('[data-sty-live="1"]') ? host : host.querySelector('[data-sty-live="1"]');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.setAttribute('data-sty-live', '1');
      wrap.setAttribute('data-product-grid', '1');
      host.appendChild(wrap);
    }
    wrap.className = (wrap.className || '').replace(/\bsty-grid\b/g, '').trim() + ' sty-grid';
    wrap.innerHTML = '';
    var list = visibleProducts();
    if (!list.length) {
      wrap.innerHTML = '<p class="sty-empty">No products in this category yet.</p>';
      return;
    }
    list.forEach(function (product) {
      wrap.appendChild(cardTemplate ? fillCard(cardTemplate.cloneNode(true), product) : defaultCard(product));
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
    paintPills('color', product.colors || []);
    paintPills('size', product.sizes || []);
    if (noteEl) noteEl.value = '';
    var fulfil = popup.querySelector('[data-fulfilment]');
    if (fulfil) fulfil.value = 'Delivery';
    renderThumbs(product);
    rebuildOrder();
    popupOpen = true;
    popup.classList.add('open');
    popup.style.setProperty('display', 'flex', 'important');
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
      var pill = t.closest('[data-pill]');
      if (pill && popup && popup.contains(pill)) {
        var kind = pill.getAttribute('data-pill');
        var value = pill.getAttribute('data-value') || '';
        var select = popup.querySelector('[data-' + kind + ']');
        if (select) select.value = value;
        popup.querySelectorAll('[data-pill="' + kind + '"]').forEach(function (btn) {
          btn.classList.toggle('active', btn.getAttribute('data-value') === value);
        });
        rebuildOrder();
        event.preventDefault();
        return;
      }
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
