import { Capacitor, registerPlugin } from '@capacitor/core';

const whatsapp = registerPlugin<{ shareStatus(options: { videoUrl: string; caption: string }): Promise<{ opened: boolean }> }>('StoYanguWhatsApp');
export const isStoYanguAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export async function openWhatsAppWithVideo(videoUrl: string, caption: string) {
  if (!isStoYanguAndroid()) throw new Error('Native sharing is only available in the Android app.');
  return whatsapp.shareStatus({ videoUrl, caption });
}
