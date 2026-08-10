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

  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = font(64);
  ctx.fillText('Cheki all our products,', W / 2, 115);
  ctx.fillText('sizes and', W / 2, 250);
  ctx.fillText('delivery options pale', W / 2, 385);

  // Domain line: gold with the black sticker outline, emblem right after it.
  ctx.textAlign = 'left';
  let domainSize = 58;
  ctx.font = font(domainSize);
  let textWidth = ctx.measureText(domain).width;
  const emblemRatio = emblem.width / emblem.height;
  while (textWidth > W - 40 - 22 - 40 - domainSize * 1.55 * emblemRatio && domainSize > 34) {
    domainSize -= 2;
    ctx.font = font(domainSize);
    textWidth = ctx.measureText(domain).width;
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 7.5;
  ctx.strokeText(domain, 40, 495);
  ctx.fillStyle = GOLD;
  ctx.fillText(domain, 40, 495);
  const emblemH = domainSize * 1.55;
  const emblemW = emblemH * emblemRatio;
  ctx.drawImage(emblem, 40 + textWidth + 22, 495 - emblemH * 0.78, emblemW, emblemH);

  ctx.textAlign = 'center';
  ctx.font = font(78);
  ctx.fillStyle = INK;
  ctx.fillText('Link in bio', W / 2, 640);

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
        <p>Drop this transparent sticker on your TikTok, Instagram or WhatsApp videos and photos — customers instantly see where to shop: <b>{domain}</b>. Download it as many times as you want; everything stays identical except your store address.</p>
        <button className="button-primary" onClick={download} disabled={building || !dataUrl}>
          {building ? 'Building sticker…' : 'Download sticker (PNG)'} <Download />
        </button>
      </div>
    </section>
  );
}
