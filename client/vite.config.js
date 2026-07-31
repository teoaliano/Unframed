import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Astryx and the app must share one React instance, else hooks throw.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the local Express server so there are no CORS headaches.
      '/api': 'http://localhost:8787',
    },
  },
});
