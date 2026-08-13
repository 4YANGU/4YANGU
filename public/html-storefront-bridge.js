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

  function rawPrice(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var digits = String(v == null ? '' : v).replace(/[^\d.]/g, '');
    var num = Number(digits);
    return isFinite(num) ? num : 0;
  }
  function money(v) { return 'KSh ' + rawPrice(v).toLocaleString('en-KE'); }
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

  function chosenOption(kind) {
    if (!popup) return '';
    var on = popup.querySelector('[data-sty-option="' + kind + '"].active, [data-sty-option="' + kind + '"][aria-pressed="true"]');
    if (on) return on.getAttribute('data-value') || on.textContent.trim();
    var select = popup.querySelector(kind === 'color' ? '[data-color], select[name*="color"], select[name*="colour"]' : kind === 'size' ? '[data-size], select[name*="size"]' : '[data-fulfilment], select[name*="fulfil"], select[name*="deliver"]');
    return select ? String(select.value || '').trim() : '';
  }

  function extrasFromPopup() {
    if (!popup) return {};
    var note = popup.querySelector('[data-note], textarea');
    return {
      color: chosenOption('color'),
      size: chosenOption('size'),
      fulfilment: chosenOption('fulfilment') || 'Delivery',
      note: note ? note.value : '',
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

  function findChoiceHost(kind) {
    var attr = kind === 'color'
      ? '[data-color-options], [data-colors], [data-colour-options]'
      : kind === 'size'
        ? '[data-size-options], [data-sizes]'
        : '[data-fulfilment-options], [data-fulfilment]';
    var direct = popup.querySelector(attr);
    if (direct && direct.tagName !== 'SELECT' && direct.tagName !== 'OPTION') {
      return direct.tagName === 'BUTTON' ? direct.parentElement : direct;
    }
    var words = kind === 'color' ? /^(colour|color)$/i : kind === 'size' ? /^size/i : /how should we get it|fulfil|pickup|pick up|delivery/i;
    var nodes = popup.querySelectorAll('p, span, label, legend, h4, h5, div, small');
    for (var i = 0; i < nodes.length; i++) {
      var text = String(nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (!words.test(text) || text.length > 40) continue;
      var parent = nodes[i].parentElement;
      if (parent && parent.querySelector('button, [role="button"]')) return parent;
      var next = nodes[i].nextElementSibling;
      if (next && next.querySelector && next.querySelector('button, [role="button"]')) return next;
    }
    return null;
  }

  function paintChoices(kind, items) {
    var host = findChoiceHost(kind);
    var opts = (items || []).filter(Boolean);
    if (!host) {
      if (kind === 'fulfilment') return;
      var select = popup.querySelector(kind === 'color' ? '[data-color], select[name*="color"]' : '[data-size], select[name*="size"]');
      fillSelect(select, opts, kind === 'color' ? 'Choose colour' : 'Choose size');
      return;
    }
    var sample = host.querySelector('button, [role="button"], .size-pill, .sty-pill');
    var cls = sample ? String(sample.className || '').replace(/\bactive\b/g, '').replace(/\s+/g, ' ').trim() : 'sty-pill';
    host.querySelectorAll('button, [role="button"], .size-pill').forEach(function (btn) {
      if (!/choose one|choose/i.test(String(btn.textContent || '').trim())) btn.remove();
    });
    if (!opts.length) return;
    opts.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = cls;
      btn.setAttribute('data-sty-option', kind);
      btn.setAttribute('data-value', item);
      btn.textContent = item;
      host.appendChild(btn);
    });
    if (kind === 'fulfilment' && opts.length && !chosenOption('fulfilment')) {
      var first = host.querySelector('[data-sty-option="fulfilment"]');
      if (first) first.classList.add('active');
    }
  }

  function ensureCss() {
    if (document.getElementById('sty-shop-css')) return;
    var style = document.createElement('style');
    style.id = 'sty-shop-css';
    style.textContent = ''
      + '#cartBtn,#cartDrawer,#cartOverlay,#toast,.cart-drawer,#featuredGrid{display:none!important}'
      + 'html{scroll-padding-top:84px}'
      + '.product-popup:not(.open),#productModal:not(.open),.modal-backdrop:not(.open){display:none!important}'
      + '.product-popup.open,#productModal.open,.modal-backdrop.open{display:flex!important;align-items:flex-start!important;justify-content:center!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch;inset:0!important;padding:64px 12px 28px!important;box-sizing:border-box}'
      + '.product-popup.open .dialog,.product-popup.open .modal-panel,#productModal.open .dialog,#productModal.open .modal-panel{width:min(560px,100%)!important;max-height:none!important;margin:0 auto 24px!important;transform:none!important}'
      + '.sty-close,[data-close-popup],#closeModal{position:fixed!important;top:max(10px,env(safe-area-inset-top))!important;right:max(10px,env(safe-area-inset-right))!important;z-index:98!important}'
      + '.sty-close--duplicate{display:none!important}'
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
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'product-popup';
      popup.innerHTML = '<button type="button" class="sty-close" data-close-popup="1" aria-label="Close">×</button>'
        + '<div class="dialog">'
        + '<img class="popup-image" alt="" data-popup-image />'
        + '<div class="sty-thumbs" data-thumbs></div>'
        + '<div class="content">'
        + '<h3 data-popup-name>Product</h3>'
        + '<p class="popup-price" data-popup-price></p>'
        + '<div data-color-options></div>'
        + '<div data-size-options></div>'
        + '<div data-fulfilment-options></div>'
        + '<textarea data-note maxlength="300" placeholder="Any colour preference, delivery area, or question?"></textarea>'
        + '<a class="order" data-whatsapp href="#" target="_blank" rel="noopener noreferrer">Order via WhatsApp</a>'
        + '</div></div>';
      document.body.appendChild(popup);
    }
    popup.classList.add('product-popup');
    popup.setAttribute('data-product-popup', '1');
    popup.querySelectorAll('.sty-field-wrap, [data-sty-extra-fulfil]').forEach(function (node) { node.remove(); });
    var extras = [];
    popup.querySelectorAll('label, p, div').forEach(function (node) {
      var text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^How would you like to receive it\??/i.test(text) || /^Delivery or order note/i.test(text)) extras.push(node);
    });
    extras.forEach(function (node) {
      if (node.querySelector && (node.querySelector('[data-fulfilment]') || node.querySelector('[data-note]'))) node.remove();
    });
    var designedClose = popup.querySelector('#closeModal');
    popup.querySelectorAll('.sty-close, [data-close-popup]').forEach(function (btn) {
      if (designedClose && btn !== designedClose) {
        btn.classList.add('sty-close--duplicate');
        btn.style.setProperty('display', 'none', 'important');
      } else {
        btn.setAttribute('data-close-popup', '1');
      }
    });
    if (designedClose) designedClose.setAttribute('data-close-popup', '1');
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
    card.setAttribute('data-price-value', String(rawPrice(product.price)));
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

  function firstMatch(root, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var node = root.querySelector(selectors[i]);
      if (node) return node;
    }
    return null;
  }

  function setText(root, selectors, value) {
    var node = firstMatch(root, selectors);
    if (node) {
      node.textContent = value;
      return node;
    }
    return null;
  }

  function setAllText(root, selectors, value) {
    selectors.forEach(function (sel) {
      root.querySelectorAll(sel).forEach(function (node) {
        if (node.closest && node.closest('.product-card')) return;
        node.textContent = value;
        if (node.setAttribute) {
          node.setAttribute('data-price', value);
          node.setAttribute('data-popup-price', value);
        }
      });
    });
  }

  function fillPopupContent(product) {
    var photos = photosOf(product);
    activeImage = photos[0] || '';
    var img = firstMatch(popup, ['[data-popup-image]', '.popup-image', '.dialog img', '.modal-panel img', '#modalContent img', 'img']);
    if (img && img.closest && img.closest('[data-thumbs], .sty-thumbs, header')) img = firstMatch(popup, ['[data-popup-image]', '.popup-image']);
    if (img) {
      img.src = activeImage;
      img.alt = product.name;
    }
    popup.querySelectorAll('img').forEach(function (node) {
      if (node.closest('[data-thumbs], .sty-thumbs, header, .sty-brand, nav')) return;
      if (node === img || node.classList.contains('popup-image') || node.hasAttribute('data-popup-image')) {
        node.src = activeImage;
        node.alt = product.name;
      }
    });
    setAllText(popup, ['[data-popup-name]', '#modalContent h2', '#modalContent h3', '.dialog h2', '.dialog h3', '.modal-panel h2', '.modal-panel h3'], product.name);
    var shownPrice = money(product.price != null ? product.price : product.unit_price);
    setAllText(popup, ['[data-popup-price]', '.popup-price', '.product-price', '.sj-modal-price'], shownPrice);
    popup.querySelectorAll('p, span, strong, b, h4, div').forEach(function (node) {
      if (node.children && node.children.length > 2) return;
      var text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(KES|KSh|Ksh|ksh)\s*0(\.00)?$/.test(text) || node.hasAttribute('data-popup-price') || /\bpopup-price\b|\bproduct-price\b|\bprice\b/i.test(node.className || '')) {
        if (node.children.length === 0 || /0/.test(text)) node.textContent = shownPrice;
      }
    });
    paintChoices('color', product.colors || []);
    paintChoices('size', product.sizes || []);
    var fulfilHost = findChoiceHost('fulfilment');
    if (fulfilHost) {
      var existing = [];
      fulfilHost.querySelectorAll('button, [role="button"]').forEach(function (btn) {
        var label = String(btn.textContent || '').replace(/\s+/g, ' ').trim();
        if (label && !/choose/i.test(label)) existing.push(label);
      });
      if (existing.length) paintChoices('fulfilment', existing);
    }
    var noteEl = firstMatch(popup, ['[data-note]', 'textarea']);
    if (noteEl) noteEl.value = '';
    renderThumbs(product);
    rebuildOrder();
  }

  function openProduct(product) {
    if (!product) return;
    lastProduct = product;
    activeImage = photoOf(product);
    track('product_view', product.id);
    ensurePopup();
    fillPopupContent(product);
    popupOpen = true;
    popup.classList.add('open');
    popup.removeAttribute('hidden');
    popup.style.setProperty('display', 'flex', 'important');
    popup.style.setProperty('opacity', '1', 'important');
    popup.style.setProperty('visibility', 'visible', 'important');
    popup.style.setProperty('pointer-events', 'auto', 'important');
    popup.style.setProperty('z-index', '90', 'important');
    var panel = popup.querySelector('.dialog, .modal-panel, #modalContent');
    if (panel) {
      panel.style.setProperty('opacity', '1', 'important');
      panel.style.setProperty('transform', 'none', 'important');
      panel.style.setProperty('visibility', 'visible', 'important');
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
    var found = byId[String(card.getAttribute('data-id') || '')];
    if (found && rawPrice(found.price) > 0) return found;
    if (found) {
      var fallback = rawPrice(card.getAttribute('data-price-value') || card.getAttribute('data-price'));
      if (fallback) found.price = fallback;
      return found;
    }
    return null;
  }

  function bindUi() {
    if (document.documentElement.getAttribute('data-sty-bound') === '1') return;
    document.documentElement.setAttribute('data-sty-bound', '1');
    document.addEventListener('click', function (event) {
      var t = event.target;
      if (!t || !t.closest) return;
      var choice = t.closest('[data-sty-option]');
      if (choice && popup && popup.contains(choice)) {
        var kind = choice.getAttribute('data-sty-option');
        popup.querySelectorAll('[data-sty-option="' + kind + '"]').forEach(function (btn) {
          btn.classList.toggle('active', btn === choice);
          btn.setAttribute('aria-pressed', btn === choice ? 'true' : 'false');
        });
        rebuildOrder();
        event.preventDefault();
        event.stopPropagation();
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
      if (t.closest('[data-close-popup], .sty-close, #closeModal, [aria-label="Close"], [aria-label="close"]')) {
        event.preventDefault();
        event.stopPropagation();
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
