export type CaptionDetails = { name: string; price: string; colors: string[]; sizes: string[]; note?: string };
export function buildProductCaption({ name, price, colors, sizes, note = '' }: CaptionDetails): string {
  const money = Number(price);
  const title = name.trim() || 'New arrival';
  const heading = Number.isFinite(money) && money > 0 ? `${title} — ${new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(money)}` : title;
  const variants = [colors.length ? `Colours: ${colors.join(', ')}` : '', sizes.length ? `Sizes: ${sizes.join(', ')}` : ''].filter(Boolean);
  return [heading, ...variants, note.trim(), 'Order on WhatsApp!'].filter(Boolean).join('\n');
}
