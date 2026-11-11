import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
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

// The Home Screen files (spec 23), served at the root under fixed names so an iPad can
// add the app to its Home Screen. The icon is read from assets/brand, which stays the one
// place the mark lives; the engine serves both to an unpaired device.
const HOME_SCREEN: ReadonlyArray<{ readonly name: string; readonly type: string; readonly read: () => string | Uint8Array }> = [
  {
    name: "manifest.webmanifest",
    type: "application/manifest+json",
    read: () =>
      JSON.stringify(
        {
          name: "Unframed",
          short_name: "Unframed",
          display: "standalone",
          start_url: "/",
          scope: "/",
          background_color: "#fcfcfc",
          theme_color: "#fcfcfc",
          icons: [{ src: "/apple-touch-icon.png", sizes: "1024x1024", type: "image/png", purpose: "any" }],
        },
        null,
        2,
      ),
  },
  {
    name: "apple-touch-icon.png",
    type: "image/png",
    read: () => readFileSync(fileURLToPath(new URL("../../assets/brand/app-icon.png", import.meta.url))),
  },
];

const homeScreen = (): Plugin => ({
  name: "unframed-home-screen",
  configureServer: (server) => {
    server.middlewares.use((req, res, next) => {
      const file = HOME_SCREEN.find((candidate) => (req.url ?? "").split("?")[0] === `/${candidate.name}`);
      if (file === undefined) {
        next();
        return;
      }
      res.setHeader("content-type", file.type);
      res.end(file.read());
    });
  },
  generateBundle() {
    for (const file of HOME_SCREEN) this.emitFile({ type: "asset", fileName: file.name, source: file.read() });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), homeScreen()],
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
