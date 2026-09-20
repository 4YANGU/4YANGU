// Brand glyphs for the 5 Repliz-connected platforms.
// Tiny inline SVGs (no external assets) used as per-message origin labels
// across the DMs and Comments tabs.

import type { ReactNode } from 'react';

export function platformLabel(id: string) {
  const map: Record<string, string> = {
    tiktok: 'TikTok',
    facebook: 'Facebook',
    instagram: 'Instagram',
    youtube: 'YouTube',
    threads: 'Threads',
  };
  return map[String(id).toLowerCase()] || String(id);
}

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
  if (id === 'youtube') {
    return <svg {...frame} aria-hidden="true"><rect width="24" height="24" rx="6" fill="#FF0000" /><rect x="4.5" y="7" width="15" height="10.5" rx="3" fill="#ffffff" /><path fill="#FF0000" d="M10.4 9.4v5.2l4.6-2.6z" /></svg>;
  }
  if (id === 'threads') {
    return <svg {...frame} aria-hidden="true"><rect width="24" height="24" rx="6" fill="#111111" /><text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="900" fill="#ffffff" fontFamily="Arial, sans-serif">@</text></svg>;
  }
  return <svg {...frame} aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#5a966e" /><text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="900" fill="#ffffff" fontFamily="Arial, sans-serif">{(platformLabel(platform)[0] || '?').toUpperCase()}</text></svg>;
}

export function PlatformBadge({ platform, small = false }: { platform: string; small?: boolean }): ReactNode {
  return <span className={`platform-badge${small ? ' small' : ''}`}><PlatformLogo platform={platform} size={small ? 12 : 14} />{platformLabel(platform)}</span>;
}
