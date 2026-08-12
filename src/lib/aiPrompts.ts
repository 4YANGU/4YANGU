// The two prompts for the AI builder. Prompt 1 designs freely inside our hard
// rules; Prompt 2 packages it as the skin folder we upload.

export const AI_SKIN_DESIGN_PROMPT = [
  "Design a complete Kenyan social-shop storefront called '[STORE]' for a seller of [PRODUCTS], using my uploaded logo/photos where I provided them.",
  "",
  "You have full creative freedom (any aesthetic, fonts, colours and layout), with ONLY these hard rules:",
  "1. Exactly FOUR sections, in this order: Home, Categories, Products, Contact. Nothing else. No cart, no checkout, no account pages, no backend talk.",
  "2. Every order/buy intent is a WhatsApp link or button - never a cart. The links/tokens are filled by the host app.",
  "3. All images come from permanent https hosts ONLY: images.unsplash.com, images.pexels.com, fonts.googleapis.com, fonts.gstatic.com, cdn-icons-png.flaticon.com, or our Supabase media URLs I provide. NEVER tmpfiles.org or any temporary host - they expire within hours.",
  "4. Mobile-first, fast, accessible. All motion is pure CSS (@keyframes/transitions) - zero JavaScript for animation.",
  "5. Treat the store name, domain, WhatsApp link and product data as LIVE SLOTS filled by the host app - never hardcode them.",
].join('\n');

export const AI_SKIN_PACKAGE_PROMPT = [
  "Now package that storefront as a StoYangu SKIN folder. Structure (exact):",
  "",
  "  skin/",
  "    storefront.html        - Nav bar, category chips slot, products slot, contact section",
  "    product-template.html  - One product page template, stamped per product by the host",
  "    styles.css             - All styling for both pages, CSS only",
  "    script.js              - OPTIONAL: only local DOM moves (nav anchors, show/hide category filters, spec chips). NEVER fetch(), XMLHttpRequest, eval(), external scripts, cookies, localStorage/sessionStorage, or API calls.",
  "    assets/                - Decorative images only (textures, patterns, icons)",
  "",
  "REQUIRED SLOTS - the host stamps these with live data:",
  "  storefront.html must contain: {{STORE_NAME}} {{STORE_DOMAIN}} {{WHATSAPP_URL}} {{CATEGORIES_CHIPS}} {{PRODUCTS}}",
  "  product-template.html must contain: {{PRODUCT_NAME}} {{PRICE}} {{PRODUCT_IMAGE}} {{ORDER_URL}}",
  "  Optional product tokens: {{GALLERY}} {{CATEGORY}} {{COLORS}} {{SIZES}} {{SIMILAR}} {{BACK_URL}} {{STORE_LOGO}} {{PRODUCT_ID}} {{PRICE_KES}}",
  "  For skin-designed product cards, wrap YOUR card markup in <template data-sty-card>...</template> on the storefront page - the host stamps one per product.",
  "",
  "NEVER include: <script> tags in the HTML files, <form> tags, iframes, external fonts outside the allowlist, or any API/token/database references.",
  "The host handles WhatsApp ordering, analytics and product data completely.",
].join('\n');
