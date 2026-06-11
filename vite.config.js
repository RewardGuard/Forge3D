import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron loads the built files from disk, so use relative asset paths.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
