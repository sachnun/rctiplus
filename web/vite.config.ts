import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

/** Dev API target (Hono server). In production the API serves web/dist itself. */
const API = 'http://localhost:3000';

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // JSON API
      '/channels': API,
      '/schedule': API,
      '/history': API,
      // catch-up replay + proxied CDN assets
      '/replay': API,
      '/h': API,
      // live channel manifests: /<slug>.m3u8 (regex context, vite-style)
      '^/[^/]+\\.m3u8': API,
    },
  },
});
