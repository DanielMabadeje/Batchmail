import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    vue(),
    // CRXJS reads manifest.json, treats the paths in it as build inputs, and
    // rewrites them to the hashed bundle names in dist. This is why the
    // manifest points at src/ paths rather than built filenames.
    crx({ manifest }),
  ],

  build: {
    outDir: 'dist',
    // Chrome refuses to load an extension whose scripts have inline
    // sourcemaps under the default CSP.
    sourcemap: process.env.NODE_ENV !== 'production' ? 'inline' : false,
    rollupOptions: {
      input: {
        popup: 'popup.html',
        options: 'options.html',
      },
    },
  },

  server: {
    // CRXJS needs a fixed port for its HMR websocket, since the extension
    // origin can't negotiate one.
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});