import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { uploadToEngine } from "./media.ts";
import { filledArtifact, insideFrame } from "./artifacts.ts";

/** A page that tries everything a page must not be able to do, and one thing it must, and writes down what happened. */
const probe = (engine: string, enginePicture: string, sibling: string, sidecar: string) => `<!doctype html><html><body><pre id="out">running</pre>
<script>
var results = {};
var load = function (make) { return new Promise(function (resolve) { var element = make(); element.onload = function () { resolve("loaded"); }; element.onerror = function () { resolve("blocked"); }; }); };
(async function () {
  try { await fetch(${JSON.stringify(`${engine}/api/projects`)}); results.fetch = "allowed"; } catch (error) { results.fetch = "blocked"; }
  results.socket = await new Promise(function (resolve) {
    try {
      var socket = new WebSocket(${JSON.stringify(`${engine.replace("http", "ws")}/ws`)});
      socket.onopen = function () { resolve("opened"); };
      socket.onerror = function () { resolve("blocked"); };
    } catch (error) { resolve("blocked"); }
  });
  results.enginePicture = await load(function () { var image = new Image(); image.src = ${JSON.stringify(enginePicture)}; return image; });
  results.sibling = await load(function () { var image = new Image(); image.src = ${JSON.stringify(sibling)}; return image; });
  results.sidecar = await load(function () { var script = document.createElement("script"); script.src = ${JSON.stringify(sidecar)}; document.body.appendChild(script); return script; });
  try { results.parent = typeof parent.document.title === "string" ? "read" : "unread"; } catch (error) { results.parent = "blocked"; }
  try { var opened = window.open("about:blank"); results.open = opened ? "opened" : "blocked"; } catch (error) { results.open = "blocked"; }
  try { top.location.href = ${JSON.stringify(`${engine}/?escaped=1`)}; results.top = "attempted"; } catch (error) { results.top = "blocked"; }
  document.getElementById("out").textContent = JSON.stringify(results);
})();
</script></body></html>`;

test("a page cannot reach the engine, load its files, leave its frame or read the canvas; a picture beside it loads", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const picture = await uploadToEngine(engine, "pic.png", pngBytes(8, 8), "image/png");
  const sidecar = picture.replace(/\.png$/, ".json");
  const origin = engine.origin;
  await filledArtifact(engine, { id: "shape:probe", kind: "page", ref: "150", at: { x: 440, y: 60 }, file: "probe.html", title: "Probe", html: probe(origin, `${origin}/api/file/default/${picture}`, picture, sidecar) });
  await expect(shapeOnScreen(page, "shape:probe")).toBeVisible();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(400);
  await clickShape(page, "shape:probe");

  const out = insideFrame(page, "shape:probe").locator("#out");
  await expect(out).not.toHaveText("running", { timeout: 15_000 });
  const results = JSON.parse((await out.textContent()) ?? "{}");
  expect(results).toMatchObject({ fetch: "blocked", socket: "blocked", enginePicture: "blocked", sibling: "loaded", sidecar: "blocked", parent: "blocked", open: "blocked", top: "blocked" });
  // The app is where it was.
  await page.waitForTimeout(500);
  expect(new URL(page.url()).search).toBe("");
  expect(page.context().pages()).toHaveLength(1);
});
