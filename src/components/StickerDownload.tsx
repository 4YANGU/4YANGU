import { useState } from 'react';
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
  // Slightly tighter tracking buys width back, so characters can stay big.
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = '-2px'; } catch { /* older browsers */ }
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

  // Four balanced lines with bigger characters — the address owns its own line.
  stickerText('Cheki products, sizes na delivery', W / 2, 178, fitSize('Cheki products, sizes na delivery', 86, W - 56), INK);
  stickerText('options zetu zote pale stoyangu at', W / 2, 306, fitSize('options zetu zote pale stoyangu at', 86, W - 56), INK);

  // Line three: ONLY the store address in gold + the emblem. Nothing before it.
  const lineY = 468;
  const emblemRatio = emblem.width / emblem.height;
  let linkSize = 68;
  ctx.font = font(linkSize);
  let domainWidth = ctx.measureText(domain).width;
  while (40 + domainWidth + 26 + linkSize * 1.55 * emblemRatio + 40 > W && linkSize > 30) {
    linkSize -= 2;
    ctx.font = font(linkSize);
    domainWidth = ctx.measureText(domain).width;
  }
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = linkSize * 0.4;
  ctx.strokeText(domain, 40, lineY);
  ctx.strokeStyle = INK;
  ctx.lineWidth = linkSize * 0.13;
  ctx.strokeText(domain, 40, lineY);
  ctx.fillStyle = GOLD;
  ctx.fillText(domain, 40, lineY);

  // Emblem with its white die-cut halo, in the same spot, right after the address.
  const emblemH = linkSize * 1.55;
  const emblemW = emblemH * emblemRatio;
  const emblemX = 40 + domainWidth + 26;
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

  stickerText('Link in Profile', W / 2, 614, fitSize('Link in Profile', 86, W - 56), INK);

  return canvas.toDataURL('image/png');
}

export default function StickerDownload({ slug }: { slug: string }) {
  const domain = storeDomain(slug);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const dataUrl = await renderSticker(domain);
      // Wozaa fix: iOS Safari ignores the download attribute on data/blob URLs,
      // so on iPhone the sticker could never be saved. Convert to a real File
      // and use the native share sheet ("Save Image" is one tap), with
      // per-browser fallbacks below.
      const blob = await (await fetch(dataUrl)).blob();
      const fileName = `chegi-sticker-${slug}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
        try { await nav.share({ files: [file], title: 'StoYangu sticker' }); return; }
        catch (shareError) { if ((shareError as Error)?.name === 'AbortError') return; /* owner closed the sheet */ }
      }
      const url = URL.createObjectURL(blob);
      const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || ((navigator as unknown as { platform?: string }).platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (iOS) {
        // Older iOS without file sharing: open the image in a tab so it can be
        // saved with a long-press.
        window.open(url, '_blank', 'noopener');
        window.alert('Long-press the sticker image, then choose "Add to Photos" or "Save Image".');
      } else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (reason) {
      console.error('Sticker render failed:', reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="stika-button" onClick={download} disabled={busy}>
      {busy ? 'Building…' : 'Download Stika'} <Download />
    </button>
  );
}
