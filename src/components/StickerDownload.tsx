// Founder/shareable sticker that links back to the store subdomain. Shown
// inside the store's own dashboard so the owner can download a graphic to
// drop into their Instagram bio / TikTok handle.
export default function StickerDownload({ slug }: { slug: string }) {
  const root = String(import.meta.env.VITE_ROOT_DOMAIN || 'stoyangu.com');
  const url = `https://${slug}.${root}/`;
  return (
    <a className="sticker-download-button" href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer" download={`${slug}-stoyangu-qr.png`}>
      Download store QR
    </a>
  );
}
