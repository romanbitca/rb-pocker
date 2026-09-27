import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { META_CSP } from './scripts/csp.ts';
import { en } from './src/i18n/en.ts';

/**
 * Puts the meta CSP into the built index.html only (PLAN §15.2). The source index.html has none:
 * the dev server needs inline scripts and websockets for HMR. It goes right after
 * `<meta charset>`, before every script, so it covers all of them.
 */
function metaCsp(): Plugin {
  const charset = /<meta charset="[^"]*"\s*\/?>/i;
  return {
    name: 'rb:meta-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!charset.test(html)) throw new Error('index.html needs <meta charset="…"> in <head>');
      const meta = `<meta http-equiv="Content-Security-Policy" content="${META_CSP}" />`;
      return html.replace(charset, (tag) => `${tag}\n    ${meta}`);
    },
  };
}

export default defineConfig({
  // Relative URLs: the build works from whatever path it is served from (PLAN §15.1).
  base: './',
  plugins: [
    react(),
    // Offline PWA (PLAN §15.1): precache everything, no runtime caching, no third-party URLs.
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      // No injected registration script (an inline one is blocked by the CSP, pitfall 32):
      // App registers through useRegisterSW() from virtual:pwa-register/react, which is bundled.
      injectRegister: false,
      manifest: {
        name: en.app.name,
        short_name: en.app.shortName,
        description: en.app.description,
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        background_color: '#0f1512',
        theme_color: '#0f1512',
        // Drawn by scripts/gen-icons.ts.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,json,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
    metaCsp(),
  ],
  // Module workers (PLAN §2.2).
  worker: { format: 'es' },
  server: {
    // Reachable from a phone on the same Wi-Fi; /api goes to `npm run dev:server` (PLAN §17.1).
    host: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
