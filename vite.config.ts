import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps the built site working from any folder or host path,
// so dist/ can be dragged straight onto Netlify like the original site.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // three.js + Firebase make one large (but cacheable) bundle; that's expected
    chunkSizeWarningLimit: 2600,
  },
});
