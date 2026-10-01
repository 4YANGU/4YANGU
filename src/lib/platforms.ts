export function platformLabel(id: string) {
  const map: Record<string, string> = {
    tiktok: 'TikTok',
    facebook: 'Facebook',
    instagram: 'Instagram',
    threads: 'Threads',
    whatsapp: 'WhatsApp',
    storefront: 'Store Order',
  };
  return map[String(id).toLowerCase()] || String(id);
}
