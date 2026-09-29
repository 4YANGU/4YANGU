import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    // The app is served behind a preview proxy whose host is not known ahead
    // of time (e.g. https://{port}-{sandboxId}.e2b.app). Allow every host so
    // the proxied preview loads; production is served by Vercel, not Vite.
    allowedHosts: true,
    host: true,
  },
});
