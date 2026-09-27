import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs: the build works from whatever path it is served from (PLAN §15.1).
  base: './',
  plugins: [react()],
  // Module workers (PLAN §2.2).
  worker: { format: 'es' },
  server: {
    // Reachable from a phone on the same Wi-Fi; /api goes to `npm run dev:server` (PLAN §17.1).
    host: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
