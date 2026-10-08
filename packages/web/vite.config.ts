import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type ProxyOptions } from "vite";
import { devShareHeaders, devShareOrigin } from "@unframed/domain";

const clientPort = process.env.UNFRAMED_CLIENT_PORT;
const serverPort = process.env.UNFRAMED_SERVER_PORT ?? "8787";
const port = clientPort === undefined ? 5173 : Number(clientPort);

const shareValue = process.env.UNFRAMED_DEV_SHARE_ORIGIN;
const shareOrigin = devShareOrigin(shareValue);
if (shareValue !== undefined && shareValue.trim() !== "" && shareOrigin === undefined) {
  throw new Error(`UNFRAMED_DEV_SHARE_ORIGIN must be a bare https origin, got ${JSON.stringify(shareValue)}`);
}

// The dev share relay (spec 01). Without a share origin the proxy forwards headers untouched.
const relay: ProxyOptions["configure"] = (proxy) => {
  if (shareOrigin === undefined) return;
  const readdress = (proxyReq: { setHeader(name: string, value: string): void }, req: { headers: Record<string, string | string[] | undefined> }) => {
    const { origin, host } = req.headers;
    const replaced = devShareHeaders({
      shareOrigin,
      loopbackHost: `localhost:${port}`,
      origin: typeof origin === "string" ? origin : undefined,
      host: typeof host === "string" ? host : undefined,
    });
    if (replaced.origin !== undefined) proxyReq.setHeader("origin", replaced.origin);
    if (replaced.host !== undefined) proxyReq.setHeader("host", replaced.host);
  };
  proxy.on("proxyReq", readdress);
  proxy.on("proxyReqWs", readdress);
};

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
    port,
    strictPort: clientPort !== undefined || shareOrigin !== undefined,
    allowedHosts: shareOrigin === undefined ? [] : [new URL(shareOrigin).hostname],
    // The origin is not changed, so the forwarded Host stays this server's loopback
    // name and the browser's Origin is loopback: both pass the engine's guards.
    proxy: {
      "/api": { target: `http://localhost:${serverPort}`, changeOrigin: false, configure: relay },
      "/ws": { target: `ws://localhost:${serverPort}`, ws: true, changeOrigin: false, configure: relay },
      "/sync": { target: `ws://localhost:${serverPort}`, ws: true, changeOrigin: false, configure: relay },
    },
  },
});
