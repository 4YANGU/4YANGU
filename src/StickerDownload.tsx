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

  // Die-cut look: a clean white strip around every character, then the ink fill.
  const stickerText = (text: string, x: number, y: number, size: number, fill: string, align: 'center' | 'left' = 'center') => {
    ctx.textAlign = align;
    ctx.font = font(size);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = size * 0.18;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  };

  stickerText('Cheki all our products,', W / 2, 122, 74, INK);
  stickerText('sizes and', W / 2, 262, 74, INK);
  stickerText('delivery options pale', W / 2, 402, 74, INK);

  // Domain line: white strip, black outline, gold fill — emblem right after it.
  ctx.textAlign = 'left';
  let domainSize = 64;
  ctx.font = font(domainSize);
  let textWidth = ctx.measureText(domain).width + domainSize * 0.22;
  const emblemRatio = emblem.width / emblem.height;
  while (textWidth > W - 40 - 24 - 40 - domainSize * 1.55 * emblemRatio && domainSize > 34) {
    domainSize -= 2;
    ctx.font = font(domainSize);
    textWidth = ctx.measureText(domain).width + domainSize * 0.22;
  }
  const domainY = 512;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = domainSize * 0.34;
  ctx.strokeText(domain, 40, domainY);
  ctx.strokeStyle = INK;
  ctx.lineWidth = domainSize * 0.14;
  ctx.strokeText(domain, 40, domainY);
  ctx.fillStyle = GOLD;
  ctx.fillText(domain, 40, domainY);
  const emblemH = domainSize * 1.55;
  const emblemW = emblemH * emblemRatio;
  const emblemX = 40 + ctx.measureText(domain).width + 24;
  const emblemY = domainY - emblemH * 0.78;
  // White die-cut halo behind the emblem (white silhouette offset in 8 directions).
  const silhouette = document.createElement('canvas');
  silhouette.width = Math.ceil(emblemW);
  silhouette.height = Math.ceil(emblemH);
  const sctx = silhouette.getContext('2d');
  if (sctx) {
    sctx.drawImage(emblem, 0, 0, emblemW, emblemH);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, emblemW, emblemH);
    const pad = domainSize * 0.14;
    for (const [dx, dy] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad], [pad * 0.7, pad * 0.7], [-pad * 0.7, pad * 0.7], [pad * 0.7, -pad * 0.7], [-pad * 0.7, -pad * 0.7]] as Array<[number, number]>) {
      ctx.drawImage(silhouette, emblemX + dx, emblemY + dy);
    }
  }
  ctx.drawImage(emblem, emblemX, emblemY, emblemW, emblemH);

  stickerText('Link in bio', W / 2, 660, 86, INK);

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
