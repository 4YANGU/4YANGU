// Restore safe design extras (fonts, colour CSS) without putting scripts back.

export function isAllowedDesignHost(url) {
  try {
    const host = new URL(String(url).startsWith('//') ? `https:${url}` : url).hostname.toLowerCase();
    return /(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com)$/i.test(host);
  } catch {
    return false;
  }
}

function looksLikeTailwindPage(html) {
  const text = String(html || '');
  if (/tailwind\.config|cdn\.tailwindcss\.com|stoyangu-preserved-theme/i.test(text)) return true;
  const utilityHits = text.match(/\bclass=["'][^"']*\b(?:flex|grid|min-h-screen|bg-\S|text-\S|md:|lg:|sm:|xl:)/gi) || [];
  return utilityHits.length >= 4;
}

export function ensureDesignRuntime(html) {
  let out = String(html || '');
  if (!out.trim()) return out;

  const extras = [];
  const needsFonts = /font-family:\s*['"]?(Syne|DM Sans)|font-display|font-body/i.test(out)
    && !/fonts\.googleapis\.com/i.test(out);
  if (needsFonts) {
    extras.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
    extras.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    extras.push('<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Syne:wght@500;600;700;800&display=swap" rel="stylesheet">');
  }
  const needsTailwindCss = looksLikeTailwindPage(out) && !/cdn\.jsdelivr\.net\/npm\/tailwindcss/i.test(out);
  if (needsTailwindCss) {
    extras.push('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css">');
  }

  if (!extras.length) return out;
  const inject = extras.join('\n');
  if (/<head[^>]*>/i.test(out)) return out.replace(/<head([^>]*)>/i, `<head$1>\n${inject}\n`);
  return `<!doctype html><html><head>${inject}</head><body>${out}</body></html>`;
}

export function isSelfContainedDesign(html) {
  const text = String(html || '');
  return /tailwind\.config|cdn\.tailwindcss\.com|stoyangu-preserved-theme|const\s+PRODUCTS\s*=|#productGrid|#featuredGrid|data-aos=/i.test(text);
}
