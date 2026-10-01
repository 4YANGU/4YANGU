import { platformLabel } from '../lib/platforms';

export default function PlatformLogo({ platform, size = 14 }: { platform: string; size?: number }) {
  const id = String(platform).toLowerCase();
  const s = size;
  const frame = { width: s, height: s, viewBox: '0 0 24 24' };
  if (id === 'tiktok') {
    return <svg {...frame} aria-hidden="true"><rect width="24" height="24" rx="6" fill="#111111" /><path fill="#ffffff" d="M16.6 3c.4 2.1 1.9 3.6 4.1 3.8v3c-1.6 0-3-.5-4.1-1.3v6.1c0 3.4-2.6 5.9-5.8 5.9-3.1 0-5.6-2.5-5.6-5.6 0-3.2 2.6-5.7 5.9-5.7.3 0 .7 0 1 .1v3.1c-.3-.2-.7-.2-1-.2-1.5 0-2.7 1.2-2.7 2.7 0 1.4 1.1 2.5 2.5 2.5 1.5 0 2.6-1.2 2.6-2.9V3h3.1z" /></svg>;
  }
  if (id === 'facebook') {
    return <svg {...frame} aria-hidden="true"><rect width="24" height="24" rx="6" fill="#1877F2" /><path fill="#ffffff" d="M13.5 21v-7h2.4l.4-2.8h-2.8V9.4c0-.8.2-1.4 1.4-1.4h1.5V5.5c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2H8v2.8h2.5v7h3z" /></svg>;
  }
  if (id === 'instagram') {
    return <svg {...frame} aria-hidden="true"><defs><linearGradient id="sy-ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#f09433" /><stop offset=".45" stopColor="#dc2743" /><stop offset=".75" stopColor="#cc2366" /><stop offset="1" stopColor="#bc1888" /></linearGradient></defs><rect width="24" height="24" rx="6" fill="url(#sy-ig)" /><rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="#ffffff" strokeWidth="1.8" /><circle cx="12" cy="12" r="3.2" fill="none" stroke="#ffffff" strokeWidth="1.8" /><circle cx="16.4" cy="7.6" r="1.3" fill="#ffffff" /></svg>;
  }
  if (id === 'threads') {
    return <svg {...frame} aria-hidden="true"><rect width="24" height="24" rx="6" fill="#111111" /><path fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M17.7 10.5c-.5-3.2-2.4-5-5.5-5-3.5 0-5.8 2.4-5.8 6.5 0 4.2 2.2 6.6 5.8 6.6 3.1 0 5.2-1.7 5.2-4.3 0-2.2-1.6-3.6-4.2-3.6-2.3 0-3.8 1-3.8 2.7 0 1.5 1.2 2.5 2.9 2.5 2.6 0 4.4-1.9 4.4-4.7 0-3.6-1.8-6.2-5.2-6.2" /></svg>;
  }
  if (id === 'whatsapp') {
    return <svg {...frame} aria-hidden="true"><rect width="24" height="24" rx="6" fill="#25D366" /><path fill="#fff" d="M12.05 4.1a7.9 7.9 0 0 0-6.8 11.93L4 20l4.08-1.2a7.9 7.9 0 1 0 3.97-14.7zm0 14.34a6.3 6.3 0 0 1-3.22-.88l-.23-.14-2.39.7.73-2.32-.15-.24a6.36 6.36 0 1 1 5.26 2.88zm3.49-4.76c-.19-.1-1.13-.56-1.31-.62-.17-.07-.3-.1-.43.1-.13.19-.49.62-.6.74-.1.13-.22.14-.41.05-.19-.1-.8-.3-1.52-.94-.56-.5-.94-1.12-1.05-1.31-.11-.19-.01-.29.08-.39l.29-.34.19-.32c.06-.13.03-.24-.02-.34l-.59-1.42c-.15-.37-.31-.32-.43-.32h-.37c-.13 0-.34.05-.51.24-.18.2-.67.65-.67 1.58s.69 1.83.78 1.96c.1.13 1.35 2.06 3.28 2.89.46.2.82.32 1.1.41.46.15.88.13 1.21.08.37-.06 1.13-.46 1.29-.91.16-.45.16-.84.11-.92-.05-.08-.18-.13-.37-.23z" /></svg>;
  }
  return <svg {...frame} aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#5a966e" /><text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="900" fill="#ffffff" fontFamily="Arial, sans-serif">{(platformLabel(platform)[0] || '?').toUpperCase()}</text></svg>;
}

export function PlatformBadge({ platform, small = false }: { platform: string; small?: boolean }) {
  return <span className={`platform-badge${small ? ' small' : ''}`}><PlatformLogo platform={platform} size={small ? 12 : 14} />{platformLabel(platform)}</span>;
}
