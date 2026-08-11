import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import {
  ArrowDown, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Clock3, Code2, Copy, Download,
  ExternalLink, Instagram, Mail, MapPin, Menu, MessageCircle, ShieldCheck, ShoppingBag,
  Sparkles, Star, Truck, X, type LucideIcon,
} from 'lucide-react';
import { CSSProperties, useEffect, useMemo, useState } from 'react';
import type { Product, Store } from '../types';
import { formatMoney } from '../lib/api';
import '../storefront.css';

type Obj = Record<string, any>;
type RendererProps = {
  store: Store;
  products: Product[];
  onOrder: (product: Product, color?: string, size?: string, fulfilment?: string, note?: string) => void;
  onView: (id: number) => void;
};

const ICONS: Record<string, LucideIcon> = {
  ArrowDown, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Clock3, Code2, Copy, Download,
  ExternalLink, Instagram, Mail, MapPin, Menu, MessageCircle, ShieldCheck, ShoppingBag,
  Sparkles, Star, Truck, X,
};
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const array = (value: unknown): any[] => Array.isArray(value) ? value : isObj(value) ? Object.entries(value).map(([id, item]) => isObj(item) ? { id, ...item } : { id, value: item }) : value == null ? [] : [value];
const get = (object: unknown, path: string) => path.split('.').reduce<any>((value, key) => isObj(value) ? value[key] : undefined, object);
const first = (object: Obj | undefined, ...keys: string[]) => keys.map((key) => object?.[key]).find((value) => value !== undefined && value !== null);
const label = (value: unknown) => String(value ?? '').replace(/[_-]+/g, ' ').trim();
const idSafe = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const safeUrl = (value: unknown) => {
  const url = String(value || '').trim();
  return /^\/(?!\/)/.test(url) || /^https:\/\//i.test(url) ? url : '';
};
const safeHref = (value: unknown, fallback = '#') => {
  const url = String(value || '').trim();
  return /^#[a-z0-9_-]+$/i.test(url) || /^\/(?!\/)/.test(url) || /^https:\/\//i.test(url) || /^(mailto|tel):[^\s]+$/i.test(url) ? url : fallback;
};
const safeCss = (value: unknown) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || /[{}<>]|javascript:|expression\s*\(/i.test(value)) return undefined;
  return value.slice(0, 700);
};

function parseDesign(raw: unknown): Obj {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!isObj(value)) return {};
    return JSON.parse(JSON.stringify(value).replaceAll('—', ',').replaceAll('–', '-'));
  } catch {
    return {};
  }
}

function token(design: Obj, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const direct = get(design, value);
  if (direct !== undefined) return direct;
  if (value.startsWith('theme.')) return get(design, value) ?? value;
  return value;
}

const cssAliases: Record<string, keyof CSSProperties> = {
  text_colour: 'color', text_color: 'color', colour: 'color', background_colour: 'backgroundColor',
  section_background: 'backgroundColor', panel_background: 'backgroundColor', card_background: 'backgroundColor',
  border_colour: 'borderColor', border_color: 'borderColor', box_shadow: 'boxShadow', border_radius: 'borderRadius',
  bottom_border: 'borderBottom', top_border: 'borderTop', panel_top_border: 'borderTop',
  panel_radius: 'borderRadius', button_radius: 'borderRadius',
  minimum_height: 'minHeight', minimum_width: 'minWidth', maximum_width: 'maxWidth', maximum_height: 'maxHeight',
  font_size: 'fontSize', font_weight: 'fontWeight', font_family: 'fontFamily', line_height: 'lineHeight',
  letter_spacing: 'letterSpacing', text_transform: 'textTransform', text_align: 'textAlign', image_fit: 'objectFit',
  backdrop_blur: 'backdropFilter', grid_template_columns: 'gridTemplateColumns', grid_template_rows: 'gridTemplateRows',
  grid_column: 'gridColumn', grid_row: 'gridRow', align_items: 'alignItems', justify_content: 'justifyContent',
  flex_direction: 'flexDirection', flex_wrap: 'flexWrap', z_index: 'zIndex', object_position: 'objectPosition',
};
const allowedCss = new Set(['display','position','inset','top','right','bottom','left','width','height','minHeight','maxHeight','minWidth','maxWidth','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','gap','rowGap','columnGap','color','background','backgroundColor','backgroundImage','border','borderTop','borderBottom','borderWidth','borderStyle','borderColor','borderRadius','boxShadow','opacity','overflow','overflowX','overflowY','zIndex','fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textAlign','textTransform','textDecoration','whiteSpace','gridTemplateColumns','gridTemplateRows','gridColumn','gridRow','alignItems','justifyContent','justifyItems','flex','flexDirection','flexWrap','order','objectFit','objectPosition','aspectRatio','transform','filter','backdropFilter','cursor']);
const camel = (key: string) => key.replace(/[-_]([a-z])/g, (_, char) => char.toUpperCase());

function toStyle(source: unknown, design: Obj): CSSProperties {
  if (!isObj(source)) return {};
  const out: Record<string, string | number> = {};
  Object.entries(source).forEach(([raw, original]) => {
    let key = String(cssAliases[raw] || camel(raw));
    if (raw === 'radius') key = 'borderRadius';
    if (raw === 'image_radius') key = 'borderRadius';
    if (raw === 'desktop_padding' || raw === 'outer_padding' || raw === 'section_padding') key = 'padding';
    if (raw === 'desktop_minimum_height' || raw === 'desktop_min_height') key = 'minHeight';
    if (raw === 'desktop_width') key = 'width';
    if (raw === 'desktop_max_height') key = 'maxHeight';
    if (!allowedCss.has(key)) return;
    let value = token(design, original);
    if (key === 'backdropFilter' && typeof value === 'string' && !value.includes('blur(')) value = `blur(${value})`;
    const safe = safeCss(value);
    if (safe !== undefined) out[key] = safe;
  });
  return out as CSSProperties;
}

function mergedStyle(design: Obj, ...sources: unknown[]): CSSProperties {
  return Object.assign({}, ...sources.map((source) => toStyle(source, design)));
}

function Icon({ name, size = 18 }: { name?: unknown; size?: number }) {
  const Component = ICONS[String(name || '')] || Sparkles;
  return <Component size={size} aria-hidden="true" />;
}

function stateToMotion(state: unknown): Obj | undefined {
  if (!isObj(state)) return undefined;
  const result: Obj = {};
  Object.entries(state).forEach(([key, value]) => {
    const mapped = key === 'translate_y_px' ? 'y' : key === 'translate_x_px' ? 'x' : key === 'rotate_deg' ? 'rotate' : key;
    result[mapped] = value;
  });
  return result;
}

function findAnimation(design: Obj, node: Obj, preferred?: string): Obj {
  const animations = isObj(design.animations) ? design.animations : {};
  const references = [preferred, node.animation_reference, ...array(node.animations_used)].filter(Boolean).map(String);
  for (const reference of references) {
    const found = animations[reference];
    if (isObj(found)) {
      const inherited = typeof found.animation === 'string' && isObj(animations[found.animation]) ? animations[found.animation] : {};
      return { ...inherited, ...found };
    }
  }
  const own = first(node, 'motion', 'animation');
  return isObj(own) ? own : {};
}

function animationProps(design: Obj, node: Obj, preferred: string | undefined, reduced: boolean, index = 0) {
  if (reduced) return { initial: false };
  const spec = findAnimation(design, node, preferred);
  const initial = stateToMotion(first(spec, 'initial', 'incoming', 'start'));
  const animate = stateToMotion(first(spec, 'animate', 'active', 'end'));
  const duration = Number(first(spec, 'duration_seconds', 'duration') || (Number(spec.duration_ms) / 1000) || .72);
  const parsedStagger = typeof spec.stagger_rule === 'string' ? Number(spec.stagger_rule.match(/(0?\.\d+)\s*seconds?/)?.[1] || 0) : 0;
  const stagger = Number(first(spec, 'stagger_seconds', 'item_stagger_seconds', 'stagger') || parsedStagger || 0);
  const delay = Number(first(spec, 'delay_seconds', 'delay') || (Number(spec.delay_ms) / 1000) || 0) + index * stagger;
  const ease = first(spec, 'easing', 'ease') || first(design.animations, 'default_easing') || [0.16, 1, 0.3, 1];
  const repeat = spec.repeat === 'infinite' || spec.repeat === true ? Infinity : Number(spec.repeat || 0);
  const keyframeMotion: Obj = {};
  if (Array.isArray(spec.keyframes_y_px)) keyframeMotion.y = spec.keyframes_y_px;
  if (Array.isArray(spec.keyframes_x_px)) keyframeMotion.x = spec.keyframes_x_px;
  if (Array.isArray(spec.keyframes_scale)) keyframeMotion.scale = spec.keyframes_scale;
  if (Array.isArray(spec.keyframes_opacity)) keyframeMotion.opacity = spec.keyframes_opacity;
  if (Object.keys(keyframeMotion).length) return { initial: false, animate: keyframeMotion, transition: { duration, delay, ease, repeat: repeat || Infinity } };
  const transition = { duration, delay, ease, repeat, repeatType: spec.repeat_type || 'loop' };
  const exit = stateToMotion(spec.exit || spec.outgoing);
  if (repeat === Infinity || spec.starts_on === 'page load' || spec.trigger === 'page load') return { initial: initial || false, animate, exit, transition };
  return { initial: initial || (animate ? { opacity: 0 } : undefined), whileInView: animate, exit, viewport: { once: spec.repeat !== true, amount: Number(spec.viewport_amount || .15) }, transition };
}

function Reveal({ design, node, animation, index = 0, className = '', style, children }: { design: Obj; node: Obj; animation?: string; index?: number; className?: string; style?: CSSProperties; children: React.ReactNode }) {
  const reduced = Boolean(useReducedMotion());
  return <motion.div className={className} style={style} {...animationProps(design, node, animation, reduced, index)}>{children}</motion.div>;
}

function themeVars(design: Obj): CSSProperties {
  const theme = isObj(design.theme) ? design.theme : design;
  const colours = first(theme, 'colours', 'colors', 'palette') || first(design, 'colours', 'colors') || {};
  const typography = isObj(theme.typography) ? theme.typography : {};
  const out: Obj = {};
  if (isObj(colours)) Object.entries(colours).forEach(([key, value]) => {
    const safe = safeCss(isObj(value) ? value.value : value);
    if (safe !== undefined) out[`--sj-${idSafe(key)}`] = safe;
  });
  const primary = first(colours, 'primary', 'brand_blue', 'brand', 'accent') || '#5A966E';
  const accent = first(colours, 'accent', 'brand_red', 'secondary') || primary;
  let background = first(colours, 'canvas', 'background', 'surface', 'white') || '#FFFDF7';
  let ink = first(colours, 'ink', 'text', 'foreground', 'navy_deep') || '#17261F';
  // Specs that declare dark mode but leave a light canvas: honour the mode.
  const modeDark = /dark|night|black/i.test(String((isObj(theme) && (theme.mode || theme.name)) || ''));
  const looksLight = /^\s*#((f[de]|e[89def])([0-9a-f]){5})|white|ivory|cream/i.test(String(background));
  if (modeDark && looksLight) {
    background = first(colours, 'background_dark', 'night', 'concrete_grey', 'charcoal', 'dark', 'primary') || '#0B0D0F';
    if (/^\s*#(1[0-3][0-9a-f]|2[0-4][0-9a-f])|#111|#101|#172|#0/i.test(String(ink))) ink = first(colours, 'heading_light', 'off_white', 'primary_foreground') || '#F5F3EF';
  }
  const muted = first(colours, 'muted', 'subtle') || '#6B776F';
  out['--sj-primary'] = safeCss(primary); out['--sj-accent'] = safeCss(accent); out['--sj-bg'] = safeCss(background); out['--sj-ink'] = safeCss(ink); out['--sj-muted'] = safeCss(muted);
  out['--sj-body-font'] = safeCss(first(typography, 'body_family', 'body_font', 'everything_else_font') || typography.body?.family || 'Inter, sans-serif');
  out['--sj-display-font'] = safeCss(first(typography, 'display_family', 'headings_font', 'heading_font') || typography.hero_heading?.family || 'Inter, sans-serif');
  return out as CSSProperties;
}

function useDesignFonts(design: Obj) {
  useEffect(() => {
    const stack: unknown[] = [design.theme, design.typography];
    const urls = new Set<string>();
    while (stack.length) {
      const item = stack.pop();
      if (Array.isArray(item)) item.forEach((value) => stack.push(value));
      else if (isObj(item)) Object.entries(item).forEach(([key, value]) => {
        if (/font.*url|import.*url/i.test(key) && typeof value === 'string' && /^https:\/\/(fonts\.googleapis\.com|fonts\.bunny\.net)/i.test(value)) urls.add(value);
        else if (typeof value === 'object') stack.push(value);
      });
    }
    const created = [...urls].slice(0, 6).map((href) => {
      if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) return null;
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.storeFont = 'true'; document.head.appendChild(link); return link;
    });
    return () => created.forEach((link) => link?.remove());
  }, [design]);
}

function resolveLogo(config: Obj | undefined, store: Store) {
  if (config?.is_store_logo || config?.is_store_logo_mark || config?.database_field || config?.system_logo_key) return store.logo_url || safeUrl(first(config, 'image', 'logo_image', 'icon_image'));
  return safeUrl(first(config, 'image', 'logo_image', 'icon_image')) || store.logo_url;
}

function ScrollProgress({ design }: { design: Obj }) {
  const config = design.global_ui?.scroll_progress;
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: Number(design.animations?.scroll_progress?.stiffness || 120), damping: Number(design.animations?.scroll_progress?.damping || 30), restDelta: .001 });
  if (!config?.visible) return null;
  return <motion.div className="sj-scroll-progress" style={{ scaleX, height: safeCss(config.height), background: safeCss(config.colour) }} />;
}

function Announcement({ config }: { config: Obj }) {
  const enabled = first(config, 'visible', 'enabled', 'show');
  if (enabled === false || (typeof enabled === 'string' && enabled.trim().toLowerCase() === 'false')) return null;
  const segments = array(first(config, 'segments', 'items', 'messages'));
  const primary = first(config, 'primary_text', 'text', 'message', 'content');
  const secondary = first(config, 'secondary_text', 'secondary');
  const marquee = Boolean(first(config, 'marquee_speed', 'marquee', 'ticker'));
  const body = <>{segments.length ? segments.map((item, index) => <span key={index} className={marquee ? 'sj-marquee-item' : ''}>{String(isObj(item) ? first(item, 'text', 'label', 'message') || '' : item)}</span>) : <><span className={marquee ? 'sj-marquee-item' : ''}>{String(primary || '')}</span>{secondary && <><i /><span className={marquee ? 'sj-marquee-item sj-announcement-secondary' : 'sj-announcement-secondary'}>{String(secondary)}</span></>}</>}</>;
  return <div className={`sj-announcement ${marquee ? 'sj-announcement--marquee' : ''}`} style={{ ...toStyle(config, {}), height: safeCss(config.height), borderBottom: safeCss(config.bottom_border) }}>
    {marquee ? <div className="sj-marquee-track" style={{ animationDuration: String(marquee).match(/\d+/) ? `${Number(String(marquee).match(/\d+/))}s` : '28s' }}><div className="sj-marquee-group">{body}</div><div className="sj-marquee-group" aria-hidden="true">{body}</div></div> : body}
  </div>;
}

function Header({ design, store, onSectionNavigate }: { design: Obj; store: Store; onSectionNavigate?: (target: string) => void }) {
  const config = isObj(design.global_ui?.header) ? design.global_ui.header : {};
  const menuConfig = isObj(design.global_ui?.mobile_menu) ? design.global_ui.mobile_menu : {};
  const [open, setOpen] = useState(false);
  const navLocal = array(first(config, 'navigation', 'nav', 'links'));
  const navGroup = first(design.global_ui, 'navigation', 'nav');
  const nav = navLocal.length ? navLocal : isObj(navGroup) ? array(first(navGroup, 'links', 'items')) : array(navGroup);
  const shopUIKeys = first(design.global_ui, 'shop_now_button', 'shop_button', 'primary_action');
  const shopConfig = isObj(shopUIKeys) ? shopUIKeys : {};
  const menuItems = array(first(menuConfig, 'items', 'navigation'));
  const logoConfig = isObj(config.logo) ? config.logo : { image: config.logo_image, is_store_logo: true };
  const logo = resolveLogo(logoConfig, store);
  const shop = isObj(config.shop_now_button) && Object.keys(config.shop_now_button).length ? config.shop_now_button : shopConfig;
  const handleSection = (event: React.MouseEvent<HTMLAnchorElement>, target: string) => { if (onSectionNavigate) { event.preventDefault(); onSectionNavigate(target); } };
  return <>
    <header className={`sj-header ${config.position === 'sticky' || config.sticky ? 'is-sticky' : ''}`} style={mergedStyle(design, config)}>
      <a className="sj-store-logo" href="#home" onClick={(event) => handleSection(event, '#home')} aria-label={`${store.name} home`}>{logo ? <img src={logo} alt={String(logoConfig.alt || `${store.name} logo`)} style={{ height: safeCss(logoConfig.display_height) }} /> : <><ShoppingBag /><strong>{String(design.store_name || store.name)}</strong></>}</a>
      <nav className="sj-desktop-nav" aria-label="Store navigation">{nav.map((item, index) => { const entry = isObj(item) ? item : { label: item }; const target = safeHref(first(entry, 'target', 'href', 'url'), `#${idSafe(entry.label)}`); return <a key={index} href={target} onClick={(event) => handleSection(event, target)}>{String(first(entry, 'label', 'text', 'title') || '')}</a>; })}</nav>
      {Object.keys(shop).length > 0 && <a className="sj-header-shop" href={safeHref(first(shop, 'target', 'href'), '#products')} onClick={(event) => handleSection(event, safeHref(first(shop, 'target', 'href'), '#products'))} style={mergedStyle(design, shop)}>{String(shop.label || 'Shop now')}<Icon name={shop.icon || 'ArrowRight'} size={16} /></a>}
      <button className="sj-menu-trigger" onClick={() => setOpen(true)} aria-label={String(config.mobile_menu_button?.aria_label || 'Open menu')}><Menu /></button>
    </header>
    <AnimatePresence>{open && <motion.div className="sj-menu-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><motion.aside className="sj-mobile-menu" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: .5, ease: [0.16, 1, 0.3, 1] }} style={mergedStyle(design, menuConfig)}>
      <div className="sj-mobile-menu-head">{resolveLogo(menuConfig, store) ? <img src={resolveLogo(menuConfig, store)} alt={`${store.name} logo`} /> : <strong>{store.name}</strong>}<button onClick={() => setOpen(false)} aria-label="Close menu"><X /></button></div>
      <nav>{(menuItems.length ? menuItems : nav).map((item, index) => { const entry = isObj(item) ? item : { label: item, target: `#${idSafe(item)}` }; const menuMotion = design.animations?.mobile_menu || {}; const target = safeHref(first(entry, 'target', 'href'), '#products'); return <motion.a key={index} initial={{ opacity: Number(menuMotion.item_initial_opacity ?? 0), x: Number(menuMotion.item_initial_translate_x_px ?? -30) }} animate={{ opacity: Number(menuMotion.item_active_opacity ?? 1), x: Number(menuMotion.item_active_translate_x_px ?? 0) }} transition={{ delay: index * Number(menuMotion.item_stagger_seconds || .06), duration: .45 }} href={target} onClick={(event) => { setOpen(false); handleSection(event, target); }}><span>{String(index + 1).padStart(2, '0')}</span><strong>{String(first(entry, 'label', 'text') || '')}</strong><ArrowRight /></motion.a>; })}</nav>
      <a className="sj-menu-action" href={safeHref(menuConfig.bottom_action_target, '#products')} onClick={(event) => { setOpen(false); handleSection(event, safeHref(menuConfig.bottom_action_target, '#products')); }}>{String(menuConfig.bottom_action_label || 'Shop now')}<ArrowRight /></a>
    </motion.aside></motion.div>}</AnimatePresence>
  </>;
}

function Slideshow({ visual, design }: { visual: Obj; design: Obj }) {
  const slides = array(first(visual, 'slides', 'images', 'items'));
  const [index, setIndex] = useState(0);
  const reduced = Boolean(useReducedMotion());
  const config = isObj(design.animations?.hero_slideshow) ? design.animations.hero_slideshow : {};
  const interval = Number(first(config, 'auto_advance_interval_ms') || Number(first(visual, 'auto_advance_timing', 'interval') || 5.8) * 1000);
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % slides.length), Math.max(1500, interval));
    return () => clearInterval(timer);
  }, [slides.length, interval]);
  if (!slides.length) return null;
  const slide = isObj(slides[index]) ? slides[index] : { image: slides[index] };
  return <div className="sj-hero-slideshow" style={{ ...toStyle(visual, design), minHeight: safeCss(first(visual, 'desktop_minimum_height', 'minimum_height')) }}>
    {(visual.side_ribbon || visual.vertical_label || visual.ribbon) && <em className="sj-side-ribbon">{String(first(visual, 'side_ribbon', 'vertical_label', 'ribbon'))}</em>}
    {visual.brand_motif && <motion.i className="sj-stadium-ring" aria-hidden="true" animate={reduced ? undefined : { rotate: [34, 39, 34], scale: [1, 1.035, 1] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />}
    <AnimatePresence mode="wait"><motion.figure key={index} initial={stateToMotion(config.incoming) || { opacity: 0, scale: 1.03 }} animate={stateToMotion(config.active) || { opacity: 1, scale: 1 }} exit={stateToMotion(config.outgoing) || { opacity: 0 }} transition={{ duration: Number(config.duration_seconds || .8), ease: config.easing || [0.16, 1, 0.3, 1] }}>
      <img src={safeUrl(first(slide, 'image', 'src', 'url'))} alt={String(slide.alt || slide.label || '')} fetchPriority={index === 0 ? 'high' : 'auto'} decoding="async" />
      {first(slide, 'price_label', 'price_chip', 'price') && <b className="sj-slide-chip">{String(first(slide, 'price_label', 'price_chip', 'price'))}</b>}
      {slide.label && <figcaption><small>{String(visual.current_story_label || 'Current story')} · {String(index + 1).padStart(visual.slide_number_format === 'two_digit' ? 2 : 1, '0')}</small><strong>{String(slide.label)}</strong></figcaption>}
    </motion.figure></AnimatePresence>
    {slides.length > 1 && <><div className="sj-slide-arrows"><button onClick={() => setIndex((index - 1 + slides.length) % slides.length)} aria-label="Previous slide"><ChevronLeft /></button><button onClick={() => setIndex((index + 1) % slides.length)} aria-label="Next slide"><ChevronRight /></button></div><div className="sj-slide-dots">{slides.map((_, itemIndex) => <button key={itemIndex} aria-label={`Show slide ${itemIndex + 1}`} className={itemIndex === index ? 'active' : ''} onClick={() => setIndex(itemIndex)} />)}</div></>}
  </div>;
}

function HeroSection({ section, design, store }: { section: Obj; design: Obj; store: Store }) {
  const reduced = Boolean(useReducedMotion());
  const suppliedVisual = isObj(first(section, 'hero_visual', 'visual', 'media', 'slideshow', 'hero_media', 'media_gallery', 'gallery', 'spotlight')) ? first(section, 'hero_visual', 'visual', 'media', 'slideshow', 'hero_media', 'media_gallery', 'gallery', 'spotlight') : {};
  const visual = Object.keys(suppliedVisual).length ? suppliedVisual : safeUrl(first(section, 'image', 'image_url', 'photo')) ? { slides: [{ image: first(section, 'image', 'image_url', 'photo'), alt: section.alt || section.headline }] } : {};
  const hasVisual = array(first(visual, 'slides', 'images', 'items')).length > 0;
  // Full-bleed heroes, but ONLY when the spec explicitly calls for that treatment
  // (never hijack a working split hero like Pizzaro's).
  const intentSignal = [String(first(section, 'presentation', 'treatment', 'hero_mode', 'display_mode') || ''), String(isObj(visual) ? visual.presentation || visual.treatment || '' : ''), String(design.theme?.mode || ''), String(design.theme?.name || ''), String(design.design_scope?.specification_type || '')].join(' ').toLowerCase();
  const specImage = array(first(visual, 'slides', 'images', 'items'))[0];
  const heroImg = safeUrl(isObj(specImage) ? first(specImage, 'image', 'src', 'url') : specImage) || safeUrl(first(section, 'background_image', 'image', 'image_url', 'backdrop', 'cover_image', 'photo'));
  // Full-bleed only when the spec asks for it AND the hero built no slideshow of its own
  // (a slideshow means split layout was intended — never flatten it).
  const wantsFullbleed = !hasVisual && /full.?bleed|immersive|edge.to.edge|background/.test(intentSignal) && Boolean(heroImg);
  const heroStyle = mergedStyle(design, section.layout, section.style);
  if (wantsFullbleed && heroImg) { heroStyle.backgroundImage = `url("${heroImg}")`; heroStyle.backgroundSize = 'cover'; heroStyle.backgroundPosition = 'center'; }
  const lines = array(section.headline_lines);
  const actions = array(first(section, 'actions', 'buttons', 'ctas', 'cta_stack', 'links'));
  const badge = isObj(section.badge) ? section.badge : {};
  const promo = isObj(section.floating_promo) ? section.floating_promo : {};
  return <section id={idSafe(section.id || 'home')} className={`sj-section sj-hero ${hasVisual && !wantsFullbleed ? '' : 'no-visual'} ${wantsFullbleed ? 'sj-hero--fullbleed' : ''}`} style={heroStyle}>{wantsFullbleed && <i className="sj-hero-veil" aria-hidden="true" />}
    {section.background_watermark?.text && <span className="sj-watermark" style={mergedStyle(design, section.background_watermark)}>{String(section.background_watermark.text)}</span>}
    <div className="sj-hero-copy">
      {Object.keys(badge).length > 0 && <Reveal design={design} node={badge} animation="hero_badge_reveal" className="sj-hero-badge" style={mergedStyle(design, badge)}><span style={{ background: safeCss(badge.icon_background) }}>{resolveLogo(badge, store) ? <img src={resolveLogo(badge, store)} alt="" /> : <Icon name={badge.icon} size={14} />}</span>{String(badge.text || '')}</Reveal>}
      <Reveal design={design} node={section} animation="hero_heading_reveal"><h1>{lines.length ? lines.map((line, index) => { const tone = String(line.style || ''); const ckls = [tone.includes('accent') ? 'accent' : '', /outline|ghost|stroke/.test(tone) ? 'sj-outline-word' : ''].filter(Boolean).join(' '); return <span key={index} className={ckls || undefined}>{String(line.text || line)}</span>; }) : String(section.headline || section.heading || design.store_name || store.name)}</h1></Reveal>
      {(section.tagline || section.body || section.intro) && <Reveal design={design} node={section} animation="hero_tagline_reveal"><p className="sj-hero-tagline">{String(first(section, 'tagline', 'body', 'intro'))}</p></Reveal>}
      {actions.length > 0 && <Reveal design={design} node={section} animation="hero_actions_reveal" className="sj-hero-actions">{actions.map((action, index) => { const entry = isObj(action) ? action : { label: action }; const buttons = design.global_ui?.buttons || {}; const entryStyle = entry.style || entry.variant || 'primary'; return <a key={index} className={`sj-action ${entryStyle}`} style={mergedStyle(design, buttons.base, buttons[entryStyle], entry)} href={safeHref(first(entry, 'target', 'href', 'scroll_to'), '#products')}><span>{String(entry.label || entry.text || '')}</span><Icon name={entry.icon || 'ArrowRight'} /></a>; })}</Reveal>}
      {array(section.proof_points).some((pill) => isObj(pill) && pill.value != null) && <div className="sj-stat-row">{array(section.proof_points).filter((pill) => isObj(pill) && pill.value != null).map((pill, index) => <div className="sj-stat-card" key={index}><strong>{String(pill.value)}</strong><span>{String(pill.label || '')}</span>{pill.sub && <small>{String(pill.sub)}</small>}</div>)}</div>}
      {array(first(section, 'feature_text', 'features', 'trust_points', 'highlights', 'proof_points', 'usp', 'spec_cards')).length > 0 && <div className="sj-hero-features">{array(first(section, 'feature_text', 'features', 'trust_points', 'highlights', 'proof_points', 'usp', 'spec_cards')).map((item, index) => <span key={index}><Icon name={isObj(item) ? item.icon : undefined} size={15} />{String(isObj(item) ? item.text || [item.title, item.desc].filter(Boolean).join(' — ') || item.headline || item.label || '' : item)}</span>)}</div>}
    </div>
    {hasVisual && !wantsFullbleed && <Reveal design={design} node={visual} animation="hero_slideshow" className="sj-hero-visual">
      <Slideshow visual={visual} design={design} />
      {Object.keys(promo).length > 0 && <motion.div className="sj-floating-promo" style={mergedStyle(design, promo)} animate={reduced ? undefined : { y: [0, -8, 0] }} transition={{ duration: Number(design.animations?.floating_new_drop_note?.duration_seconds || 4), repeat: Infinity, ease: 'easeInOut' }}><span style={{ background: safeCss(promo.icon_background) }}>{resolveLogo(promo, store) ? <img src={resolveLogo(promo, store)} alt="" /> : <Sparkles />}</span><div><strong>{String(promo.title || '')}</strong><small>{String(promo.body || '')}</small></div></motion.div>}
    </Reveal>}
  </section>;
}

function CategoriesSection({ section, design, onSelect }: { section: Obj; design: Obj; onSelect: (category: string) => void }) {
  const categories = array(first(section, 'store_categories', 'categories', 'items', 'cards'));
  const cardDesign = isObj(section.card_design) ? section.card_design : {};
  return <section id={idSafe(section.id || 'categories')} className="sj-section sj-categories" style={mergedStyle(design, section.layout, section.style)}>
    <Reveal design={design} node={section} animation="section_reveal" className="sj-section-heading"><span>{String(section.eyebrow || '')}</span><h2>{String(first(section, 'headline', 'heading', 'title') || 'Categories')}</h2>{section.intro && <p>{String(section.intro)}</p>}</Reveal>
    <div className="sj-category-grid" style={{ gridAutoRows: safeCss(section.layout?.desktop_grid_row_height) }}>{categories.map((category, index) => { const entry = isObj(category) ? category : { name: category }; return <Reveal key={index} design={design} node={entry} animation="category_card_reveal" index={index} className={`sj-category-card sj-category-${index + 1}`} style={mergedStyle(design, cardDesign, entry.style)}>
      <button onClick={() => { onSelect(String(first(entry, 'product_filter_target', 'name', 'title') || 'All')); document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' }); }} aria-label={`Shop ${String(entry.name || entry.title || '')}`}>
        {safeUrl(entry.image) && <img src={safeUrl(entry.image)} alt={String(entry.alt || entry.name || entry.title || '')} />}
        <span className="sj-category-number">{String(index + 1).padStart(2, '0')}</span><div>{entry.count && <small className="sj-category-count">{String(entry.count)}</small>}<small>{String(first(entry, 'tagline', 'note', 'description') || '')}</small><strong>{String(entry.name || entry.title || '')}</strong>{array(entry.spec_pills).length > 0 && <i className="sj-spec-pills">{array(entry.spec_pills).map((pill, p) => <em key={p}>{String(isObj(pill) ? pill.text || pill.label || '' : pill).replace(/^[\[\]"']+|[\[\]"']+$/g, '')}</em>)}</i>}<ArrowRight /></div>
      </button>
    </Reveal>; })}</div>
  </section>;
}

function colourValue(value: string) {
  if (/^#|^rgb|^hsl/i.test(value)) return value;
  const known: Record<string, string> = { black:'#111827',white:'#ffffff',navy:'#172554',green:'#4d7c5b',red:'#dc2626',blue:'#2563eb',pink:'#ec4899',brown:'#795548',beige:'#d6c6a5',gold:'#d4a94c',cream:'#f5edda',sage:'#9caf88',mocha:'#8b6f61',olive:'#6b7245',terracotta:'#c66b4e',sky:'#87ceeb',peach:'#f4a58a',grey:'#6b7280',gray:'#6b7280'};
  return known[value.toLowerCase()] || `hsl(${[...value].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360} 38% 52%)`;
}

function ProductPageDetails({ product, config, design, onClose, onOrder }: { product: Product; config: Obj; design: Obj; onClose: () => void; onOrder: RendererProps['onOrder'] }) {
  const [size, setSize] = useState(product.sizes?.includes('M') ? 'M' : product.sizes?.[0] || '');
  const [colour, setColour] = useState(product.colors?.[0] || '');
  const [fulfilment, setFulfilment] = useState('Delivery');
  const [orderNote, setOrderNote] = useState('');
  const media = product.images?.length ? product.images.slice(0, 7) : [product.image_url].filter(Boolean);
  const [activeImage, setActiveImage] = useState(media[0] || '/stoyangu-logo.png');
  const dialog = isObj(config.dialog) ? config.dialog : {};
  return <section className="sj-product-page-detail" aria-label={product.name}>
    <button className="sj-product-back" onClick={onClose}><ArrowLeft /> Back to all products</button>
    <motion.div className="sj-product-page-grid" style={{ background: String(safeCss(dialog.background) || '#FFFFFF'), borderRadius: safeCss(dialog.radius), boxShadow: String(safeCss(dialog.box_shadow) || '') }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: Number(design.animations?.product_modal?.duration_seconds || .5), ease: design.animations?.product_modal?.easing || [0.16, 1, 0.3, 1] }}>
      <div className="sj-modal-media" style={mergedStyle(design, config.media_panel)}><AnimatePresence mode="wait"><motion.img key={activeImage} src={activeImage} alt={product.name} initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: .35 }} /></AnimatePresence>{media.length > 1 && <div className="sj-modal-thumbnails">{media.map((image, index) => <button key={image} className={activeImage === image ? 'active' : ''} onClick={() => setActiveImage(image)} aria-label={`Show product photo ${index + 1}`}><img src={image} alt="" /></button>)}</div>}</div>
      <div className="sj-modal-content" style={mergedStyle(design, config.content_panel)}><span className="sj-modal-category">{product.category}{config.category_suffix ? ` / ${config.category_suffix}` : ''}</span><h2>{product.name}</h2><strong className="sj-modal-price">{formatMoney(product.price)}</strong>
        {product.sizes?.length > 0 && config.size_selector?.visible !== false && <fieldset className="sj-variant"><div><legend>{String(config.size_selector?.label || 'Select size')}</legend><small>{String(config.size_selector?.helper || '')}</small></div><div>{product.sizes.map((item) => <button type="button" className={size === item ? 'selected' : ''} key={item} onClick={() => setSize(item)} aria-pressed={size === item}>{item}</button>)}</div></fieldset>}
        {product.colors?.length > 0 && config.colour_selector?.visible !== false && <fieldset className="sj-variant colours"><div><legend>{String(config.colour_selector?.label || 'Colour')}</legend><small>{colour || String(config.colour_selector?.helper || '')}</small></div><div>{product.colors.map((item) => <button type="button" className={colour === item ? 'selected' : ''} key={item} style={{ background: colourValue(item) }} onClick={() => setColour(item)} aria-label={`Choose ${item}`} aria-pressed={colour === item}>{colour === item && <Check />}</button>)}</div></fieldset>}
        <fieldset className="sj-fulfilment"><legend>How would you like to receive it?</legend><div><button type="button" className={fulfilment === 'Delivery' ? 'selected' : ''} onClick={() => setFulfilment('Delivery')}>Delivery</button><button type="button" className={fulfilment === 'In-store pickup' ? 'selected' : ''} onClick={() => setFulfilment('In-store pickup')}>In-store pickup</button></div><label>Delivery or order note<textarea value={orderNote} onChange={(event) => setOrderNote(event.target.value)} maxLength={300} placeholder={fulfilment === 'Delivery' ? 'Estate, building, landmark or delivery instructions' : 'Add the time you would like to collect, if known'} /></label></fieldset>
        {config.delivery_note?.visible !== false && config.delivery_note && <div className="sj-delivery-note" style={mergedStyle(design, config.delivery_note)}><Icon name={config.delivery_note.icon || 'Truck'} /><div><strong>{String(config.delivery_note.title || '')}</strong><span>{String(config.delivery_note.body || '')}</span></div></div>}
        <button className="sj-modal-order" style={{ background: safeCss(config.order_background || '#19A45B') }} onClick={() => onOrder(product, colour, size, fulfilment, orderNote)}><MessageCircle /><span>{String(config.only_order_action || 'Order on WhatsApp')}</span><ArrowRight /></button>
        {config.order_note && <p className="sj-order-note">{String(config.order_note)}</p>}
      </div>
    </motion.div>
  </section>;
}

function ProductsSection({ section, design, products, selectedCategory, setSelectedCategory, onSelectProduct, onView }: { section: Obj; design: Obj; products: Product[]; selectedCategory: string; setSelectedCategory: (value: string) => void; onSelectProduct: (product: Product) => void; onView: RendererProps['onView'] }) {
  const reduced = Boolean(useReducedMotion());
  const card = isObj(section.product_card) ? section.product_card : {};
  const liveCategories = [...new Set(products.map((product) => product.category).filter(Boolean))];
  const configured = array(section.filter_labels).map(String);
  const filters = ['All', ...configured.filter((item) => !/^all/i.test(item) && liveCategories.some((category) => category.toLowerCase() === item.toLowerCase())), ...liveCategories.filter((item) => !configured.some((labelValue) => labelValue.toLowerCase() === item.toLowerCase()))];
  const visible = selectedCategory === 'All' ? products : products.filter((product) => product.category.toLowerCase() === selectedCategory.toLowerCase());
  const openProduct = (product: Product) => { onView(product.id); onSelectProduct(product); };
  return <section id={idSafe(section.id || 'products')} className="sj-section sj-products" style={mergedStyle(design, section.layout, section.style)}>
    <Reveal design={design} node={section} animation="section_reveal" className="sj-section-heading center"><span>{String(section.eyebrow || '')}</span><h2>{String(first(section, 'headline', 'heading', 'title') || 'Products')}</h2>{section.intro && <p>{String(section.intro)}</p>}</Reveal>
    {filters.length > 1 && <div className="sj-product-filters" role="tablist" aria-label="Product categories">{filters.map((filter) => <button role="tab" aria-selected={selectedCategory === filter} className={selectedCategory === filter ? 'active' : ''} key={filter} onClick={() => setSelectedCategory(filter)}>{filter === 'All' ? String(configured.find((item) => /^all/i.test(item)) || 'All') : filter}</button>)}</div>}
    <AnimatePresence mode={design.animations?.product_filter_transition?.presence_mode === 'popLayout' ? 'popLayout' : 'sync'}><motion.div layout key={selectedCategory} className="sj-product-grid" initial={stateToMotion(design.animations?.product_filter_transition?.incoming)} animate={stateToMotion(design.animations?.product_filter_transition?.active)} exit={stateToMotion(design.animations?.product_filter_transition?.outgoing)} transition={{ duration: Number(design.animations?.product_filter_transition?.duration_seconds || .45) }}>{visible.map((product, index) => <motion.article layout key={product.id} className="sj2-product-card" style={mergedStyle(design, card)} {...animationProps(design, section, 'product_filter_transition', reduced, index)}>
      <button className="sj-product-card-main" onClick={() => openProduct(product)} aria-label={`View ${product.name}`}><div className="sj2-product-image" style={{ borderRadius: safeCss(card.image_radius) }}><img src={product.images?.[0] || product.image_url || '/stoyangu-logo.png'} alt={product.name} loading="lazy" /><span>{String(index + 1).padStart(2, '0')}</span>{(product.images?.length || 0) > 1 && <small>{product.images.length} photos</small>}</div><div className="sj2-product-copy"><small>{product.category}</small><h3>{product.name}</h3><strong>{formatMoney(product.price)}</strong><span className="sj-view-product">{String(card.only_action || 'View product')}<Icon name={card.action_icon || 'ArrowRight'} /></span></div></button>
    </motion.article>)}</motion.div></AnimatePresence>
    {!visible.length && <div className="sj-products-empty"><ShoppingBag /><h3>No products in this category yet.</h3><button onClick={() => setSelectedCategory('All')}>View all products</button></div>}
  </section>;
}

function SimilarProducts({ current, products, onSelect }: { current: Product; products: Product[]; onSelect: (product: Product) => void }) {
  const related = [...products.filter((product) => product.id !== current.id && product.category === current.category), ...products.filter((product) => product.id !== current.id && product.category !== current.category)].slice(0, 4);
  if (!related.length) return null;
  return <section className="sj-similar-products"><span>Keep browsing</span><h2>Similar products</h2><div>{related.map((product) => <article key={product.id}><button onClick={() => onSelect(product)}><img src={product.images?.[0] || product.image_url} alt={product.name} loading="lazy" /><small>{product.category}</small><strong>{product.name}</strong><b>{formatMoney(product.price)}</b><em>View product <ArrowRight /></em></button></article>)}</div></section>;
}

function ContactSection({ section, design }: { section: Obj; design: Obj }) {
  const reduced = Boolean(useReducedMotion());
  let contacts = array(first(section, 'contact_items', 'details', 'items'));
  if (!contacts.length) {
    const implied: Obj[] = [];
    const push = (icon: string, labelText: string, value: unknown, url?: string) => {
      const text = typeof value === 'string' ? value : isObj(value) ? String(first(value, 'value', 'text', 'display') || '') : '';
      if (text) implied.push({ icon, label: labelText, value: text, url });
    };
    push('MapPin', 'Find us', section.location);
    push('Clock3', 'Hours', section.hours || (isObj(section.opening_hours) ? section.opening_hours.text : undefined));
    push('MessageCircle', 'WhatsApp / Call', section.phone, typeof section.phone === 'string' ? `https://wa.me/${section.phone.replace(/\D/g, '')}` : undefined);
    push('Mail', 'Email', section.email, typeof section.email === 'string' ? `mailto:${section.email}` : undefined);
    const socials = array(first(section, 'socials', 'social', 'social_links'));
    socials.forEach((entry) => { const row = isObj(entry) ? entry : { value: entry }; push(String(row.icon || 'Instagram'), String(row.label || 'Social'), first(row, 'handle', 'value', 'text', 'username'), String(first(row, 'url', 'href') || '')); });
    contacts = implied;
  }
  const map = isObj(first(section, 'map_visual', 'map')) ? first(section, 'map_visual', 'map') : {};
  const testimonialRaw = first(section, 'testimonial', 'review_quote', 'review', 'testimonial_card');
  const testimonial = isObj(testimonialRaw) ? testimonialRaw : typeof testimonialRaw === 'string' && testimonialRaw.trim() ? { quote: testimonialRaw } : {};
  if (!testimonial.author && isObj(section.review_author)) testimonial.author = section.review_author;
  const embed = safeUrl(map.embed_url) || safeUrl(first(section, 'map_embed', 'embed_url', 'google_maps_embed', 'map_iframe_url'));
  return <section id={idSafe(section.id || 'contact')} className="sj-section sj-contact" style={mergedStyle(design, section.layout, section.style)}>
    <div className="sj-contact-copy"><Reveal design={design} node={section} animation="section_reveal" className="sj-section-heading"><span>{String(section.eyebrow || '')}</span><h2>{String(first(section, 'headline', 'heading', 'title') || 'Contact')}</h2>{section.body && <p>{String(section.body)}</p>}</Reveal>
      <div className="sj-contact-list">{contacts.map((item, index) => { const entry = isObj(item) ? item : { value: item }; const href = safeHref(entry.url, ''); const content = <><span><Icon name={entry.icon || 'MapPin'} /></span><div><small>{String(entry.label || '')}</small><strong>{String(entry.value || entry.text || '')}</strong></div>{entry.action_icon && <Icon name={entry.action_icon} size={16} />}</>; return href ? <a key={index} href={href} target={entry.opens_new_tab ? '_blank' : undefined} rel="noreferrer">{content}</a> : <div key={index}>{content}</div>; })}</div>
    </div>
    <Reveal design={design} node={map} animation="section_reveal" className="sj-map-wrap" style={mergedStyle(design, map)}>{embed && /^https:\/\/maps\.google\.com/i.test(embed) ? <iframe src={embed} title={String(map.city || 'Store location')} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : <div className="sj-map-placeholder"><MapPin /><strong>{String(section.location || map.city || '')}</strong></div>}<motion.span className="sj-map-pulse" animate={reduced ? undefined : { scale: [Number(design.animations?.contact_map_pin_pulse?.start?.scale || .75), Number(design.animations?.contact_map_pin_pulse?.end?.scale || 1.35)], opacity: [Number(design.animations?.contact_map_pin_pulse?.start?.opacity || 1), Number(design.animations?.contact_map_pin_pulse?.end?.opacity || 0)] }} transition={{ duration: Number(design.animations?.contact_map_pin_pulse?.duration_seconds || 2.2), repeat: Infinity, ease: design.animations?.contact_map_pin_pulse?.easing || 'easeOut' }}><MapPin /></motion.span>
      <div className="sj-map-overlay"><div><small>{String(map.eyebrow || '')}</small><strong>{String(map.city || section.location || '')}</strong><span>{String(map.room_detail || '')}</span></div>{(map.directions_url || safeUrl(first(section, 'directions_url', '')) || safeUrl(map.directions_button?.url) || safeUrl(first(section, 'directions_button', '')) || safeUrl(first(isObj(section.directions_button) ? section.directions_button : {}, 'url', 'href'))) && <a href={safeHref(map.directions_url || safeUrl(first(isObj(section.directions_button) ? section.directions_button : {}, 'url', 'href')) || safeUrl(first(section, 'directions_url', 'directions_button')))} target="_blank" rel="noreferrer">{String(map.directions_button?.label || (isObj(section.directions_button) ? section.directions_button.label : '') || 'Get directions')}<ExternalLink /></a>}</div>
      {Object.keys(testimonial).length > 0 && <motion.blockquote className="sj-testimonial" {...animationProps(design, testimonial, 'testimonial_reveal', reduced)}><div>{Array.from({ length: Math.min(5, Number(testimonial.rating || 0)) }).map((_, index) => <Star key={index} fill="currentColor" />)}</div><p>“{String(testimonial.quote || '')}”</p><cite>{String(testimonial.citation_display || testimonial.author || '')}</cite></motion.blockquote>}
    </Reveal>
  </section>;
}

const ignoredGeneric = new Set(['style','styles','layout','motion','animation','animations_used','id','name','type','component','kind','nav_label','responsive','accessibility']);
function GenericValue({ value, design, depth = 0 }: { value: unknown; design: Obj; depth?: number }): React.ReactNode {
  const reduced = Boolean(useReducedMotion());
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string' || typeof value === 'number') return <p>{String(value)}</p>;
  if (Array.isArray(value)) return <div className="sj-generic-grid">{value.map((item, index) => <GenericValue key={index} value={item} design={design} depth={depth + 1} />)}</div>;
  if (!isObj(value)) return null;
  if (depth > 70) {
    const primitives: string[] = []; const stack: unknown[] = [value];
    while (stack.length) { const item = stack.pop(); if (Array.isArray(item)) item.forEach((entry) => stack.push(entry)); else if (isObj(item)) Object.values(item).forEach((entry) => stack.push(entry)); else if (typeof item === 'string' || typeof item === 'number') primitives.push(String(item)); }
    return <div>{primitives.map((item, index) => <p key={index}>{item}</p>)}</div>;
  }
  const image = safeUrl(first(value, 'image', 'image_url', 'src', 'photo'));
  const heading = first(value, 'headline', 'heading', 'title');
  const body = first(value, 'body', 'description', 'intro', 'subtitle', 'text');
  return <motion.article className="sj-generic-card" style={mergedStyle(design, value.style, value.layout, value)} {...animationProps(design, value, array(value.animations_used)[0], reduced)}>{image && <img src={image} alt={String(value.alt || heading || '')} />}{value.eyebrow && <span>{String(value.eyebrow)}</span>}{heading && <h3>{String(heading)}</h3>}{body && <p>{String(body)}</p>}{Object.entries(value).filter(([key, entry]) => !ignoredGeneric.has(key) && !['image','image_url','src','photo','alt','headline','heading','title','body','description','intro','subtitle','text','eyebrow'].includes(key) && typeof entry === 'object').map(([key, entry]) => <GenericValue key={key} value={entry} design={design} depth={depth + 1} />)}</motion.article>;
}

function GenericSection({ section, design }: { section: Obj; design: Obj }) {
  return <section id={idSafe(section.id || section.name || 'section')} className="sj-section sj-generic-section" style={mergedStyle(design, section.layout, section.style)}><Reveal design={design} node={section} animation="section_reveal"><GenericValue value={section} design={design} /></Reveal></section>;
}

function Footer({ design, store, onSectionNavigate }: { design: Obj; store: Store; onSectionNavigate?: (target: string) => void }) {
  const config = isObj(design.global_ui?.footer) ? design.global_ui.footer : {};
  if (!Object.keys(config).length) return null;
  const navigation = array(first(config, 'navigation', 'links', 'items'));
  const social = isObj(config.social) ? config.social : {};
  const logo = resolveLogo(config, store);
  return <footer className="sj-footer" style={mergedStyle(design, config)}><div className="sj-footer-brand">{logo ? <img src={logo} alt={`${store.name} logo`} /> : <strong>{String(design.store_name || store.name)}</strong>}<p>{String(config.tagline || '')}</p></div><nav>{navigation.map((item, index) => { const entry = isObj(item) ? item : { label: item }; const target = safeHref(first(entry, 'target', 'href'), `#${idSafe(entry.label)}`); return <a key={index} href={target} onClick={(event) => { if (onSectionNavigate) { event.preventDefault(); onSectionNavigate(target); } }}>{String(entry.label || entry.text || item)}</a>; })}</nav>{Object.keys(social).length > 0 && <a className="sj-footer-social" href={safeHref(social.url, '#')} target="_blank" rel="noreferrer"><Icon name={social.icon || social.platform || 'Instagram'} />{String(social.handle || social.platform || '')}</a>}<small>{String(config.copyright_template || `© {current_year} ${design.store_name || store.name}`).replace('{current_year}', String(new Date().getFullYear()))}</small></footer>;
}

function sectionKind(section: Obj) {
  const identity = label(first(section, 'type', 'component', 'kind', 'id', 'name')).toLowerCase();
  if (/home|hero|landing|welcome/.test(identity) || section.hero_visual || section.headline_lines) return 'hero';
  if (/categor|collection nav/.test(identity) || section.store_categories) return 'categories';
  if (/product|catalog|shop/.test(identity) || section.product_card || section.product_page) return 'products';
  if (/contact|visit|location|find us/.test(identity) || section.map_visual || section.contact_items || section.map_embed || section.review_quote) return 'contact';
  return 'generic';
}

// A spec may carry real CSS text blocks (root or per section): AI authors pass
// their exact outward styling straight through, with basic safety scrubbing.
function sanitizeCssText(css: string): string {
  if (!css || css.length > 80000) return '';
  let out = String(css);
  out = out.replace(/<\/?style[^>]*>/gi, '');
  out = out.replace(/expression\s*\(/gi, 'void(');
  out = out.replace(/javascript:/gi, 'blocked:');
  out = out.replace(/@import[^;]+/gi, '');
  return out;
}

function designCssBlocks(design: Obj, sections: Obj[]): string[] {
  const blocks: string[] = [];
  const root = first(design, 'css', 'custom_css', 'global_css', 'custom_styles', 'style_overrides', 'global_overrides');
  if (typeof root === 'string' && root.trim()) blocks.push(root);
  else if (isObj(root)) Object.values(root).forEach((value) => { if (typeof value === 'string') blocks.push(value); });
  sections.forEach((section) => {
    const css = first(section, 'css', 'custom_css', 'css_overrides');
    if (typeof css === 'string' && css.trim()) blocks.push(`#${idSafe(section.id || 'section')}{\n${css}}`);
  });
  Object.values(design.global_ui || {}).forEach((part) => {
    if (isObj(part) && typeof part.css === 'string') blocks.push(part.css);
  });
  return blocks.map(sanitizeCssText).filter(Boolean);
}

export default function StorefrontRenderer({ store, products, onOrder, onView }: RendererProps) {
  const design = useMemo(() => parseDesign(store.design_json), [store.design_json]);
  useDesignFonts(design);
  const sections = useMemo(() => {
    const source = first(design, 'sections', 'page_sections', 'content_sections', 'pages');
    const parsed = array(source).filter(isObj);
    return parsed.length ? parsed : [{ id: 'home', headline: design.store_name || store.name, tagline: 'Karibu. Shop our newest products.' }, { id: 'products', headline: 'Our products', product_card: {} }];
  }, [design, store.name]);
  const [category, setCategory] = useState('All');
  const productSection = sections.find((section) => sectionKind(section) === 'products') || {};
  const productPageConfig = isObj(productSection.product_page) ? productSection.product_page : {};
  const productFromUrl = () => { const id = Number(new URLSearchParams(window.location.search).get('product')); return products.find((product) => product.id === id) || null; };
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(productFromUrl);
  useEffect(() => { if (!products.some((product) => product.category.toLowerCase() === category.toLowerCase())) setCategory('All'); }, [products, category]);
  useEffect(() => { const pop = () => setSelectedProduct(productFromUrl()); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, [products]);
  const selectProduct = (product: Product) => { setSelectedProduct(product); const url = new URL(window.location.href); url.searchParams.set('product', String(product.id)); window.history.pushState({}, '', url); window.scrollTo(0, 0); };
  const leaveProduct = (target = '#products') => { setSelectedProduct(null); const url = new URL(window.location.href); url.searchParams.delete('product'); window.history.replaceState({}, '', url); window.requestAnimationFrame(() => document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' })); };
  const announcement = isObj(design.global_ui?.announcement_bar) ? design.global_ui.announcement_bar : isObj(design.announcement_bar) ? design.announcement_bar : {};
  const specCss = useMemo(() => designCssBlocks(design, sections), [design, sections]);
  return <div className="sj2-storefront" style={themeVars(design)}>
    {specCss.length > 0 && <style dangerouslySetInnerHTML={{ __html: specCss.join('\n') }} />}
    <ScrollProgress design={design} />
    {Object.keys(announcement).length > 0 && <Announcement config={announcement} />}
    <Header design={design} store={store} onSectionNavigate={selectedProduct ? leaveProduct : undefined} />
    <main>{selectedProduct ? <><ProductPageDetails key={selectedProduct.id} product={selectedProduct} config={productPageConfig} design={design} onClose={() => leaveProduct('#products')} onOrder={onOrder} /><SimilarProducts current={selectedProduct} products={products} onSelect={selectProduct} /></> : sections.map((section, index) => {
      const kind = sectionKind(section);
      if (kind === 'hero') return <HeroSection key={section.id || index} section={section} design={design} store={store} />;
      if (kind === 'categories') return <CategoriesSection key={section.id || index} section={section} design={design} onSelect={setCategory} />;
      if (kind === 'products') return <ProductsSection key={section.id || index} section={section} design={design} products={products} selectedCategory={category} setSelectedCategory={setCategory} onSelectProduct={selectProduct} onView={onView} />;
      if (kind === 'contact') return <ContactSection key={section.id || index} section={section} design={design} />;
      return <GenericSection key={section.id || index} section={section} design={design} />;
    })}</main>
    <Footer design={design} store={store} onSectionNavigate={selectedProduct ? leaveProduct : undefined} />
    <div className="sj-powered"><img src="/stoyangu-logo.png" alt="StoYangu" /><span>Powered by StoYangu</span></div>
  </div>;
}
