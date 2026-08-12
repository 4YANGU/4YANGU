// Founder/shareable sticker that links back to the store subdomain. Shown
// inside the store's own dashboard so the owner can download a graphic to
// drop into their Instagram bio / TikTok handle. We restore the original
// branded sticker asset (public/sticker-emblem.png) and let the owner
// download it as a PNG with their store URL underneath, ready to share.
import { useState } from 'react';

export default function StickerDownload({ slug }: { slug: string }) {
  const root = String(import.meta.env.VITE_ROOT_DOMAIN || 'stoyangu.com');
  const url = `https://${slug}.${root}/`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Build a branded sticker on the fly: the original emblem asset with the
  // store's URL rendered underneath, as a downloadable PNG. We compose it
  // in a canvas so the user gets a single, ready-to-share file.
  const download = async () => {
    setBusy(true); setError('');
    try {
      // Load the original emblem from the site root.
      const emblemUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/sticker-emblem.png`;
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not load the sticker emblem. Re-deploy public/sticker-emblem.png and try again.'));
        i.src = emblemUrl;
      });
      // Make a tall canvas so the URL sits nicely below the emblem.
      const w = img.naturalWidth || 600;
      const h = (img.naturalHeight || 600) + 140;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not supported in this browser.');
      // Cream background to match the brand
      ctx.fillStyle = '#f3ecdd';
      ctx.fillRect(0, 0, w, h);
      // Draw the emblem, centered horizontally
      ctx.drawImage(img, (w - (img.naturalWidth || w)) / 2, 20, img.naturalWidth || w, img.naturalHeight || (h - 160));
      // Draw the store URL underneath, in StoYangu navy
      ctx.fillStyle = '#101f30';
      ctx.font = `700 ${Math.max(28, Math.round(w * 0.045))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(slug + '.' + root, w / 2, h - 70);
      // Trigger the download
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not generate the sticker image.');
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${slug}-stoyangu-sticker.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not generate the sticker.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="sticker-download-block">
      <button type="button" className="sticker-download-button" onClick={download} disabled={busy}>
        {busy ? 'Building your sticker…' : 'Download StoYangu sticker'}
      </button>
      <small>Your branded StoYangu sticker with your store URL — drop it on Instagram, TikTok, Facebook or anywhere.</small>
      {error && <small className="form-error" style={{ display: 'block', marginTop: 6 }}>{error}</small>}
    </div>
  );
}
