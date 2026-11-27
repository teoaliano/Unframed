import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeShell } from "./agentFakes.ts";
import { makeTempDir } from "./engineProcess.ts";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv, stdio: ["ignore", "pipe", "pipe"] }).toString();

export const FAKE_DEV_SERVER = `const http = require("node:http");
const crypto = require("node:crypto");
const args = process.argv.slice(2);
if (process.env.FAKE_DEV_EXIT_CODE) {
  console.error("fake dev server: giving up");
  process.exit(Number(process.env.FAKE_DEV_EXIT_CODE));
}
if (process.env.FAKE_DEV_LINGER_MS && !process.env.FAKE_DEV_DETACHED) {
  const child = require("node:child_process").spawn(process.execPath, [__filename, ...args], { detached: true, stdio: "inherit", env: { ...process.env, FAKE_DEV_DETACHED: String(process.pid) } });
  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
    process.exit(0);
  });
  return;
}
const flag = args.indexOf("--port");
const port = Number(process.env.FAKE_DEV_LISTEN_PORT || (flag >= 0 ? args[flag + 1] : process.env.PORT) || 3000);
const host = process.env.FAKE_DEV_HOST || "127.0.0.1";
const APP_PAGE = [
  "<!doctype html><html><head><title>Fake app</title></head><body>",
  "<h1>Fake app</h1>",
  "<button id=\\"menu-button\\" aria-haspopup=\\"menu\\" onclick=\\"document.getElementById('menu').hidden = false\\">Menu</button>",
  "<div id=\\"menu\\" role=\\"menu\\" hidden><div role=\\"menuitem\\" tabindex=\\"-1\\">Settings</div></div>",
  "<label>Search <input id=\\"search-box\\" oninput=\\"document.getElementById('echo').textContent = this.value\\"></label><p id=\\"echo\\"></p>",
  "<a id=\\"about\\" href=\\"/app/about\\" onclick=\\"event.preventDefault(); history.pushState({}, '', '/app/about'); document.getElementById('where').textContent = location.pathname\\">About</a>",
  "<p id=\\"where\\"></p>",
  "<p id=\\"list-state\\">Loading items</p><ul id=\\"items\\"></ul>",
  "<script>",
  "document.getElementById('where').textContent = location.pathname;",
  "fetch('/api/items').then(function (r) { return r.json(); }).then(function (items) {",
  "  document.getElementById('list-state').textContent = items.length === 0 ? 'No items yet' : items.length + ' items';",
  "  items.forEach(function (item) { var li = document.createElement('li'); li.textContent = item; document.getElementById('items').appendChild(li); });",
  "}).catch(function () { document.getElementById('list-state').textContent = 'Could not load items'; });",
  "</script></body></html>",
].join("");
const hits = {};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/login") {
    res.writeHead(302, { "set-cookie": "session=signed-in; Path=/; SameSite=Lax; HttpOnly", location: "http://localhost:" + port + "/" });
    return res.end();
  }
  if (url.pathname === "/whoami") {
    if (url.searchParams.has("login") && !(req.headers.cookie ?? "").includes("session=")) {
      res.writeHead(302, { "set-cookie": "session=signed-in; Path=/; SameSite=Lax; HttpOnly", location: "/whoami" });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end("<!doctype html><html><head><title>Who</title></head><body><p id=\\"who\\">" + (req.headers.cookie ?? "nobody") + "</p><script>if (!document.cookie.includes('theme=')) { document.cookie = 'theme=dark; Path=/; SameSite=Lax'; location.reload(); }</script></body></html>");
  }
  if (url.pathname.endsWith("/__fake/info")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ argv: args, envPort: process.env.PORT ?? null, cwd: process.cwd(), pid: process.pid, host: req.headers.host ?? null, cookie: req.headers.cookie ?? null, origin: req.headers.origin ?? null, acceptEncoding: req.headers["accept-encoding"] ?? null }));
  }
  if (url.pathname === "/deny") {
    res.writeHead(200, { "content-type": "text/html", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'; script-src 'self' 'nonce-fake123'" });
    return res.end("<html><head><title>Deny</title></head><body>deny</body></html>");
  }
  if (url.pathname === "/split") {
    res.writeHead(200, { "content-type": "text/html" });
    res.write("<!doctype html><html><he");
    return setTimeout(() => res.end("ad><title>Split</title></head><body>split</body></html>"), 50);
  }
  if (url.pathname === "/slow") {
    return setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><head><title>Slow</title></head><body><h1>Slow " + url.search + "</h1></body></html>");
    }, Number(url.searchParams.get("ms") || 1000));
  }
  if (url.pathname === "/__fake/hits") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(hits[url.searchParams.get("key")] || 0));
  }
  if (url.pathname === "/flaky") {
    const key = url.searchParams.get("key") || "";
    hits[key] = (hits[key] || 0) + 1;
    const ready = hits[key] > Number(url.searchParams.get("fails") || 1);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end("<!doctype html><html><head><title>Flaky</title></head><body><p id=\\"load\\">Load " + hits[key] + "</p><div id=\\"menu\\" role=\\"menu\\" hidden><div role=\\"menuitem\\">Settings</div></div>" + (ready ? "<button onclick=\\"document.getElementById('menu').hidden = false\\">Open menu</button>" : "") + "</body></html>");
  }
  if (url.pathname === "/boot") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end([
      "<!doctype html><html><head><title>Booting</title></head><body><p id=\\"boot\\">Booting</p><div id=\\"menu\\" role=\\"menu\\" hidden><div role=\\"menuitem\\">Settings</div></div><script>",
      "var until = Date.now() + Number(new URLSearchParams(location.search).get('ms') || 7000);",
      "var tick = function () {",
      "  if (Date.now() < until) return fetch('/api/items?t=' + Date.now()).then(function () { setTimeout(tick, 150); });",
      "  var button = document.createElement('button'); button.textContent = 'Open menu'; button.onclick = function () { document.getElementById('menu').hidden = false; };",
      "  document.getElementById('boot').textContent = 'Booted'; document.body.appendChild(button);",
      "};",
      "tick();",
      "</script></body></html>",
    ].join(""));
  }
  if (url.pathname === "/dials") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<!doctype html><html><head><title>Dials</title></head><body><h1 id=\\"title\\">Tuned</h1><script>window.unframed?.dials(\\"Look\\", { accent: \\"#ff0000\\" }, function (v) { document.getElementById(\\"title\\").dataset.accent = v.accent; }, { accent: \\"The heading colour\\" });</script></body></html>");
  }
  if (url.pathname === "/corrupt") {
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
    return res.end("this is not gzip");
  }
  if (url.pathname === "/headless") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<body>no head here</body>");
  }
  if (url.pathname === "/page-text") {
    let text = "";
    try {
      text = require("node:fs").readFileSync("page.txt", "utf8");
    } catch {}
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end("<!doctype html><html><head><title>Page text</title></head><body><h1 id=\\"text\\">" + text.replace(/</g, "&lt;") + "</h1></body></html>");
  }
  if (url.pathname === "/webgl") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end([
      "<!doctype html><html><head><title>WebGL</title><style>body { margin: 0; background: rgb(255, 255, 255); } canvas.pill { display: block; width: 200px; height: 100px; border-radius: 50px; } canvas.idle { display: block; width: 100px; height: 50px; background: rgb(255, 0, 0); }</style></head>",
      "<body><canvas class=\\"pill\\" id=\\"gl\\" width=\\"200\\" height=\\"100\\" role=\\"img\\" aria-label=\\"Glow\\" data-kind=\\"glow\\"></canvas><canvas class=\\"idle\\" id=\\"idle\\" width=\\"100\\" height=\\"50\\"></canvas><script>",
      "document.getElementById('idle').getContext('webgl', { alpha: false });",
      "var gl = document.getElementById('gl').getContext('webgl', { alpha: false });",
      "var draw = function () { gl.clearColor(0, 0.5, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(draw); };",
      "requestAnimationFrame(draw);",
      "</script></body></html>",
    ].join(""));
  }
  if (url.pathname === "/logo.png") {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
  }
  if (url.pathname === "/busy") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end([
      "<!doctype html><html><head><title>Busy</title><style>",
      ":root { --accent: rgb(59, 130, 246); } html { font-family: sans-serif; } body { margin: 0; background: rgb(248, 250, 252); }",
      ".bar { height: 10vh; background: var(--accent); color: white; display: flex; align-items: center; padding: 0 16px; }",
      ".card { margin: 12px; padding: 12px; border-radius: 8px; background: white; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }",
      ".spin { width: 24px; height: 24px; border: 3px solid rgb(204, 204, 204); border-top-color: var(--accent); border-radius: 50%; }",
      "@media (max-width: 500px) { .wide { display: none; } }",
      "</style></head><body><div class=\\"bar\\" id=\\"bar\\">Busy app " + url.search + "</div><div class=\\"card wide\\" id=\\"wide\\">Wide only</div>",
      "<div class=\\"card\\">Frame <span id=\\"tick\\">0</span></div><img id=\\"logo\\" src=\\"/logo.png\\" width=\\"32\\" height=\\"32\\" alt=\\"\\"><div class=\\"spin\\" id=\\"spin\\"></div>",
      "<script>var n = 0; var f = function () { n++; document.getElementById('tick').textContent = n; document.getElementById('spin').style.transform = 'rotate(' + (n * 6) + 'deg)'; var x = 0; for (var i = 0; i < 20000; i++) x += Math.sqrt(i); requestAnimationFrame(f); }; requestAnimationFrame(f);</script>",
      "</body></html>",
    ].join(""));
  }
  if (url.pathname === "/api/items") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(["Apples", "Pears"]));
  }
  if (url.pathname.startsWith("/app")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(APP_PAGE);
  }
  const html = "<!doctype html><html><head><title>Fake app</title></head><body><h1>Fake app</h1><p id=\\"path\\">" + url.pathname + "</p><p id=\\"search\\">" + url.search + "</p></body></html>";
  if (/gzip/.test(req.headers["accept-encoding"] || "")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" });
    return res.end(require("node:zlib").gzipSync(html));
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});
server.on("upgrade", (req, socket) => {
  if (req.url.split("?")[0] === "/ws" && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
    console.log("fake dev server: refused /ws, Origin " + req.headers.origin + " is not Host " + req.headers.host);
    return socket.end("HTTP/1.1 403 Forbidden\\r\\nConnection: close\\r\\n\\r\\n");
  }
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n");
  const payload = Buffer.from("hello " + req.url + " from " + (req.headers.origin || "nowhere") + " at " + (req.headers.host || ""));
  socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  socket.on("error", () => {});
});
setTimeout(() => server.listen(port, host, () => console.log("  ➜  Local:   http://localhost:" + port + "/")), Number(process.env.FAKE_DEV_LISTEN_DELAY_MS || 0));
const linger = () => setTimeout(() => process.exit(0), Number(process.env.FAKE_DEV_LINGER_MS));
process.on("SIGTERM", () => (process.env.FAKE_DEV_DETACHED ? linger() : process.exit(0)));
if (process.env.FAKE_DEV_DETACHED) {
  const watch = setInterval(() => {
    try {
      process.kill(Number(process.env.FAKE_DEV_DETACHED), 0);
    } catch {
      clearInterval(watch);
      linger();
    }
  }, 200);
}
`;

export const makeRepo = async (name = "My App") => {
  const root = join(await makeTempDir("unframed-repo-"), name);
  await mkdir(join(root, "src", "pages"), { recursive: true });
  await writeFile(join(root, "package.json"), '{ "name": "fake-app", "private": true, "scripts": { "dev": "node server.js", "postinstall": "node install.js" } }\n');
  await writeFile(join(root, "server.js"), FAKE_DEV_SERVER);
  await writeFile(join(root, "install.js"), 'require("node:fs").writeFileSync("installed.txt", "yes\\n");\n');
  await writeFile(join(root, ".gitignore"), ".env*\n!.env.example\nnode_modules/\npackage-lock.json\ninstalled.txt\n");
  await writeFile(join(root, "src", "pages", "index.html"), "<h1>Hello</h1>\n");
  git(root, "init", "-q", "-b", "trunk");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  return realpath(root);
};

export const repoEngineEnv = async (env: Record<string, string | undefined> = {}) => {
  const dir = await makeTempDir("unframed-repo-shell-");
  const scripts = join(dir, "no-scripts");
  await mkdir(scripts);
  return { SHELL: await fakeShell(join(dir, "shell")), FAKE_SHELL_PATH: "", UNFRAMED_TEST_AGENT_SCRIPT: scripts, ...env };
};
