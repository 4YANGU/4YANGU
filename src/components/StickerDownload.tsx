import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { storeDomain } from '../lib/api';

// Renders the "Cheki" video-sticker on a canvas so the only thing that changes
// per store is the store's own address. Output: transparent PNG, 2x resolution.
const W = 1038;
const H = 691;
const SCALE = 2;
const INK = '#030303';
const GOLD = '#f5c00a';
const WHITE = '#ffffff';

function ensureMontserratLink() {
  if (document.querySelector('link[data-montserrat-sticker]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap';
  link.setAttribute('data-montserrat-sticker', '1');
  document.head.appendChild(link);
}

function loadEmblem(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Sticker emblem could not load.'));
    img.src = '/sticker-emblem.png';
  });
}

async function renderSticker(domain: string): Promise<string> {
  ensureMontserratLink();
  try {
    await Promise.race([
      document.fonts.load('900 64px Montserrat').then(() => document.fonts.ready),
      new Promise((_, reject) => window.setTimeout(reject, 4000)),
    ]);
  } catch {
    // Fonts unavailable (offline): the canvas falls back to a heavy system font.
  }
  const emblem = await loadEmblem();
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported on this device.');
  ctx.scale(SCALE, SCALE);
  ctx.clearRect(0, 0, W, H);
  const font = (size: number) => `900 ${size}px Montserrat, "Arial Black", sans-serif`;
  const fitSize = (text: string, start: number, available = W - 80) => {
    let size = start;
    ctx.font = font(size);
    while (ctx.measureText(text).width + size * 0.26 > available && size > 30) { size -= 2; ctx.font = font(size); }
    return size;
  };
  // Die-cut look: a clean white strip around every character, then the ink fill.
  const stickerText = (text: string, x: number, y: number, size: number, fill: string) => {
    ctx.textAlign = 'center';
    ctx.font = font(size);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = size * 0.18;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  };

  stickerText('Cheki products, sizes na', W / 2, 124, fitSize('Cheki products, sizes na', 72), INK);
  stickerText('delivery options zetu zote pale', W / 2, 254, fitSize('delivery options zetu zote pale', 72), INK);

  // Link line: "stoyangu at" in ink, the store address in gold, emblem right after.
  const prefix = 'stoyangu at ';
  const lineY = 522;
  const emblemRatio = emblem.width / emblem.height;
  let linkSize = 58;
  const totalWidth = (size: number) => {
    ctx.font = font(size);
    return ctx.measureText(prefix).width + ctx.measureText(domain).width + 26 + size * 1.55 * emblemRatio;
  };
  while (totalWidth(linkSize) > W - 80 && linkSize > 30) linkSize -= 2;
  ctx.font = font(linkSize);
  const prefixWidth = ctx.measureText(prefix).width;
  const domainWidth = ctx.measureText(domain).width;
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = linkSize * 0.42;
  ctx.strokeText(prefix, 40, lineY);
  ctx.fillStyle = INK;
  ctx.fillText(prefix, 40, lineY);
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = linkSize * 0.4;
  ctx.strokeText(domain, 40 + prefixWidth, lineY);
  ctx.strokeStyle = INK;
  ctx.lineWidth = linkSize * 0.13;
  ctx.strokeText(domain, 40 + prefixWidth, lineY);
  ctx.fillStyle = GOLD;
  ctx.fillText(domain, 40 + prefixWidth, lineY);

  // Emblem with its white die-cut halo, in the same spot, right after the address.
  const emblemH = linkSize * 1.55;
  const emblemW = emblemH * emblemRatio;
  const emblemX = 40 + prefixWidth + domainWidth + 26;
  const emblemY = lineY - emblemH * 0.78;
  const silhouette = document.createElement('canvas');
  silhouette.width = Math.ceil(emblemW);
  silhouette.height = Math.ceil(emblemH);
  const sctx = silhouette.getContext('2d');
  if (sctx) {
    sctx.drawImage(emblem, 0, 0, emblemW, emblemH);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = WHITE;
    sctx.fillRect(0, 0, emblemW, emblemH);
    const pad = linkSize * 0.14;
    for (const [dx, dy] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad], [pad * 0.7, pad * 0.7], [-pad * 0.7, pad * 0.7], [pad * 0.7, -pad * 0.7], [-pad * 0.7, -pad * 0.7]] as Array<[number, number]>) {
      ctx.drawImage(silhouette, emblemX + dx, emblemY + dy);
    }
  }
  ctx.drawImage(emblem, emblemX, emblemY, emblemW, emblemH);

  stickerText('Link in Profile', W / 2, 662, fitSize('Link in Profile', 84), INK);

  return canvas.toDataURL('image/png');
}

export default function StickerDownload({ slug }: { slug: string }) {
  const domain = storeDomain(slug);
  const [dataUrl, setDataUrl] = useState('');
  const [building, setBuilding] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setBuilding(true);
    setFailed(false);
    renderSticker(domain)
      .then((url) => { if (live) setDataUrl(url); })
      .catch((reason) => { console.error('Sticker render failed:', reason); if (live) setFailed(true); })
      .finally(() => { if (live) setBuilding(false); });
    return () => { live = false; };
  }, [domain]);

  const download = () => {
    if (!dataUrl) return;
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `cheki-sticker-${slug}.png`;
    anchor.click();
  };

  return (
    <section className="sticker-card">
      <div className="sticker-preview">
        {building && <div className="sticker-loading">Building your sticker…</div>}
        {!building && dataUrl && <img src={dataUrl} alt={`Cheki sticker for ${domain}`} />}
        {!building && failed && <div className="sticker-loading">Preview unavailable — try refreshing.</div>}
      </div>
      <div className="sticker-copy">
        <span className="eyebrow">Free marketing sticker</span>
        <h2>Cheki-sticker for your videos</h2>
        <p>Drop it on any TikTok, Instagram or WhatsApp video — customers instantly see where to shop: <b>{domain}</b>. Download as many times as you want.</p>
        <button className="button-primary" onClick={download} disabled={building || !dataUrl}>
          {building ? 'Building sticker…' : 'Download sticker (PNG)'} <Download />
        </button>
      </div>
    </section>
  );
}
