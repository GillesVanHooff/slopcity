import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~550 kB minified; revisit with code splitting once the app grows.
    chunkSizeWarningLimit: 800,
  },
});
