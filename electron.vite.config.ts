import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Strict Content Security Policy for the packaged renderer. It is only added to
// production builds because Vite's dev server injects inline scripts for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Pictures, PDFs, sound and video among the notes are shown from the notes folder itself (file:).
  "img-src 'self' data: blob: file:",
  "media-src 'self' blob: file:",
  "frame-src file:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function productionCsp(): Plugin {
  return {
    name: 'neuralvault-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// The shipped bundle is minified and carries no comments at all: the source's comments stay in the source. Third-party
// licence texts ship in THIRD_PARTY_NOTICES.md (tools/third-party-notices.mjs), so no licence header is needed inline.
const STRIPPED = { comments: { legal: false, annotation: false, jsdoc: false } } as const;

export default defineConfig({
  main: { build: { minify: true, rollupOptions: { output: STRIPPED } } },
  preload: {
    // A sandboxed preload can't load modules from node_modules, so bundle everything.
    build: { externalizeDeps: false, minify: true, rollupOptions: { output: STRIPPED } },
  },
  renderer: {
    plugins: [react(), productionCsp()],
    // The window, and Quick capture's box (src/main/capture.ts) as a small page of its own.
    build: {
      minify: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html'), capture: resolve(__dirname, 'src/renderer/capture.html') },
        output: STRIPPED,
      },
    },
  },
});
