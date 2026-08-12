export const AI_SKIN_DESIGN_PROMPT = [
  'Design a complete Kenyan social-shop storefront called "[STORE]" for a seller of [PRODUCTS], using my uploaded logo/photos where I provided them.',
  '',
  'You have full creative freedom (any aesthetic, fonts, colours, CSS-driven motion and layout), with ONLY these hard rules:',
  '1. Exactly FOUR sections, in this order: Home, Categories, Products, Contact. Nothing else. No cart, no checkout, no account pages, no backend talk.',
  '2. Every order/buy intent is a WhatsApp link or button — never a cart.',
  '3. All images come from permanent https hosts (Unsplash, Pexels, or the ones I attach) — never temp hosts like tmpfiles.org; those expire in hours.',
  '4. Mobile-first, fast, accessible. Treat the store name as a live slot because our app fills it.',
  '5. HTML + CSS ONLY — absolutely no JavaScript. Animations via pure CSS (@keyframes, transitions). The host app removes any <script> tags and inline handlers you emit. Everything interactive is supplied by the host app bridge.',
].join('\n');

export const AI_SKIN_PACKAGE_PROMPT = [
  'Now package that storefront for the store-host app (StoYangu) as EXACTLY ONE self-contained file named index.html — all CSS inside one embedded <style> block in the <head>. NO JavaScript at all: no <script> tags, no onclick/onload/on* attributes, no external .js links (our app removes them silently anyway).',
  '',
  'Inside that file, mark the live-injection sockets EXACTLY this way:',
  '- An EMPTY <div id="stoyangu-products" data-product-grid></div> where the real product catalogue should appear (our app renders the seller live products there).',
  '- Every Order/Buy/WhatsApp call-to-action must carry data-wa-order (we turn all of them into real WhatsApp order links with full product context).',
  '- Product cards should carry data-product="Exact Product Name" whenever they display a specific product, so our app can wire views and orders.',
  '- Anywhere the store name prints, wrap it with data-store-name. The store domain uses data-store-domain. Any WhatsApp link element uses data-wa-link.',
  '- Never invent image URLs for logo/product photos; ask me for the logo/photos or use permanent links only.',
  '',
  'The app injects its own runtime into the page; do not add any tracking, forms that POST anywhere, payments, or contact backends. CSS-only motion only (@keyframes, transitions) — never JavaScript.',
  '',
  'RESULT DELIVERY: if your environment can output files, also give me a one-tap DOWNLOAD link for the zip of exactly that folder. That download link lives on YOUR page — never inside the skin itself. The zip I download is exactly what I upload into StoYangu.',
].join('\n');
