// Turn the AI's Tailwind colour names (ink, flame, bone…) into real CSS
// after we remove scripts. The shop keeps its colours without any JavaScript.

const NAMED = {
  black: '#000000', white: '#ffffff', transparent: 'transparent',
  current: 'currentColor', inherit: 'inherit',
  slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373',
  stone: '#78716c', red: '#ef4444', orange: '#f97316', amber: '#f59e0b',
  yellow: '#eab308', lime: '#84cc16', green: '#22c55e', emerald: '#10b981',
  teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6',
  indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
  pink: '#ec4899', rose: '#f43f5e',
};

function hexToRgb(hex) {
  const value = String(hex || '').trim();
  if (/^transparent$/i.test(value)) return null;
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) {
    const [r, g, b] = short[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  const full = /^#([0-9a-f]{6})$/i.exec(value);
  if (full) {
    return {
      r: parseInt(full[1].slice(0, 2), 16),
      g: parseInt(full[1].slice(2, 4), 16),
      b: parseInt(full[1].slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return null;
}

function withAlpha(color, alpha) {
  if (color === 'transparent') return 'transparent';
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function extractTheme(html) {
  const colors = {
    ...NAMED,
    ink: '#0a0a0a',
    soot: '#141414',
    ash: '#1c1c1c',
    mist: '#a3a3a3',
    bone: '#f5f5f0',
    flame: '#ff3d00',
    gold: '#c9a227',
  };
  const fonts = {
    display: "'Syne', system-ui, sans-serif",
    body: "'DM Sans', system-ui, sans-serif",
  };
  const block = html.match(/tailwind\.config\s*=\s*\{[\s\S]{0,8000}?<\/script>/i)?.[0] || '';
  const colorBlock = block.match(/colors\s*:\s*\{([^}]{0,2000})\}/i)?.[1] || '';
  const colorRe = /([A-Za-z][\w-]*)\s*:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = colorRe.exec(colorBlock))) {
    colors[match[1]] = match[2];
  }
  const display = block.match(/display\s*:\s*\[([^\]]+)\]/i)?.[1];
  const body = block.match(/body\s*:\s*\[([^\]]+)\]/i)?.[1];
  if (display) fonts.display = display.replace(/["']/g, '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => (/\s/.test(p) ? `'${p}'` : p)).join(', ');
  if (body) fonts.body = body.replace(/["']/g, '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => (/\s/.test(p) ? `'${p}'` : p)).join(', ');
  return { colors, fonts };
}

function collectClasses(html) {
  const found = new Set();
  const re = /\bclass(?:Name)?\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    match[1].split(/\s+/).forEach((cls) => { if (cls) found.add(cls); });
  }
  return [...found];
}

function escapeClass(name) {
  return `.${String(name).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`;
}

function wrapVariant(cls, body) {
  const variants = [];
  let rest = cls;
  const prefix = /^(sm|md|lg|xl|2xl|hover|focus|group-hover|active|disabled):/;
  while (prefix.test(rest)) {
    const hit = rest.match(prefix);
    variants.push(hit[1]);
    rest = rest.slice(hit[0].length);
  }
  let selector = escapeClass(cls);
  const media = { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' };
  let mediaQuery = '';
  variants.forEach((variant) => {
    if (media[variant]) mediaQuery = media[variant];
    else if (variant === 'hover') selector = `${escapeClass(cls)}:hover`;
    else if (variant === 'focus') selector = `${escapeClass(cls)}:focus`;
    else if (variant === 'group-hover') selector = `.group:hover ${escapeClass(cls)}`;
    else if (variant === 'active') selector = `${escapeClass(cls)}:active`;
    else if (variant === 'disabled') selector = `${escapeClass(cls)}:disabled`;
  });
  const rule = `${selector}{${body}}`;
  return mediaQuery ? `@media (min-width:${mediaQuery}){${rule}}` : rule;
}

function resolveColor(token, theme) {
  if (!token) return '';
  if (token === 'transparent' || token === 'current' || token === 'inherit') return NAMED[token];
  const split = token.match(/^(.+)\/(\d{1,3})$/);
  if (split) {
    const base = theme.colors[split[1]] || NAMED[split[1]] || (/^#|^rgb/.test(split[1]) ? split[1] : '');
    if (!base) return '';
    return withAlpha(base, Math.min(100, Number(split[2])) / 100);
  }
  return theme.colors[token] || NAMED[token] || '';
}

function cssForUtility(raw, theme) {
  const cls = raw.replace(/^!/, '');
  const important = raw.startsWith('!');
  const bang = important ? '!important' : '';
  const core = cls.replace(/^(sm|md|lg|xl|2xl|hover|focus|group-hover|active|disabled):/g, '').replace(/^(sm|md|lg|xl|2xl|hover|focus|group-hover|active|disabled):/g, '');

  const colorProp = (prefix, prop) => {
    if (!core.startsWith(`${prefix}-`)) return '';
    const token = core.slice(prefix.length + 1);
    const color = resolveColor(token, theme);
    return color ? `${prop}:${color}${bang};` : '';
  };

  let body = colorProp('bg', 'background-color')
    || colorProp('text', 'color')
    || colorProp('border', 'border-color')
    || colorProp('fill', 'fill')
    || colorProp('stroke', 'stroke')
    || colorProp('ring', '--tw-ring-color')
    || colorProp('from', '--tw-gradient-from')
    || colorProp('via', '--tw-gradient-via')
    || colorProp('to', '--tw-gradient-to');

  if (!body && core.startsWith('from-')) {
    const color = resolveColor(core.slice(5), theme);
    if (color) body = `--tw-gradient-from:${color}${bang};--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to,transparent);`;
  }
  if (!body && core.startsWith('via-')) {
    const color = resolveColor(core.slice(4), theme);
    if (color) body = `--tw-gradient-via:${color}${bang};--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-via),var(--tw-gradient-to,transparent);`;
  }
  if (!body && core.startsWith('shadow-')) {
    const token = core.slice(7);
    const color = resolveColor(token, theme);
    if (color) body = `--tw-shadow-color:${color}${bang};box-shadow:0 20px 40px -12px ${withAlpha(color, 0.35)}${bang};`;
  }

  if (!body && core === 'font-display') body = `font-family:${theme.fonts.display}${bang};`;
  if (!body && core === 'font-body') body = `font-family:${theme.fonts.body}${bang};`;

  const arbitrary = core.match(/^([a-z]+)-\[(.+)\]$/);
  if (!body && arbitrary) {
    const map = {
      w: 'width', h: 'height', min: '', max: '',
      p: 'padding', px: 'padding-left;padding-right', py: 'padding-top;padding-bottom',
      m: 'margin', mt: 'margin-top', mb: 'margin-bottom', ml: 'margin-left', mr: 'margin-right',
      top: 'top', left: 'left', right: 'right', bottom: 'bottom',
      inset: 'inset', gap: 'gap', text: 'font-size', leading: 'line-height',
      tracking: 'letter-spacing', rounded: 'border-radius', z: 'z-index',
      aspect: 'aspect-ratio', max: 'max-width', minw: 'min-width',
    };
    let prop = map[arbitrary[1]];
    if (core.startsWith('max-w-[')) prop = 'max-width';
    if (core.startsWith('min-w-[')) prop = 'min-width';
    if (core.startsWith('min-h-[')) prop = 'min-height';
    if (core.startsWith('max-h-[')) prop = 'max-height';
    if (prop) {
      const value = arbitrary[2].replace(/_/g, ' ');
      if (!/expression|javascript:/i.test(value)) body = `${prop}:${value}${bang};`;
    }
  }

  if (!body) return '';
  return wrapVariant(cls, body);
}

export function buildThemeStylesheet(html) {
  const theme = extractTheme(html);
  const rules = [];
  rules.push(`.font-display{font-family:${theme.fonts.display}}`);
  rules.push(`.font-body{font-family:${theme.fonts.body}}`);
  Object.entries(theme.colors).forEach(([name, value]) => {
    if (NAMED[name] && !['black', 'white', 'transparent'].includes(name)) return;
    rules.push(`.bg-${name}{background-color:${value}}`);
    rules.push(`.text-${name}{color:${value}}`);
    rules.push(`.border-${name}{border-color:${value}}`);
    rules.push(`.from-${name}{--tw-gradient-from:${value};--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to,transparent)}`);
    rules.push(`.to-${name}{--tw-gradient-to:${value}}`);
    rules.push(`.via-${name}{--tw-gradient-via:${value}}`);
    [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90].forEach((pct) => {
      const faded = withAlpha(value, pct / 100);
      const escaped = `\\/${pct}`;
      rules.push(`.bg-${name}${escaped}{background-color:${faded}}`);
      rules.push(`.text-${name}${escaped}{color:${faded}}`);
      rules.push(`.border-${name}${escaped}{border-color:${faded}}`);
      rules.push(`.from-${name}${escaped}{--tw-gradient-from:${faded}}`);
      rules.push(`.via-${name}${escaped}{--tw-gradient-via:${faded}}`);
      rules.push(`.to-${name}${escaped}{--tw-gradient-to:${faded}}`);
    });
  });
  collectClasses(html).forEach((cls) => {
    const extra = cssForUtility(cls, theme);
    if (extra) rules.push(extra);
  });
  return `/* StoYangu kept these colours after scripts were removed */\n${[...new Set(rules)].join('\n')}`;
}

export function injectPreservedTheme(html, sourceForTheme = html) {
  const probe = `${sourceForTheme}\n${html}`;
  if (!/tailwind\.config|cdn\.tailwindcss\.com|class=["'][^"']*\b(?:bg-|text-ink|text-bone|bg-flame|bg-ink)/i.test(probe)) return html;
  const css = buildThemeStylesheet(probe);
  const tag = `<style id="stoyangu-preserved-theme">${css}</style>`;
  if (/id="stoyangu-preserved-theme"/.test(html)) {
    return html.replace(/<style id="stoyangu-preserved-theme">[\s\S]*?<\/style>/i, tag);
  }
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>\n${tag}\n`);
  return `${tag}${html}`;
}
