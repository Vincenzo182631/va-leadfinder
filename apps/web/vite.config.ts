import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '../..',
  server: { proxy: { '/api': process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8787' } },
  preview: { proxy: { '/api': process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8787' } },
  build: { sourcemap: false },
});
