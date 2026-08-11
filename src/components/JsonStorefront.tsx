import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Menu, MessageCircle, ShoppingBag, X } from 'lucide-react';
import { Component, CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { Product, Store } from '../types';
import { formatMoney } from '../lib/api';

type AnyRecord = Record<string, any>;
type EngineProps = { store: Store; products: Product[]; onOrder: (product: Product, color?: string, size?: string) => void; onView: (id: number) => void };

const isObject = (value: unknown): value is AnyRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const words = (value: unknown) => String(value ?? '').replace(/[_-]+/g, ' ').trim();
const keyOf = (obj: AnyRecord, ...keys: string[]) => keys.find((key) => obj[key] !== undefined);
const take = (obj: AnyRecord, ...keys: string[]) => { const key = keyOf(obj, ...keys); return key ? obj[key] : undefined; };
const asArray = (value: unknown): any[] => Array.isArray(value) ? value : isObject(value) ? Object.entries(value).map(([id, item]) => isObject(item) ? ({ id, ...item }) : ({ id, value: item })) : value == null ? [] : [value];
const safeUrl = (value: unknown) => {
  const text = String(value || '');
  if (/^\/(?!\/)/.test(text) || /^https:\/\//i.test(text) || /^data:image\/(png|jpeg|webp);base64,/i.test(text)) return text;
  return '';
};
const safeVideo = (value: unknown): string => {
  const text = String(resolveText(value) || (isObject(value) ? '' : '') || '').trim();
  if (/^https?:\/\/[^\s<>"]+\.(mp4|webm|mov)(\?[^\s<>"]*)?$/i.test(text)) return text;
  return '';
};

const safeHref = (value: unknown, fallback = '#') => {
  const text = String(value || '').trim();
  if (/^#[a-z0-9_-]+$/i.test(text) || /^\/(?!\/)/.test(text) || /^https:\/\//i.test(text) || /^(mailto|tel):[^\s]+$/i.test(text)) return text;
  return fallback;
};
const safeCssValue = (value: unknown): string | number | undefined => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  if (/[{}<>]|javascript:|expression\s*\(/i.test(value)) return undefined;
  return value.slice(0, 500);
};

// Any-shaped JSON → clean readable text (strings, numbers, arrays of lines,
// nested {text}/{label}/{parts} objects all resolve into prose).
const resolveText = (value: unknown, depth = 0): string => {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (depth > 6) return '';
  if (Array.isArray(value)) return value.map((item) => resolveText(item, depth + 1)).filter(Boolean).join(' · ');
  if (isObject(value)) {
    const direct = take(value, 'text', 'content', 'value', 'label', 'title', 'headline', 'message', 'html');
    if (direct != null && !isObject(direct) && !Array.isArray(direct)) return String(direct).trim();
    const parts = take(value, 'parts', 'lines', 'segments', 'items', 'runs');
    if (parts != null) return resolveText(parts, depth + 1);
    return resolveText(Object.values(value), depth + 1);
  }
  return '';
};

// Any-shaped JSON → a usable image URL, even when the image lives inside an
// object like { public_https_asset: 'https://...' }.
const safeImage = (value: unknown): string => {
  const direct = safeUrl(value);
  if (direct) return direct;
  if (isObject(value)) return safeUrl(take(value, 'url', 'src', 'href', 'link', 'public_https_asset', 'asset', 'path', 'image', 'source'));
  return '';
};

// Design specs often bury visible content inside layout zones/regions. Lift
// those zones up so they render like normal sections while styling stays put.
function expandZones(node: AnyRecord): AnyRecord {
  if (!isObject(node.layout)) return node;
  const zones = asArray(take(node.layout, 'zones', 'areas', 'regions', 'rows', 'panels', 'slots'));
  if (!zones.length) return node;
  return { ...node, layout_zones: zones };
}
const styleAliases: Record<string, string> = {
  background_colour: 'backgroundColor', background_color: 'backgroundColor', text_colour: 'color', text_color: 'color',
  border_radius: 'borderRadius', box_shadow: 'boxShadow', font_family: 'fontFamily', font_size: 'fontSize', font_weight: 'fontWeight',
  line_height: 'lineHeight', letter_spacing: 'letterSpacing', text_align: 'textAlign', grid_template_columns: 'gridTemplateColumns',
  grid_template_rows: 'gridTemplateRows', grid_column: 'gridColumn', grid_row: 'gridRow', align_items: 'alignItems', justify_content: 'justifyContent',
  max_width: 'maxWidth', min_height: 'minHeight', object_fit: 'objectFit', aspect_ratio: 'aspectRatio', flex_direction: 'flexDirection',
  flex_wrap: 'flexWrap', backdrop_filter: 'backdropFilter', border_colour: 'borderColor', border_color: 'borderColor',
};
const styleKeys = new Set(['display','position','inset','top','right','bottom','left','width','height','minWidth','maxWidth','minHeight','maxHeight','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','gap','rowGap','columnGap','color','background','backgroundColor','backgroundImage','border','borderWidth','borderStyle','borderColor','borderRadius','boxShadow','opacity','overflow','overflowX','overflowY','zIndex','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textAlign','textTransform','textDecoration','whiteSpace','gridTemplateColumns','gridTemplateRows','gridColumn','gridRow','alignItems','alignContent','justifyContent','justifyItems','flex','flexDirection','flexWrap','order','objectFit','objectPosition','aspectRatio','transform','transformOrigin','filter','backdropFilter','cursor']);
const camel = (key: string) => key.replace(/[-_]([a-z])/g, (_, char) => char.toUpperCase());

function toStyle(source: unknown): CSSProperties {
  if (!isObject(source)) return {};
  const out: Record<string, string | number> = {};
  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const mapped = styleAliases[rawKey] || camel(rawKey);
    if (!styleKeys.has(mapped)) return;
    const value = safeCssValue(rawValue);
    if (value !== undefined) out[mapped] = value;
  });
  return out as CSSProperties;
}

function mergedStyle(node: AnyRecord): CSSProperties {
  const candidates = [node.style, node.styles?.base, node.visual_style, node.css, node.layout, node.positioning];
  const combined = Object.assign({}, ...candidates.map(toStyle));
  if (node.background && !isObject(node.background)) combined.background = safeCssValue(node.background);
  if (node.colour || node.color) combined.color = safeCssValue(node.colour || node.color);
  return combined;
}

function classId(path: string) {
  let hash = 0;
  for (let index = 0; index < path.length; index++) hash = ((hash << 5) - hash + path.charCodeAt(index)) | 0;
  return `sj-${Math.abs(hash)}`;
}

function responsiveCss(node: AnyRecord, path: string, breakpoints: AnyRecord): string {
  const responsive = take(node, 'responsive', 'responsive_rules', 'breakpoints');
  if (!isObject(responsive)) return '';
  const className = classId(path);
  const defaults: AnyRecord = { mobile: 0, sm: 480, tablet: 768, md: 768, desktop: 1024, lg: 1024, wide: 1280 };
  return Object.entries(responsive).map(([name, rules]) => {
    const px = Number(breakpoints?.[name] ?? defaults[name] ?? String(name).replace(/\D/g, '')) || 0;
    const style = toStyle(isObject(rules) && (rules.style || rules.layout) ? { ...(rules.layout || {}), ...(rules.style || {}) } : rules);
    const declarations = Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${String(value)}!important`).join(';');
    const query = name === 'mobile' ? `(max-width:${Number(breakpoints?.tablet ?? defaults.tablet) - 0.02}px)` : `(min-width:${px}px)`;
    return declarations ? `@media ${query}{.${className}{${declarations}}}` : '';
  }).join('');
}

function normaliseDesign(raw: unknown): AnyRecord {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return isObject(parsed) ? parsed : {};
  } catch { return {}; }
}

function getSections(design: AnyRecord): AnyRecord[] {
  const direct = take(design, 'sections', 'page_sections', 'content_sections', 'pages', 'screens', 'routes');
  let sections = asArray(direct).filter(isObject);
  if (sections.length) {
    // Specs sometimes group content under pages/routes — flatten one level.
    const flattened: AnyRecord[] = [];
    sections.forEach((entry) => {
      const inner = asArray(take(entry, 'sections', 'blocks', 'content', 'zones', 'children')).filter(isObject);
      const looksLikeSection = take(entry, 'type', 'component', 'kind', 'headline', 'heading', 'title') != null;
      if (inner.length && !looksLikeSection) flattened.push(...inner);
      else flattened.push(entry);
    });
    if (flattened.length) return flattened;
  }
  const ignored = new Set(['theme','design_tokens','tokens','global_ui','globalUI','header','footer','navigation','breakpoints','metadata']);
  const inferred = Object.entries(design).filter(([key, value]) => !ignored.has(key) && isObject(value)).map(([id, value]) => ({ id, ...value }));
  return inferred.length ? inferred : [{ id: 'hero', type: 'hero' }, { id: 'products', type: 'products' }, { id: 'contact', type: 'contact' }];
}

function collectFontUrls(design: AnyRecord) {
  const found = new Set<string>();
  const stack: unknown[] = [design.theme, design.design_tokens, design.typography, design.fonts];
  let visited = 0;
  while (stack.length && visited < 5000) {
    visited++;
    const item = stack.pop();
    if (Array.isArray(item)) item.forEach((value) => stack.push(value));
    else if (isObject(item)) Object.entries(item).forEach(([key, value]) => {
      if (/import.*url|font.*url|stylesheet/i.test(key) && typeof value === 'string' && /^https:\/\//.test(value)) found.add(value);
      else if (typeof value === 'object') stack.push(value);
    });
  }
  return [...found].slice(0, 8);
}

function themeVariables(design: AnyRecord): CSSProperties {
  const theme = take(design, 'theme', 'design_tokens', 'tokens') || {};
  let colors = take(theme, 'colors', 'colours', 'palette') || take(design, 'colors', 'colours') || {};
  if (!isObject(colors) || !Object.keys(colors).length) {
    // Many specs describe colours in prose ("jungle green (#142B20)").
    // Rescue those hex values so the theme still takes effect.
    const prose = JSON.stringify(theme);
    const rescued: Record<string, string> = {};
    const roleMap: Array<[RegExp, string]> = [[/\b(background|canvas|surface|bg)\b[^"#]{0,40}?(#[0-9a-fA-F]{6})/i, 'background'], [/\b(accent|primary|brand|highlight|cta|amber|orange|gold)\b[^"#]{0,40}?(#[0-9a-fA-F]{6})/i, 'primary'], [/\b(text|ink|foreground)\b[^"#]{0,40}?(#[0-9a-fA-F]{6})/i, 'text'], [/\b(heading|title)\b[^"#]{0,40}?(#[0-9a-fA-F]{6})/i, 'heading']];
    roleMap.forEach(([pattern, slot]) => { const match = prose.match(pattern); if (match && !rescued[slot]) rescued[slot] = match[2]; });
    const allHexes = Array.from(prose.matchAll(/#[0-9a-fA-F]{6}\b/g)).map((match) => match[0]);
    if (!rescued.primary && allHexes.length) rescued.primary = allHexes[allHexes.length > 1 ? 1 : 0];
    if (!rescued.background && allHexes.length > 2) rescued.background = allHexes[0];
    colors = rescued;
  }
  const out: AnyRecord = {};
  if (isObject(colors)) Object.entries(colors).forEach(([name, value]) => {
    const safe = safeCssValue(isObject(value) ? value.value : value);
    if (safe !== undefined) out[`--${String(name).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`] = safe;
  });
  const primary = take(colors, 'primary', 'brand', 'accent') || '#5a966e';
  const surface = take(colors, 'background', 'surface', 'base') || '#fffdf7';
  const text = take(colors, 'text', 'foreground', 'ink') || '#17261f';
  out['--store-primary'] = safeCssValue(isObject(primary) ? primary.value : primary) || '#5a966e';
  out['--store-bg'] = safeCssValue(isObject(surface) ? surface.value : surface) || '#fffdf7';
  out['--store-text'] = safeCssValue(isObject(text) ? text.value : text) || '#17261f';
  const typography = take(theme, 'typography', 'type') || design.typography || {};
  out['--store-font'] = safeCssValue(take(typography, 'body_font', 'bodyFont', 'font_family', 'fontFamily')) || 'Inter, system-ui, sans-serif';
  out['--store-heading-font'] = safeCssValue(take(typography, 'heading_font', 'headingFont', 'display_font', 'displayFont')) || out['--store-font'];
  return out as CSSProperties;
}

function motionSpec(node: AnyRecord, reduced: boolean) {
  if (reduced) return { initial: false };
  const spec = take(node, 'motion', 'animation', 'animations', 'transition') || {};
  if (!isObject(spec)) return {};
  const initial = isObject(spec.initial) ? spec.initial : undefined;
  const animate = isObject(spec.animate) ? spec.animate : undefined;
  const transition = {
    duration: Number(spec.duration ?? spec.transition?.duration ?? 0.55),
    delay: Number(spec.delay ?? spec.transition?.delay ?? 0),
    ease: spec.easing ?? spec.ease ?? spec.transition?.ease ?? 'easeOut',
    repeat: spec.infinite || spec.loop === 'infinite' ? Infinity : Number(spec.repeat || 0),
    repeatType: spec.repeat_type || 'loop',
  } as AnyRecord;
  return { initial: initial || (animate ? { opacity: 0 } : undefined), animate, transition };
}

function AnimatedBox({ node, path, children, className, breakpoints, as = 'div', styleOverride }: { node: AnyRecord; path: string; children: React.ReactNode; className?: string; breakpoints: AnyRecord; as?: string; styleOverride?: CSSProperties }) {
  const reduced = Boolean(useReducedMotion());
  const ref = useRef<HTMLDivElement>(null);
  const spec = take(node, 'motion', 'animation', 'animations') || {};
  useEffect(() => {
    if (reduced || !ref.current || !isObject(spec) || !Array.isArray(spec.keyframes) || !ref.current.animate) return;
    const frames = spec.keyframes.map(toStyle);
    const animation = ref.current.animate(frames as Keyframe[], { duration: Math.max(1, Number(spec.duration || 2)) * 1000, delay: Number(spec.delay || 0) * 1000, iterations: spec.infinite ? Infinity : Number(spec.iterations || 1), easing: String(spec.easing || 'ease-in-out'), fill: 'both' });
    return () => animation.cancel();
  }, [spec, reduced]);
  const MotionTag = (motion as AnyRecord)[as] || motion.div;
  const css = responsiveCss(node, path, breakpoints);
  return <><MotionTag ref={ref} className={`${classId(path)} ${className || ''}`} style={{ ...mergedStyle(node), ...styleOverride }} {...motionSpec(node, reduced)}>{children}</MotionTag>{css && <style>{css}</style>}</>;
}

function Slideshow({ node, path, breakpoints }: { node: AnyRecord; path: string; breakpoints: AnyRecord }) {
  const slides = asArray(take(node, 'slides', 'images', 'items')).filter((item) => item != null);
  const [index, setIndex] = useState(0);
  const timing = Number(take(node, 'auto_advance_timing', 'autoAdvance', 'interval', 'duration') || 5) * 1000;
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % slides.length), Math.max(1200, timing));
    return () => window.clearInterval(timer);
  }, [slides.length, timing]);
  if (!slides.length) return null;
  const slide = isObject(slides[index]) ? slides[index] : { image: slides[index] };
  const image = safeUrl(take(slide, 'image', 'image_url', 'src', 'url'));
  return <div className="json-slideshow" style={mergedStyle(node)}>
    <AnimatePresence mode="wait"><motion.div key={index} initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: .45 }} className="json-slide">
      {image && <img src={image} alt={String(take(slide, 'alt', 'title', 'caption') || '')} />}
      {(slide.title || slide.caption) && <div className="json-slide-caption"><strong>{slide.title}</strong><span>{slide.caption}</span></div>}
    </motion.div></AnimatePresence>
    {slides.length > 1 && <div className="slide-controls"><button onClick={() => setIndex((index - 1 + slides.length) % slides.length)} aria-label="Previous slide"><ChevronLeft /></button><span>{index + 1} / {slides.length}</span><button onClick={() => setIndex((index + 1) % slides.length)} aria-label="Next slide"><ChevronRight /></button></div>}
  </div>;
}

function ProductCard({ product, onOrder, onView, cardStyle, collectionMotion, index }: { product: Product; onOrder: EngineProps['onOrder']; onView: EngineProps['onView']; cardStyle?: AnyRecord; collectionMotion?: AnyRecord; index: number }) {
  const ref = useRef<HTMLElement>(null);
  const reduced = Boolean(useReducedMotion());
  const [color, setColor] = useState(product.colors?.[0] || '');
  const [size, setSize] = useState(product.sizes?.[0] || '');
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { onView(product.id); observer.disconnect(); } }, { threshold: .55 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [product.id, onView]);
  const animation = motionSpec({ motion: collectionMotion }, reduced) as AnyRecord;
  const stagger = Number(collectionMotion?.stagger ?? collectionMotion?.stagger_children ?? 0);
  const transition = animation.transition ? { ...animation.transition, delay: Number(animation.transition.delay || 0) + index * stagger } : undefined;
  return <motion.article ref={ref} className="store-product-card" style={toStyle(cardStyle)} initial={animation.initial} animate={animation.animate} transition={transition}>
    <div className="store-product-image"><img src={product.image_url || '/stoyangu-logo.png'} alt={product.name} loading="lazy" /></div>
    <div className="store-product-copy"><span className="product-category">{product.category}</span><h3>{product.name}</h3><strong>{formatMoney(product.price)}</strong>
      {product.colors?.length > 0 && <label>Colour<select value={color} onChange={(event) => setColor(event.target.value)}>{product.colors.map((item) => <option key={item}>{item}</option>)}</select></label>}
      {product.sizes?.length > 0 && <label>Size<select value={size} onChange={(event) => setSize(event.target.value)}>{product.sizes.map((item) => <option key={item}>{item}</option>)}</select></label>}
      <button className="store-order-button" onClick={() => onOrder(product, color, size)}><MessageCircle size={18} /> Order via WhatsApp</button>
    </div>
  </motion.article>;
}

function ProductCollection({ node, products, onOrder, onView }: { node: AnyRecord; products: Product[]; onOrder: EngineProps['onOrder']; onView: EngineProps['onView'] }) {
  const [category, setCategory] = useState('All');
  const categories = ['All', ...Array.from(new Set(products.map((item) => item.category).filter(Boolean)))];
  const visible = category === 'All' ? products : products.filter((item) => item.category === category);
  const cardStyle = take(node, 'card_style', 'product_card', 'cardStyle');
  const heading = take(node, 'heading', 'headline', 'title');
  const eyebrow = take(node, 'eyebrow', 'kicker', 'overline');
  const body = take(node, 'body', 'description', 'subtitle');
  const collectionMotion = take(node, 'motion', 'animation', 'animations');
  return <div className="store-products-wrap">
    {(heading || eyebrow || body) && <div className="store-products-heading">{eyebrow && <span className="json-eyebrow">{String(eyebrow)}</span>}{heading && <h2>{String(heading)}</h2>}{body && <p>{String(body)}</p>}</div>}
    {categories.length > 2 && <div className="store-filters" aria-label="Product categories">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>}
    <div className="store-product-grid" style={toStyle(take(node, 'grid', 'grid_style', 'layout'))}>
      {visible.map((product, index) => <ProductCard key={product.id} product={product} onOrder={onOrder} onView={onView} cardStyle={cardStyle} collectionMotion={collectionMotion} index={index} />)}
    </div>
    {!visible.length && <p className="store-empty">New products are coming soon.</p>}
  </div>;
}

const configKeys = new Set(['style','styles','layout','positioning','responsive','responsive_rules','breakpoints','motion','animation','animations','transition','accessibility','aria','id','type','component','kind','name','key','font','fonts','typography','colors','colours','theme','design_tokens','tokens','card_style','product_card','grid','grid_style']);

function deepPrimitiveContent(node: AnyRecord) {
  const values: string[] = [];
  const stack: unknown[] = [node];
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) item.slice().reverse().forEach((value) => stack.push(value));
    else if (isObject(item)) Object.entries(item).reverse().forEach(([key, value]) => { if (!configKeys.has(key)) stack.push(value); });
    else if (typeof item === 'string' || typeof item === 'number') values.push(String(item));
  }
  return values;
}

function GenericNode({ node: input, path, store, products, onOrder, onView, breakpoints, depth = 0 }: { node: unknown; path: string; store: Store; products: Product[]; onOrder: EngineProps['onOrder']; onView: EngineProps['onView']; breakpoints: AnyRecord; depth?: number }): React.ReactNode {
  const node = (isObject(input) ? expandZones(input) : input) as AnyRecord;
  if (node == null || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return <p className="json-text">{String(node)}</p>;
  if (Array.isArray(node)) {
    const primitives = node.filter((item) => typeof item === 'string' || typeof item === 'number');
    if (node.length && primitives.length === node.length) return <div className="json-pills">{primitives.map((item, index) => <span key={index}>{String(item)}</span>)}</div>;
    const linkable = (item: unknown) => isObject(item) && (resolveText(take(item, 'label', 'text', 'title', 'name')) || '').length > 0 && Boolean(take(item, 'url', 'href', 'link', 'to'));
    if (node.length && node.every(linkable)) return <div className="json-links">{node.map((item, index) => { const target = safeHref(take(item, 'url', 'href', 'link', 'to')); return target.startsWith('#') && !document.getElementById(target.slice(1)) ? null : <a key={index} href={target}>{resolveText(take(item, 'label', 'text', 'title', 'name'))}</a>; })}</div>;
    return <>{node.map((item, index) => <GenericNode key={`${path}-${index}`} node={item} path={`${path}.${index}`} store={store} products={products} onOrder={onOrder} onView={onView} breakpoints={breakpoints} depth={depth + 1} />)}</>;
  }
  if (!isObject(node)) return null;
  if (depth > 80) return <div className="json-depth-safe">{deepPrimitiveContent(node).map((value, index) => <p key={index}>{value}</p>)}</div>;
  const identity = words(take(node, 'type', 'component', 'kind', 'id', 'name') || '').toLowerCase();
  if (identity === 'shop' || /(^|\s)(products?|catalog|collection|product grid|product collection|shop by categor(y|ies)|categor(y|ies))(\s|$)/.test(identity)) return <ProductCollection node={node} products={products} onOrder={onOrder} onView={onView} />;
  if (/slide|carousel/.test(identity) || Array.isArray(node.slides)) return <Slideshow node={node} path={path} breakpoints={breakpoints} />;
  const title = resolveText(take(node, 'headline', 'heading', 'title', 'name', 'main_headline', 'heading_text', 'headline_text', 'primary_text', 'hero_title'));
  const eyebrow = resolveText(take(node, 'eyebrow', 'kicker', 'overline', 'label', 'badge_text', 'announcement', 'pill'));
  const body = resolveText(take(node, 'body', 'description', 'subtitle', 'subheading', 'copy', 'paragraph', 'tagline', 'supporting_text', 'sub_headline', 'lede'));
  const text = resolveText(node.text);
  let image = safeImage(take(node, 'image_url', 'image', 'src', 'photo', 'background_image', 'image_asset', 'media', 'visual', 'art', 'banner'));
  const alt = String(resolveText(take(node, 'alt', 'image_alt', 'aria_label')) || title || '');
  const cta = take(node, 'cta', 'button', 'action', 'primary_action', 'cta_button', 'action_button', 'primary_button');
  const video = safeVideo(take(node, 'video', 'background_video', 'video_url')) || (isObject(node.background) ? safeVideo(take(node.background, 'url', 'src', 'video') || take(node.background, 'sources', 'source')) : '');
  const consumedKeys = ['headline','heading','title','name','main_headline','heading_text','headline_text','primary_text','hero_title','eyebrow','kicker','overline','label','badge_text','announcement','pill','body','description','subtitle','subheading','copy','text','paragraph','tagline','supporting_text','sub_headline','lede','image_url','image','src','photo','background_image','image_asset','media','visual','art','banner','alt','image_alt','aria_label','cta','button','action','primary_action','cta_button','action_button','primary_button','semantic_tag','element','tag','role','zones','accessibility','aria'];
  const nested = Object.entries(node).filter(([key, value]) => {
    if (configKeys.has(key) || consumedKeys.includes(key)) return false;
    return Array.isArray(value) || isObject(value);
  });
  const extras = Object.entries(node).filter(([key, value]) => {
    if (configKeys.has(key) || consumedKeys.includes(key)) return false;
    return typeof value === 'string' || typeof value === 'number';
  });
  // Spec authors style parts directly: headline_style, body_style,
  // button_style... Also accept style co-located on the content object itself
  // (e.g. headline: { text: '...', style: {...} }).
  const partStyle = (name: string, content: unknown): CSSProperties => {
    const fromNode = toStyle(take(node, `${name}_style`, `${name}_styles`, `${name}Style`));
    const fromContent = isObject(content) ? toStyle(take(content, 'style', 'styles')) : {};
    return { ...fromNode, ...fromContent };
  };
  const styleTitle = partStyle('headline', take(node, 'headline') ?? take(node, 'heading') ?? node.title);
  const styleEyebrow = partStyle('eyebrow', node.eyebrow);
  const styleBody = partStyle('body', take(node, 'body') ?? take(node, 'description'));
  const styleText = partStyle('text', node.text);
  const styleCta = partStyle('button', cta) as CSSProperties;
  const styleImage = partStyle('image', take(node, 'image', 'image_url'));
  // Background imagery and scrims belong on the wrapper, not as an inline photo.
  const wrapper = mergedStyle(node);
  // Full-bleed backdrop detection across every common spec vocabulary.
  let bgImage = safeImage(take(node, 'background_image', 'background_photo', 'bg_image', 'backdrop', 'cover_image', 'cover'))
    || (isObject(node.background) ? safeImage(take(node.background, 'url', 'src', 'image', 'public_https_asset')) : '')
    || (isObject(node.media) ? safeImage(take(node.media, 'background', 'backdrop', 'cover')) : '')
    || (isObject(node.visual) ? safeImage(take(node.visual, 'background', 'image')) : '')
    || (isObject(node.visual_asset) ? safeImage(take(node.visual_asset, 'url', 'src')) : '')
    || (isObject(node.assets) ? safeImage(take(node.assets, 'background', 'hero', 'hero_media', 'cover', 'backdrop')) : '');
  if (bgImage && !wrapper.backgroundImage) { wrapper.backgroundImage = `url("${bgImage}")`; wrapper.backgroundSize = wrapper.backgroundSize || 'cover'; wrapper.backgroundPosition = wrapper.backgroundPosition || 'center'; }
  // Text over a photo needs automatic contrast: a default dark scrim unless the
  // spec says otherwise, plus white text handled by the .json-on-media classes.
  let scrimValue = take(node, 'overlay_colour', 'overlay_color', 'scrim_color', 'scrim') || (isObject(node.overlay) ? take(node.overlay, 'colour', 'color') : undefined) || (typeof node.overlay === 'string' ? node.overlay : undefined);
  const scrimOpacity = Number(take(node, 'overlay_opacity', 'scrim_opacity') ?? (isObject(node.overlay) ? node.overlay.opacity : undefined) ?? (bgImage ? 0.42 : scrimValue ? 0.45 : 0)) || 0;
  if (bgImage && !scrimValue) scrimValue = '#000000';
  if (bgImage || scrimValue) { wrapper.position = 'relative'; }
  if (image && image === bgImage) image = '';
  const semantic = String(take(node, 'semantic_tag', 'element', 'tag') || (/hero/.test(identity) ? 'section' : 'div')).toLowerCase();
  const allowedTags = new Set(['section','article','aside','div','nav','main','header','footer']);
  const as = allowedTags.has(semantic) ? semantic : 'div';
  const access = isObject(node.accessibility) ? node.accessibility : isObject(node.aria) ? node.aria : {};
  const mediaTone = bgImage ? 'json-on-media json-fullbleed' : scrimValue ? 'json-on-media' : '';
  return <AnimatedBox node={node} path={path} className={`json-node json-${identity.replace(/[^a-z0-9]+/g, '-') || 'block'} ${mediaTone}`} breakpoints={breakpoints} as={as} styleOverride={wrapper}>
    {Boolean(scrimValue) && scrimOpacity > 0 && <div className="json-scrim" style={{ background: String(safeCssValue(scrimValue) || '#000'), opacity: Math.max(0, Math.min(1, scrimOpacity)) }} />}

    {Boolean(eyebrow) && <span className="json-eyebrow" style={styleEyebrow}>{eyebrow}</span>}
    {Boolean(title) && <h2 aria-label={access.label || node.aria_label} style={styleTitle}>{title}</h2>}
    {Boolean(body) && <p className="json-body" style={styleBody}>{body}</p>}
    {Boolean(text) && text !== body && <p className="json-text" style={styleText}>{text}</p>}
    {image && <img className="json-image" src={image} alt={alt} style={styleImage} loading={/hero/.test(identity) ? 'eager' : 'lazy'} />}
    {video && <video className="json-video" src={video} autoPlay muted loop playsInline />}
    {cta && (typeof cta === 'string' ? <a className="json-button" style={styleCta} href="#products">{cta}</a> : isObject(cta) && <a className="json-button" style={{ ...styleCta, ...toStyle(cta.style) }} href={safeHref(take(cta, 'href', 'url', 'target'), '#products')}>{String(resolveText(take(cta, 'label', 'text', 'title')) || 'Shop now')}</a>)}
    {extras.map(([key, value]) => <p key={key} className="json-extra" data-field={key}>{String(value)}</p>)}
    {nested.map(([key, value]) => <div key={key} style={['items','cards','columns','blocks'].includes(key) ? { display: 'contents' } : undefined} className={`json-nested json-nested-${key.replace(/[^a-z0-9]/gi, '-')}`}><GenericNode node={value} path={`${path}.${key}`} store={store} products={products} onOrder={onOrder} onView={onView} breakpoints={breakpoints} depth={depth + 1} /></div>)}
  </AnimatedBox>;
}

// A single broken section must never take the whole store down.
class SectionBoundary extends Component<{ children: React.ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('Store section safely recovered:', this.props.label, error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="store-section-safe"><p>This section is being restyled. Karibu — browse around.</p></div>;
  }
}

class StorefrontBoundary extends Component<{ children: React.ReactNode; store: Store; products: Product[]; onOrder: EngineProps['onOrder']; onView: EngineProps['onView'] }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('Store design safely recovered:', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="storefront-safe"><h1>{this.props.store.name}</h1><p>Karibu! Browse our products below.</p><ProductCollection node={{}} products={this.props.products} onOrder={this.props.onOrder} onView={this.props.onView} /></main>;
  }
}

export default function JsonStorefront({ store, products, onOrder, onView }: EngineProps) {
  const design = useMemo(() => normaliseDesign(store.design_json), [store.design_json]);
  const sections = useMemo(() => getSections(design), [design]);
  const global = take(design, 'global_ui', 'globalUI', 'site_chrome') || {};
  const announcement = take(global, 'announcement_bar', 'announcementBar', 'announcement', 'top_bar', 'topbar', 'ticker', 'notice_bar') || take(design, 'announcement_bar', 'announcement', 'top_bar', 'topbar', 'ticker', 'notice_bar');
  const header = take(global, 'header', 'navigation') || design.header || {};
  const footer = take(global, 'footer') || design.footer || {};
  const breakpoints = take(design, 'breakpoints', 'responsive_breakpoints') || take(design.theme || {}, 'breakpoints') || {};
  const [menu, setMenu] = useState(false);
  const fontUrls = useMemo(() => collectFontUrls(design), [design]);
  useEffect(() => {
    const links = fontUrls.map((href) => {
      const existing = document.querySelector(`link[href="${CSS.escape(href)}"]`);
      if (existing) return null;
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.stoyanguFont = 'true'; document.head.appendChild(link); return link;
    });
    return () => links.forEach((link) => link?.remove());
  }, [fontUrls]);
  const themeLogo = safeImage(take(design.theme || {}, 'logo_source', 'logo', 'brand_logo'));
  const headerLogo = store.logo_url || themeLogo;
  const navItems = asArray(take(header, 'navigation', 'nav', 'links', 'items'));
  const announcementParts = asArray(take(announcement || {}, 'segments', 'items', 'messages', 'text') ?? announcement);
  return <StorefrontBoundary store={store} products={products} onOrder={onOrder} onView={onView}>
    <div className="json-storefront" style={{ ...themeVariables(design), ...toStyle(take(design, 'style', 'global_style')) }}>
      {announcementParts.length > 0 && <div className="store-announcement" style={mergedStyle(isObject(announcement) ? announcement : {})}>{announcementParts.map((part, index) => <span key={index}>{String(isObject(part) ? take(part, 'text', 'label', 'message') || '' : part)}</span>)}</div>}
      <header className={`store-header ${header.sticky ? 'sticky' : ''}`} style={mergedStyle(header)}>
        <a href="#top" className="store-brand">{headerLogo ? <img src={headerLogo} alt={`${store.name} logo`} /> : <ShoppingBag />}<span>{store.name}</span></a>
        {navItems.length > 0 && <nav className="store-nav" aria-label="Store navigation">{navItems.map((item, index) => <a key={index} href={safeHref(take(isObject(item) ? item : {}, 'href', 'url'), `#${words(isObject(item) ? take(item, 'label', 'text') : item).toLowerCase().replace(/\s/g, '-')}`)}>{String(isObject(item) ? take(item, 'label', 'text', 'title') : item)}</a>)}</nav>}
        {navItems.length > 0 && <button className="store-menu-button" onClick={() => setMenu(!menu)} aria-label="Toggle menu">{menu ? <X /> : <Menu />}</button>}
        {menu && <nav className="store-mobile-nav">{navItems.map((item, index) => <a key={index} onClick={() => setMenu(false)} href={safeHref(take(isObject(item) ? item : {}, 'href', 'url'), '#products')}>{String(isObject(item) ? take(item, 'label', 'text', 'title') : item)}</a>)}</nav>}
      </header>
      <main id="top" className="store-sections">{sections.map((section, index) => <section id={String(section.id || section.name || `section-${index}`).toLowerCase().replace(/[^a-z0-9-]/g, '-')} key={`${section.id || 'section'}-${index}`} className="store-section"><SectionBoundary label={String(resolveText(take(section, 'title', 'headline', 'name', 'id')) || `section ${index + 1}`)}><GenericNode node={section} path={`sections.${index}`} store={store} products={products} onOrder={onOrder} onView={onView} breakpoints={breakpoints} /></SectionBoundary></section>)}</main>
      {Object.keys(footer).length > 0 && <footer className="store-json-footer"><GenericNode node={footer} path="footer" store={store} products={products} onOrder={onOrder} onView={onView} breakpoints={breakpoints} /></footer>}
      <a className="powered-stoyangu" href="https://stoyangu.com" target="_blank" rel="noreferrer"><img src="/stoyangu-logo.png" alt="StoYangu" /><span>Powered by StoYangu</span></a>
    </div>
  </StorefrontBoundary>;
}
