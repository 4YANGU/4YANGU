import { useEffect } from 'react';

type SeoProps = {
  title: string;
  description: string;
  canonical: string;
  image?: string;
  type?: 'website' | 'product';
  schema?: Record<string, unknown> | Array<Record<string, unknown>>;
};

function setMeta(selector: string, attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) { element = document.createElement('meta'); element.setAttribute(attribute, key); document.head.appendChild(element); }
  element.content = content;
}

export default function Seo({ title, description, canonical, image = '/stoyangu-logo.png', type = 'website', schema }: SeoProps) {
  useEffect(() => {
    document.title = title;
    setMeta('meta[name="description"]', 'name', 'description', description);
    setMeta('meta[name="robots"]', 'name', 'robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
    setMeta('meta[property="og:title"]', 'property', 'og:title', title);
    setMeta('meta[property="og:description"]', 'property', 'og:description', description);
    setMeta('meta[property="og:type"]', 'property', 'og:type', type);
    setMeta('meta[property="og:url"]', 'property', 'og:url', canonical);
    setMeta('meta[property="og:image"]', 'property', 'og:image', image.startsWith('http') ? image : `${window.location.origin}${image}`);
    setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = canonical;
    const oldSchema = document.getElementById('stoyangu-structured-data'); oldSchema?.remove();
    if (schema) {
      const script = document.createElement('script'); script.id = 'stoyangu-structured-data'; script.type = 'application/ld+json'; script.text = JSON.stringify(schema).replace(/</g, '\\u003c'); document.head.appendChild(script);
    }
    return () => { document.getElementById('stoyangu-structured-data')?.remove(); };
  }, [title, description, canonical, image, type, schema]);
  return null;
}
