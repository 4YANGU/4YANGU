import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const stripPreviewInstrumentation = {
    name: 'strip-preview-instrumentation',
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
      return html
        .replace(/\s*<script data-arena-recording="true">[\s\S]*?<\/script>/g, '')
        .replace(/\s*<script data-arena-views="true">[\s\S]*?<\/script>/g, '');
    },
  };
  return {
    plugins: [react(), tailwindcss(), stripPreviewInstrumentation],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('framer-motion')) return 'motion';
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('react') || id.includes('scheduler')) return 'react-core';
          },
        },
      },
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''),
    },
  };
});
