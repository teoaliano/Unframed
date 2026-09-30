import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const clientPort = process.env.UNFRAMED_CLIENT_PORT;
const serverPort = process.env.UNFRAMED_SERVER_PORT ?? "8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // t3code's UI kit imports itself through "~" (spec 12), kept so its files stay a mechanical merge.
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  // No .env files: the repo's .env holds the OpenRouter key, and nothing from it may
  // reach the client. The one build-time value is read explicitly below.
  envDir: false,
  define: {
    __TLDRAW_LICENSE_KEY__: JSON.stringify(process.env.TLDRAW_LICENSE_KEY ?? ""),
  },
  // tldraw's asset imports use ?url, which the dev dependency bundler cannot follow.
  optimizeDeps: { exclude: ["@tldraw/assets"] },
  build: {
    outDir: process.env.UNFRAMED_WEB_OUT_DIR ?? "dist",
    emptyOutDir: true,
    sourcemap: false,
    // One local bundle, loaded from loopback: its size is not a network cost.
    chunkSizeWarningLimit: 5000,
  },
  server: {
    host: "localhost",
    port: clientPort === undefined ? 5173 : Number(clientPort),
    strictPort: clientPort !== undefined,
    // The origin is not changed, so the forwarded Host stays this server's loopback
    // name and the browser's Origin is loopback: both pass the engine's guards.
    proxy: {
      "/api": { target: `http://localhost:${serverPort}`, changeOrigin: false },
      "/ws": { target: `ws://localhost:${serverPort}`, ws: true, changeOrigin: false },
      "/sync": { target: `ws://localhost:${serverPort}`, ws: true, changeOrigin: false },
    },
  },
});
