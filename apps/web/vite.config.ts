import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The browser may only call origins listed in the CSP connect-src (public/_headers).
// When the API lives on another origin (e.g. a workers.dev URL), add it at build time.
function cspApiOrigin(apiBaseUrl: string | undefined): Plugin {
  let outDir = 'dist';
  return {
    name: 'csp-api-origin',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      if (!apiBaseUrl) return;
      const origin = new URL(apiBaseUrl).origin;
      const file = join(outDir, '_headers');
      const headers = readFileSync(file, 'utf8');
      if (!headers.includes("connect-src 'self'")) throw new Error('csp-api-origin: connect-src not found in _headers');
      writeFileSync(file, headers.replace("connect-src 'self'", `connect-src 'self' ${origin}`));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', 'VITE_');
  const apiBaseUrl = process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL;
  return {
    plugins: [react(), tailwindcss(), cspApiOrigin(apiBaseUrl)],
    envDir: '../..',
    server: { proxy: { '/api': process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8787' } },
    preview: { proxy: { '/api': process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8787' } },
    build: { sourcemap: false },
  };
});
