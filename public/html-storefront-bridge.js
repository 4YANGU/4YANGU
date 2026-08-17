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
  var phoneStep = null;
  var lastProduct = null;
  var visited = false;
  var activeImage = '';
  var activeCategory = 'all';
  var popupOpen = false;
  var lastSignature = '';
  var cachedCustomerPhone = '';
  var pendingOrderRequests = {};

  function requestSavedPhone() { try { window.parent.postMessage({ type: 'stoyangu-phone-get' }, '*'); } catch (e) {} }
  function readSavedPhone() { try { return localStorage.getItem('stoyangu-customer-phone') || cachedCustomerPhone || ''; } catch (e) { return cachedCustomerPhone || ''; } }
  function rememberPhone(value) { cachedCustomerPhone = value; try { localStorage.setItem('stoyangu-customer-phone', value); } catch (e) {} try { window.parent.postMessage({ type: 'stoyangu-phone-set', value: value }, '*'); } catch (e) {} }
  function submitOrderToParent(order) { return new Promise(function (resolve) { var requestId = 'order-' + Date.now() + '-' + Math.random().toString(36).slice(2); pendingOrderRequests[requestId] = resolve; window.parent.postMessage({ type: 'stoyangu-order-submit', requestId: requestId, order: order }, '*'); window.setTimeout(function () { if (pendingOrderRequests[requestId]) { delete pendingOrderRequests[requestId]; resolve({ ok: false, error: 'Order confirmation timed out.' }); } }, 15000); }); }
  window.addEventListener('message', function (event) { if (event.source !== window.parent || !event.data) return; if (event.data.type === 'stoyangu-phone-value') cachedCustomerPhone = String(event.data.value || ''); if (event.data.type === 'stoyangu-order-result' && pendingOrderRequests[event.data.requestId]) { pendingOrderRequests[event.data.requestId](event.data); delete pendingOrderRequests[event.data.requestId]; } });
  requestSavedPhone();

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
  function colourValue(value) { var known = { black:'#111827', white:'#ffffff', navy:'#172554', green:'#4d7c5b', red:'#dc2626', blue:'#2563eb', pink:'#ec4899', brown:'#795548', beige:'#d6c6a5', gold:'#d4a94c', cream:'#f5edda', sage:'#9caf88', mocha:'#8b6f61', olive:'#6b7245', terracotta:'#c66b4e', sky:'#87ceeb', peach:'#f4a58a', grey:'#6b7280', gray:'#6b7280' }; var key = norm(value); if (/^#|^rgb|^hsl/i.test(key)) return key; return known[key] || 'hsl(' + ([...key].reduce(function (sum, char) { return sum + char.charCodeAt(0); }, 0) % 360) + ' 38% 52%)'; }

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
    try { window.parent.postMessage({ type: 'stoyangu-track', event_type: type, product_id: productId || 0, session_id: session }, '*'); } catch (e) {}
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

  function removeGeneralWhatsAppLinks() {
    document.querySelectorAll('a[href*="wa.me"],a[href*="api.whatsapp.com"],a[data-wa-link]').forEach(function (link) {
      if (link.closest && link.closest('[data-stoyangu-order-popup="1"]')) return;
      var replacement = document.createElement('span');
      replacement.className = link.className || '';
      replacement.innerHTML = link.innerHTML;
      replacement.setAttribute('data-whatsapp-text-only', '1');
      link.replaceWith(replacement);
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
    var note = popup.querySelector('[data-note]') || popup.querySelector('textarea:not([data-delivery-address])');
    var address = popup.querySelector('[data-delivery-address]');
    var customerPhone = popup.querySelector('[data-customer-phone]');
    var noteText = note ? note.value : '';
    var addressText = address ? address.value : '';
    return {
      color: chosenOption('color'),
      size: chosenOption('size'),
      fulfilment: chosenOption('fulfilment') || 'Walk in Store',
      note: [addressText ? 'Delivery address: ' + addressText : '', noteText].filter(Boolean).join('\n'),
      customerPhone: customerPhone ? customerPhone.value.trim() : '',
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
      if (kind === 'color') { btn.style.background = colourValue(item); btn.setAttribute('aria-label', 'Choose ' + item); btn.title = item; }
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
      + '.product-popup.open,#productModal.open,.modal-backdrop.open{display:flex!important;align-items:center!important;justify-content:center!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch;inset:0!important;padding:22px 14px!important;box-sizing:border-box;background:rgba(5,15,25,.62)}'
      + '.product-popup.open .dialog,.product-popup.open .modal-panel,#productModal.open .dialog,#productModal.open .modal-panel{position:relative!important;width:min(560px,100%)!important;max-height:calc(100vh - 44px)!important;margin:auto!important;transform:none!important;overflow-y:auto!important;overscroll-behavior:contain}'
      + '.sty-close,[data-close-popup],#closeModal{position:absolute!important;top:12px!important;right:12px!important;z-index:40!important;width:40px!important;height:40px!important;border:0!important;border-radius:50%!important;background:#fff!important;color:#17261f!important;font-size:22px!important;line-height:1!important;display:grid!important;place-items:center!important;cursor:pointer!important;box-shadow:0 8px 25px rgba(0,0,0,.22)!important}'
      + '.sty-close--duplicate{display:none!important}'
      + '.sty-brand-logo{height:36px;width:auto;max-width:120px;object-fit:contain;display:block}'
      + 'header.sty-sticky-nav,#navbar.sty-sticky-nav,.sty-sticky-nav{position:sticky!important;top:0!important;z-index:60!important}'
      + '#menuBtn,.mobile-menu,#mobileMenu,.sj-menu-trigger{display:none!important}'
      + '.sty-nav{display:flex!important;align-items:center;gap:14px;flex-wrap:nowrap}'
      + '.sty-nav a{white-space:nowrap}'
      + '.sty-phone-field{display:grid;gap:6px;margin:12px 0;font:700 11px/1.4 system-ui}.sty-phone-field input{width:100%;box-sizing:border-box;min-height:44px;border:1px solid rgba(100,110,105,.3);border-radius:11px;padding:0 12px;background:#fff;color:#17261f;font:600 13px system-ui}.sty-phone-field input:focus{outline:2px solid #5a966e;outline-offset:1px}.sty-phone-field small{font-size:9px;font-weight:500;opacity:.7}.sty-phone-field.has-error input{border-color:#c84d45}.sty-phone-field.has-error small{color:#b13e37;opacity:1}'
      + '.sty-phone-step{position:fixed;inset:0;z-index:240;background:rgba(5,15,25,.74);backdrop-filter:blur(10px);display:none;place-items:center;padding:18px}.sty-phone-step.open{display:grid}.sty-phone-card{position:relative;width:min(430px,100%);box-sizing:border-box;padding:28px;border-radius:24px;background:#fff;color:#17261f;box-shadow:0 35px 100px rgba(0,0,0,.34);font-family:system-ui}.sty-phone-card h3{margin:0 0 7px;font-size:24px;letter-spacing:-.04em}.sty-phone-card>p{margin:0 0 18px;color:#6d7b73;font-size:12px;line-height:1.5}.sty-phone-close{position:absolute;right:13px;top:13px;width:34px;height:34px;border:1px solid #dce3df;border-radius:50%;background:#fff}.sty-phone-confirm{width:100%;min-height:49px;border:0;border-radius:13px;background:#1fa75a;color:#fff;font-size:12px;font-weight:900}.sty-phone-kicker{display:block;margin-bottom:7px;color:#5a966e;font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}'
      + '.sty-delivery-address{display:grid;gap:5px;margin-top:10px;font:800 10px/1.4 system-ui}.sty-delivery-address textarea,[data-note]{width:100%;box-sizing:border-box;min-height:64px;margin-top:6px;border:1px solid rgba(100,110,105,.3);border-radius:11px;padding:10px;background:#fff;color:#17261f;font:500 12px/1.45 system-ui;resize:vertical}'
      + '[data-stoyangu-order-popup="1"]{font-family:system-ui;color:#17261f}[data-stoyangu-order-popup="1"] .dialog{width:min(920px,100%)!important;display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.9fr);overflow:hidden;border-radius:24px;background:#fff;box-shadow:0 35px 100px rgba(0,0,0,.35)}[data-stoyangu-order-popup="1"] .popup-image{width:100%;height:100%;min-height:320px;max-height:640px;object-fit:cover;background:#eef1ed}[data-stoyangu-order-popup="1"] .content{padding:34px;display:flex;flex-direction:column}[data-stoyangu-order-popup="1"] h3{margin:0;font-size:30px;letter-spacing:-.045em}[data-stoyangu-order-popup="1"] .popup-price{margin:8px 0 18px;color:#2f7147;font-size:17px;font-weight:900}[data-stoyangu-order-popup="1"] [data-color-options],[data-stoyangu-order-popup="1"] [data-size-options],[data-stoyangu-order-popup="1"] [data-fulfilment-options]{display:flex;gap:7px;flex-wrap:wrap;margin:7px 0}[data-stoyangu-order-popup="1"] .sty-pill{min-height:38px;border:1px solid #dce3df;border-radius:999px;background:#fff;color:#17261f;padding:0 12px;font-size:10px;font-weight:900}[data-stoyangu-order-popup="1"] .sty-pill.active{background:#17261f;color:#fff;border-color:#17261f}[data-stoyangu-order-popup="1"] [data-sty-option="color"]{width:32px;min-width:32px;padding:0;border:3px solid #fff;box-shadow:0 0 0 1px #dce3df;font-size:0}[data-stoyangu-order-popup="1"] .order{display:flex;align-items:center;justify-content:center;min-height:50px;margin-top:13px;border-radius:13px;background:#19A45B!important;color:#fff!important;text-decoration:none;font-size:12px;font-weight:900}[data-stoyangu-order-popup="1"] .sty-media{display:flex;flex-direction:column;min-width:0;position:relative}[data-stoyangu-order-popup="1"] .sty-media .popup-image{flex:1;max-height:none}[data-stoyangu-order-popup="1"] .sty-thumbs{display:flex;gap:8px;flex-wrap:wrap;padding:12px 14px 6px}[data-stoyangu-order-popup="1"] .dialog>.sty-thumbs{grid-column:1}[data-stoyangu-order-popup="1"] .sty-thumbs button{width:58px;height:58px;padding:0;border:2px solid #e2e8e3;border-radius:12px;background:#fff;cursor:pointer;overflow:hidden}[data-stoyangu-order-popup="1"] .sty-thumbs button img{width:100%;height:100%;object-fit:cover;display:block}[data-stoyangu-order-popup="1"] .sty-thumbs button.active{border-color:#17261f;box-shadow:0 0 0 2px #17261f}[data-stoyangu-order-popup="1"] .sty-option-title{display:block;font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#3d4a44;margin:16px 0 0}@media(max-width:720px){[data-stoyangu-order-popup="1"] .dialog{grid-template-columns:1fr}[data-stoyangu-order-popup="1"] .popup-image{min-height:310px;height:42vh}[data-stoyangu-order-popup="1"] .content{padding:22px}}'
      + '.sty-empty{padding:28px;text-align:center}';
    document.head.appendChild(style);
  }

  function findDesignedPopup() {
    return document.querySelector('[data-stoyangu-order-popup="1"]');
  }

  function ensurePopup() {
    ensureCss();
    popup = findDesignedPopup();
    if (!popup) {
      document.querySelectorAll('.product-popup, #productModal, .modal-backdrop, [data-product-popup]').forEach(function (legacyPopup) { legacyPopup.style.setProperty('display', 'none', 'important'); legacyPopup.setAttribute('aria-hidden', 'true'); });
      popup = document.createElement('div');
      popup.className = 'product-popup';
      popup.innerHTML = '<div class="dialog">'
        + '<button type="button" class="sty-close" data-close-popup="1" aria-label="Close">×</button>'
        + '<div class="sty-media">'
        + '<img class="popup-image" alt="" data-popup-image />'
        + '<div class="sty-thumbs" data-thumbs></div>'
        + '</div>'
        + '<div class="content">'
        + '<h3 data-popup-name>Product</h3>'
        + '<p class="popup-price" data-popup-price></p>'
        + '<div data-color-options></div>'
        + '<div data-size-options></div>'
        + '<div data-fulfilment-options></div>'
        + '<textarea data-note maxlength="300" placeholder="Any colour preference, delivery area, or question?"></textarea>'
        + '<a class="order" data-whatsapp href="#">Order via WhatsApp</a>'
        + '</div></div>';
      document.body.appendChild(popup);
    }
    popup.setAttribute('data-stoyangu-order-popup', '1');
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
    if (!popup.querySelector('[data-close-popup]')) {
      var closeFallback = document.createElement('button');
      closeFallback.type = 'button';
      closeFallback.className = 'sty-close';
      closeFallback.setAttribute('data-close-popup', '1');
      closeFallback.setAttribute('aria-label', 'Close');
      closeFallback.textContent = '×';
      var dialogHostForClose = popup.querySelector('.dialog, .modal-panel, #modalContent');
      (dialogHostForClose || popup).insertBefore(closeFallback, (dialogHostForClose || popup).firstChild);
    }
    var orderButton = popup.querySelector('[data-whatsapp], a.order');
    if (orderButton) {
      orderButton.textContent = 'Order via WhatsApp';
      orderButton.setAttribute('href', '#');
      orderButton.style.setProperty('background', '#19A45B', 'important');
      orderButton.style.setProperty('background-color', '#19A45B', 'important');
      popup.querySelectorAll('.sty-phone-field').forEach(function (field) { field.remove(); });
      if (!popup.querySelector('[data-fulfilment-options], [data-fulfilment]')) {
        var fulfilmentHost = document.createElement('div');
        fulfilmentHost.setAttribute('data-fulfilment-options', '');
        orderButton.parentNode.insertBefore(fulfilmentHost, orderButton);
      }
      var noteInput = popup.querySelector('[data-note]') || popup.querySelector('textarea:not([data-delivery-address])');
      if (!noteInput) {
        noteInput = document.createElement('textarea');
        noteInput.setAttribute('data-note', '');
        orderButton.parentNode.insertBefore(noteInput, orderButton);
      }
      noteInput.setAttribute('data-note', '');
      noteInput.setAttribute('placeholder', 'Optional order note');
      if (!popup.querySelector('[data-delivery-address-wrap]')) {
        var addressWrap = document.createElement('label');
        addressWrap.className = 'sty-delivery-address';
        addressWrap.setAttribute('data-delivery-address-wrap', '');
        addressWrap.innerHTML = 'Delivery address<textarea data-delivery-address maxlength="300" placeholder="Estate, building and nearest landmark"></textarea>';
        addressWrap.style.display = 'none';
        noteInput.parentNode.insertBefore(addressWrap, noteInput);
      }
      popup.querySelectorAll('[data-delivery-address]').forEach(function (input) { input.removeAttribute('data-note'); input.setAttribute('placeholder', 'Estate, building and nearest landmark'); });
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
    if (!header) return;
    header.classList.add('sty-sticky-nav');
    header.style.position = 'sticky';
    header.style.top = '0';
    header.style.zIndex = '60';
    document.querySelectorAll('#menuBtn, .mobile-menu, #mobileMenu, .sj-menu-trigger, .store-menu-button').forEach(function (node) {
      node.style.setProperty('display', 'none', 'important');
    });
    var nav = header.querySelector('nav');
    if (nav) nav.className = ((nav.className || '') + ' sty-nav').replace(/\s+/g, ' ').trim();
    ensureSection('home', ['#home', '#top', 'section', 'main']);
    ensureSection('products', ['#products', '#productGrid', '#shop', '[data-product-grid]', '[data-sty-live]']);
    ensureSection('contact', ['#contact', '#visit', 'footer']);
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
    var priceSelectors = selectors.some(function (selector) { return /price/i.test(selector); });
    selectors.forEach(function (sel) {
      root.querySelectorAll(sel).forEach(function (node) {
        if (node.closest && node.closest('.product-card')) return;
        node.textContent = value;
        if (priceSelectors && node.setAttribute) {
          node.setAttribute('data-price', value);
          node.setAttribute('data-popup-price', value);
        }
      });
    });
  }

  function ensureOptionTitles() {
    var groups = [
      { kind: 'color', title: 'Colour' },
      { kind: 'size', title: 'Size' },
      { kind: 'fulfilment', title: 'Delivery' }
    ];
    groups.forEach(function (group) {
      var host = findChoiceHost(group.kind);
      if (!host) return;
      var hasOptions = Boolean(host.querySelector('[data-sty-option], button, [role="button"]'));
      var prev = host.previousElementSibling;
      var existingTitle = prev && prev.classList && prev.classList.contains('sty-option-title') ? prev : null;
      if (!hasOptions) {
        host.style.display = 'none';
        if (existingTitle) existingTitle.style.display = 'none';
        return;
      }
      host.style.display = '';
      if (existingTitle) { existingTitle.style.display = ''; return; }
      var ownText = String(host.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(colour|color|size|delivery|fulfilment|how would)/i.test(ownText)) return;
      var prevText = prev ? String(prev.textContent || '').replace(/\s+/g, ' ').trim() : '';
      var prevIsLabel = Boolean(prev) && Boolean(prevText) && !prev.querySelector('[data-sty-option], button') && !(prev.hasAttribute && prev.hasAttribute('data-popup-price')) && !/popup-price|product-price/i.test(String(prev.className || ''));
      if (prevIsLabel) return;
      var heading = document.createElement('span');
      heading.className = 'sty-option-title';
      heading.textContent = group.title;
      host.insertAdjacentElement('beforebegin', heading);
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
    paintChoices('fulfilment', ['Walk in Store', 'Delivery']);
    var addressWrap = popup.querySelector('[data-delivery-address-wrap]');
    var addressInput = popup.querySelector('[data-delivery-address]');
    if (addressWrap) addressWrap.style.display = 'none';
    if (addressInput) addressInput.value = '';
    var noteEl = popup.querySelector('[data-note]') || popup.querySelector('textarea:not([data-delivery-address])');
    if (noteEl) noteEl.value = '';
    renderThumbs(product);
    ensureOptionTitles();
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
    popup.style.setProperty('position', 'fixed', 'important');
    popup.style.setProperty('top', '0', 'important');
    popup.style.setProperty('left', '0', 'important');
    popup.style.setProperty('width', '100%', 'important');
    popup.style.setProperty('height', '100%', 'important');
    var panel = popup.querySelector('.dialog, .modal-panel, #modalContent');
    if (panel) {
      panel.style.setProperty('opacity', '1', 'important');
      panel.style.setProperty('transform', 'none', 'important');
      panel.style.setProperty('visibility', 'visible', 'important');
      panel.scrollTop = 0;
    }
    popup.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }

  function closePopup() {
    popupOpen = false;
    document.body.style.overflow = '';
    if (!popup) return;
    popup.classList.remove('open');
    popup.style.setProperty('display', 'none', 'important');
  }

  function ensurePhoneStep() {
    if (phoneStep && document.body.contains(phoneStep)) return phoneStep;
    phoneStep = document.createElement('div');
    phoneStep.className = 'sty-phone-step';
    phoneStep.innerHTML = '<div class="sty-phone-card"><button type="button" class="sty-phone-close" data-phone-close aria-label="Close">×</button><h3>Where can we reach you?</h3><p>Confirm, WhatsApp will open with your order ready — just hit send and we will reply shortly..</p><label class="sty-phone-field">Phone number<input data-customer-phone type="tel" inputmode="numeric" autocomplete="tel" name="tel" placeholder="0712 345 678 or 0112 345 678"><small></small></label><button type="button" class="sty-phone-confirm" data-phone-confirm>Confirm &amp; Send Order via WhatsApp</button></div>';
    document.body.appendChild(phoneStep);
    return phoneStep;
  }

  function validCustomerPhone(value) {
    var digits = String(value || '').replace(/\D/g, '');
    return (digits.length === 10 && (digits.indexOf('07') === 0 || digits.indexOf('01') === 0)) || (digits.length === 12 && digits.indexOf('254') === 0);
  }

  function openPhoneStep() {
    var step = ensurePhoneStep();
    var input = step.querySelector('[data-customer-phone]');
    var saved = readSavedPhone();
    input.value = saved || '0';
    step.classList.add('open');
    window.setTimeout(function () { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 40);
  }

  function closePhoneStep() {
    if (phoneStep) phoneStep.classList.remove('open');
  }

  async function confirmOrderWithPhone(customerPhone) {
    if (!lastProduct) return;
    var extras = extrasFromPopup();
    extras.customerPhone = customerPhone;
    rememberPhone(customerPhone);
    var orderKey = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : 'order-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var confirmButton = phoneStep && phoneStep.querySelector('[data-phone-confirm]');
    if (confirmButton) { confirmButton.disabled = true; confirmButton.textContent = 'Confirming order…'; }
    try {
      var result = await submitOrderToParent({ product_id: lastProduct.id, customer_phone: customerPhone, color: extras.color, size: extras.size, fulfilment: extras.fulfilment, note: extras.note, order_key: orderKey });
      if (!result.ok) throw new Error(result.error || 'order-not-saved');
    } catch (error) {
      if (confirmButton) { confirmButton.disabled = false; confirmButton.textContent = 'Confirm'; }
      window.alert('We could not confirm this order. Please check your connection and try again.');
      return;
    }
    var url = orderUrl(lastProduct, extras);
    closePhoneStep();
    closePopup();
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function rebuildOrder() {
    if (!popup || !lastProduct) return;
    var btn = popup.querySelector('[data-whatsapp], a.order');
    if (!btn) return;
    btn.setAttribute('href', '#');
    btn.removeAttribute('target');
  }

  function productFromEvent(target) {
    var card = target.closest && target.closest('.product-card, [data-id], [data-product-id]');
    console.log('STY-DEBUG card:', card);
    if (!card) return null;
    var found = byId[String(card.getAttribute('data-id') || card.getAttribute('data-product-id') || '')];
    console.log('STY-DEBUG found:', found, 'byId keys:', Object.keys(byId));
    if (found && rawPrice(found.price) > 0) return found;
    if (found) {
      var fallback = rawPrice(card.getAttribute('data-price-value') || card.getAttribute('data-price'));
      if (fallback) found.price = fallback;
      return found;
    }
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-sty-live="1"] .product-card, #productGrid .product-card, [data-product-grid] .product-card'));
    var index = cards.indexOf(card);
    console.log('STY-DEBUG fallback index:', index, 'cards.length:', cards.length);
    return index >= 0 ? visibleProducts()[index] || null : null;
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
        if (kind === 'fulfilment') {
          var addressWrap = popup.querySelector('[data-delivery-address-wrap]');
          if (addressWrap) addressWrap.style.display = String(choice.getAttribute('data-value') || choice.textContent).trim() === 'Delivery' ? 'grid' : 'none';
        }
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
      var closePhone = event.target.closest && event.target.closest('[data-phone-close]');
      if (closePhone || (phoneStep && event.target === phoneStep)) { event.preventDefault(); closePhoneStep(); return; }
      var confirmPhone = event.target.closest && event.target.closest('[data-phone-confirm]');
      if (confirmPhone) {
        event.preventDefault();
        var phoneInput = phoneStep && phoneStep.querySelector('[data-customer-phone]');
        var phoneValue = phoneInput ? phoneInput.value.trim() : '';
        var phoneField = phoneStep && phoneStep.querySelector('.sty-phone-field');
        if (!validCustomerPhone(phoneValue)) { if (phoneField) { phoneField.classList.add('has-error'); var phoneHelp = phoneField.querySelector('small'); if (phoneHelp) phoneHelp.textContent = 'Enter a valid phone number.'; } if (phoneInput) phoneInput.focus(); return; }
        confirmOrderWithPhone(phoneValue);
        return;
      }
      var order = event.target.closest && event.target.closest('[data-whatsapp]');
      if (order && lastProduct) {
        event.preventDefault();
        event.stopPropagation();
        var savedPhone = readSavedPhone();
        if (validCustomerPhone(savedPhone)) confirmOrderWithPhone(savedPhone);
        else openPhoneStep();
      }
    }, true);
    document.addEventListener('keyup', function (event) {
      if (event.key === 'Escape') closePopup();
    });
  }

  function readEmbeddedCatalog() {
    var node = document.getElementById('stoyangu-catalog');
    if (!node) return [];
    try { var raw = node.textContent || node.innerHTML || '[]'; var decoder = document.createElement('textarea'); decoder.innerHTML = raw; return JSON.parse(decoder.value || raw); } catch (e) { return []; }
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
    removeGeneralWhatsAppLinks();
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
})();
