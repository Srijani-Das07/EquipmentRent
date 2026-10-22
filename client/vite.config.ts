import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin API calls in development: no CORS or cookie headaches.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
});
