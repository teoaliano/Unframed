import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Astryx and the app must share one React instance, else hooks throw.
  resolve: { dedupe: ['react', 'react-dom'] },
  // Both ports can be moved together from the environment, so two checkouts (a worktree
  // beside main) can each run their own stack without colliding. Unset, the defaults
  // are what they always were. strictPort when a port was asked for: a taken port must
  // fail loudly, not slide to the next one and leave a tab attached to the wrong server.
  server: {
    port: Number(process.env.UNFRAMED_CLIENT_PORT) || 5173,
    strictPort: Boolean(process.env.UNFRAMED_CLIENT_PORT),
    proxy: {
      // Forward API calls to the local Express server so there are no CORS headaches.
      '/api': `http://localhost:${Number(process.env.UNFRAMED_SERVER_PORT) || 8787}`,
    },
  },
});
