import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

const REACT_FIXTURE_ROUTES = String.raw`
const reactFs = require("node:fs");
const reactPath = require("node:path");
const reactFixture = (() => {
  try {
    return JSON.parse(reactFs.readFileSync(reactPath.join(__dirname, "react-fixture.json"), "utf8"));
  } catch {
    return null;
  }
})();
const reactSrc = reactPath.join(__dirname, "src");
const reactVendorEntry = [
  "import * as React from 'react';",
  "export default React;",
  "export const { Children, Component, Fragment, StrictMode, createContext, createElement, forwardRef, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } = React;",
  "export { jsxDEV } from 'react/jsx-dev-runtime';",
  "export { createRoot, hydrateRoot } from 'react-dom/client';",
].join("\n");
let reactVendor = null;
const reactEsbuild = () => require(reactFixture.esbuild);
const jsxFiles = () => reactFs.readdirSync(reactSrc).filter((name) => name.endsWith(".jsx"));
const reactVersion = () => Math.max(0, ...jsxFiles().map((name) => reactFs.statSync(reactPath.join(reactSrc, name)).mtimeMs));
const twEscape = (name) => name.replace(/[^a-zA-Z0-9_-]/g, (char) => "\\" + char);
const TW_SPACE = { p: ["padding"], px: ["padding-left", "padding-right"], py: ["padding-top", "padding-bottom"], pt: ["padding-top"], pr: ["padding-right"], pb: ["padding-bottom"], pl: ["padding-left"], m: ["margin"], mx: ["margin-left", "margin-right"], my: ["margin-top", "margin-bottom"], mt: ["margin-top"], mr: ["margin-right"], mb: ["margin-bottom"], ml: ["margin-left"], gap: ["gap"], h: ["height"], w: ["width"] };
const TW_RANK = ["p", "m", "px", "py", "mx", "my", "pt", "pr", "pb", "pl", "mt", "mr", "mb", "ml", "gap", "h", "w"];
const TW_TEXT = { xs: ["0.75rem", "1rem"], sm: ["0.875rem", "1.25rem"], base: ["1rem", "1.5rem"], lg: ["1.125rem", "1.75rem"], xl: ["1.25rem", "1.75rem"], "2xl": ["1.5rem", "2rem"] };
const TW_FIXED = { flex: "display: flex", "min-h-screen": "min-height: 100vh", "items-center": "align-items: center", hidden: "display: none", rounded: "border-radius: 0.25rem", "rounded-lg": "border-radius: 0.5rem", "font-medium": "font-weight: 500", "font-semibold": "font-weight: 600", "font-bold": "font-weight: 700" };
const twRule = (name) => {
  if (TW_FIXED[name]) return [0, TW_FIXED[name]];
  const text = /^text-(xs|sm|base|lg|xl|2xl)$/.exec(name);
  if (text) return [1, "font-size: " + TW_TEXT[text[1]][0] + "; line-height: " + TW_TEXT[text[1]][1]];
  const colour = /^(text|bg)-\[(#[0-9a-fA-F]{3,8})\]$/.exec(name);
  if (colour) return [3, (colour[1] === "text" ? "color: " : "background-color: ") + colour[2]];
  const space = /^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|h|w)-(?:(\d+(?:\.\d+)?)|\[(\d+(?:\.\d+)?px)\])$/.exec(name);
  if (space) {
    const value = space[3] ?? Number(space[2]) * 0.25 + "rem";
    return [2 + TW_RANK.indexOf(space[1]) / 100, TW_SPACE[space[1]].map((property) => property + ": " + value).join("; ")];
  }
  return null;
};
const twCss = () => {
  const names = new Set();
  for (const file of jsxFiles()) for (const token of reactFs.readFileSync(reactPath.join(reactSrc, file), "utf8").split(/[\s"'{}()<>=,;:]+/)) names.add(token);
  const rules = [];
  for (const name of names) {
    const rule = twRule(name);
    if (rule) rules.push([rule[0], "." + twEscape(name) + " { " + rule[1] + "; }"]);
  }
  return "*, ::before, ::after { box-sizing: border-box; }\n" + rules.sort((a, b) => a[0] - b[0]).map((rule) => rule[1]).join("\n") + "\n";
};
const REACT_IMPORTS = JSON.stringify({ imports: { react: "/node_modules/.vendor/react.js", "react/jsx-dev-runtime": "/node_modules/.vendor/react.js", "react-dom/client": "/node_modules/.vendor/react.js" } });
const reactPage = () => [
  "<!doctype html><html><head><title>React app</title><link rel=\"stylesheet\" href=\"/tw.css\">",
  "<script type=\"importmap\">" + REACT_IMPORTS + "</script>",
  "</head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.jsx\"></script>",
  "<script>(function () { var seen = " + JSON.stringify(reactVersion()) + "; setInterval(function () { fetch('/__fake/version', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (v) { if (v !== seen) location.reload(); }).catch(function () {}); }, 250); })();</script>",
  "</body></html>",
].join("");
const reactRoute = (req, res, url) => {
  if (reactFixture === null) return false;
  const send = (type, body) => {
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
    return true;
  };
  if (url.pathname === "/react" || url.pathname.startsWith("/react/")) return send("text/html; charset=utf-8", reactPage());
  if (url.pathname === "/__fake/version") return send("application/json", JSON.stringify(reactVersion()));
  if (url.pathname === "/tw.css") return send("text/css; charset=utf-8", twCss());
  if (url.pathname === "/node_modules/.vendor/react.js") {
    if (reactVendor === null) {
      reactVendor = reactEsbuild().buildSync({
        stdin: { contents: reactVendorEntry, resolveDir: reactPath.dirname(reactFixture.nodeModules), loader: "js" },
        bundle: true,
        format: "esm",
        write: false,
        nodePaths: [reactFixture.nodeModules],
        define: { "process.env.NODE_ENV": "\"development\"" },
      }).outputFiles[0].text;
    }
    return send("text/javascript; charset=utf-8", reactVendor);
  }
  const jsx = /^\/src\/([\w.-]+\.jsx)$/.exec(url.pathname);
  if (jsx) {
    const file = reactPath.join(reactSrc, jsx[1]);
    if (!reactFs.existsSync(file)) return false;
    const out = reactEsbuild().transformSync(reactFs.readFileSync(file, "utf8"), { loader: "jsx", jsx: "automatic", jsxDev: true, sourcemap: "inline", sourcefile: "/src/" + jsx[1], format: "esm" });
    return send("text/javascript; charset=utf-8", out.code);
  }
  return false;
};
`;

export const FAKE_DEV_SERVER = `const http = require("node:http");
const crypto = require("node:crypto");
${REACT_FIXTURE_ROUTES}
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
const TODOS_PAGE = [
  "<!doctype html><html><head><title>Todos</title></head><body>",
  "<h1>Todos</h1><p id=\\"greeting\\"></p><p id=\\"count\\">Loading todos</p><ul id=\\"todos\\"></ul>",
  "<label>Name <input id=\\"todo-name\\"></label><button id=\\"add\\">Add</button>",
  "<label>Note <input id=\\"todo-note\\" oninput=\\"this.defaultValue = this.value\\"></label>",
  "<script>",
  "function load() { return fetch('/api/todos').then(function (r) { if (!r.ok) throw new Error('no backend'); return r.json(); }).then(function (todos) {",
  "  document.getElementById('count').textContent = todos.length + ' todos';",
  "  var list = document.getElementById('todos'); list.innerHTML = '';",
  "  todos.forEach(function (todo) { var li = document.createElement('li'); li.textContent = todo.title; list.appendChild(li); });",
  "}).catch(function () { document.getElementById('count').textContent = 'No backend'; }); }",
  "document.getElementById('add').onclick = function () { fetch('/api/todos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('todo-name').value }) }).then(load); };",
  "load();",
  "</script>",
  "<script type=\\"module\\">import { greeting } from '/src/greeting.ts'; document.getElementById('greeting').textContent = greeting;</script>",
  "</body></html>",
].join("");
const hits = {};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (reactRoute(req, res, url)) return;
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
  if (url.pathname === "/todos") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(TODOS_PAGE);
  }
  if (url.pathname === "/api/todos") {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "no backend" }));
  }
  if (url.pathname === "/src/greeting.ts") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end('export const greeting = "Real greeting";\\n');
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
server.listen(port, host, () => console.log("  ➜  Local:   http://localhost:" + port + "/"));
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

export const makeRepo = async (name = "My App", files: Readonly<Record<string, string>> = {}) => {
  const root = join(await makeTempDir("unframed-repo-"), name);
  await mkdir(join(root, "src", "pages"), { recursive: true });
  await writeFile(join(root, "package.json"), '{ "name": "fake-app", "private": true, "scripts": { "dev": "node server.js", "postinstall": "node install.js" } }\n');
  await writeFile(join(root, "server.js"), FAKE_DEV_SERVER);
  await writeFile(join(root, "install.js"), 'require("node:fs").writeFileSync("installed.txt", "yes\\n");\n');
  await writeFile(join(root, ".gitignore"), ".env*\n!.env.example\nnode_modules/\npackage-lock.json\ninstalled.txt\n");
  await writeFile(join(root, "src", "pages", "index.html"), "<h1>Hello</h1>\n");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
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
