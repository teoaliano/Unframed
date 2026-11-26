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
const TODOS_PAGE = [
  "<!doctype html><html><head><title>Todos</title></head><body>",
  "<h1>Todos</h1><p id=\\"greeting\\"></p><p id=\\"count\\">Loading todos</p><ul id=\\"todos\\"></ul>",
  "<label>Name <input id=\\"todo-name\\"></label><button id=\\"add\\">Add</button>",
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
