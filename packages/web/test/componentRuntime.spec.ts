import { compileComponent, compiledFileName } from "@unframed/domain";
import { expect, test, type Page } from "@playwright/test";

const ORIGIN = "http://component-fixture.test";
const SHEET_FILE = "1761400000000-button.html";
const COMPILED_FILE = compiledFileName(SHEET_FILE);

const SHEET = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text","icon":"image","disabled":"boolean"},"slots":["","end"]}</script>
<style type="text/x-uf-component" data-uf-component-style>
:host { display: inline-block; }
button { background: #111111; color: #ffffff; }
:host([kind="secondary"]) button { background: #eeeeee; color: #000000; }
:host([disabled]) button { opacity: 0.5; }
</style>
</head><body>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button><img data-uf-prop="icon" src="default.png" alt=""><slot></slot><slot name="end"></slot></div>
</body></html>`;

const PAGE = `<!doctype html><html><head>
<script src="${ORIGIN}/${COMPILED_FILE}" data-uf-component="uf-button"></script>
<script>window.errors = []; window.addEventListener("error", function (event) { window.errors.push(String(event.message)); });</script>
</head><body>
<uf-button id="defaults"></uf-button>
<uf-button id="set" kind="secondary" label="Buy now" icon="pic.png" disabled></uf-button>
<uf-button id="slotted" label="Slots"><span slot="end">end child</span>plain child</uf-button>
<script>
  window.seenAtParse = {
    defaults: !!document.getElementById("defaults").shadowRoot,
    set: !!document.getElementById("set").shadowRoot,
    defined: !!customElements.get("uf-button"),
  };
</script>
<script src="${ORIGIN}/${COMPILED_FILE}" data-uf-component="uf-button"></script>
</body></html>`;

const serve = async (page: Page) => {
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith(`/${COMPILED_FILE}`)) {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: compileComponent(SHEET, SHEET_FILE) });
    }
    if (url.endsWith("/page.html")) return route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
    return route.fulfill({ status: 404, body: "" });
  });
};

const openFixture = async (page: Page) => {
  await serve(page);
  await page.goto(`${ORIGIN}/page.html`);
  await page.waitForFunction(() => customElements.get("uf-button") !== undefined);
};

test.describe("the component runtime in Chrome", () => {
  test("upgrades every instance before the page's own script runs", async ({ page }) => {
    await openFixture(page);
    expect(await page.evaluate(() => (window as unknown as { seenAtParse: unknown }).seenAtParse)).toEqual({
      defaults: true,
      set: true,
      defined: true,
    });
  });

  test("sets an absent or unknown variant to its default on the live element, and styles by it", async ({ page }) => {
    await openFixture(page);
    const defaults = page.locator("#defaults");
    expect(await defaults.getAttribute("kind")).toBe("primary");
    const background = await page.evaluate(() => {
      const host = document.getElementById("defaults")!;
      return getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;
    });
    expect(background).toBe("rgb(17, 17, 17)");
    await page.evaluate(() => document.getElementById("defaults")!.setAttribute("kind", "nope"));
    expect(await defaults.getAttribute("kind")).toBe("primary");
  });

  test("sets text and image properties, and restores the template when the attribute goes", async ({ page }) => {
    await openFixture(page);
    const set = page.locator("#set");
    const shadowText = (id: string) => page.evaluate((hostId) => document.getElementById(hostId)!.shadowRoot!.querySelector("button")!.textContent, id);
    const shadowSrc = (id: string) => page.evaluate((hostId) => document.getElementById(hostId)!.shadowRoot!.querySelector("img")!.getAttribute("src"), id);
    expect(await shadowText("set")).toBe("Buy now");
    expect(await shadowSrc("set")).toBe("pic.png");
    expect(await shadowText("defaults")).toBe("Buy");
    expect(await shadowSrc("defaults")).toBe("default.png");
    await set.evaluate((element) => element.removeAttribute("label"));
    await set.evaluate((element) => element.removeAttribute("icon"));
    expect(await shadowText("set")).toBe("Buy");
    expect(await shadowSrc("set")).toBe("default.png");
  });

  test("matches a boolean property through its attribute", async ({ page }) => {
    await openFixture(page);
    const opacity = await page.evaluate(() => {
      const host = document.getElementById("set")!;
      return getComputedStyle(host.shadowRoot!.querySelector("button")!).opacity;
    });
    expect(opacity).toBe("0.5");
  });

  test("shows an instance's children in its slots", async ({ page }) => {
    await openFixture(page);
    const slots = await page.evaluate(() => {
      const host = document.getElementById("slotted")!;
      const end = host.shadowRoot!.querySelector('slot[name="end"]') as HTMLSlotElement;
      const plain = host.shadowRoot!.querySelector("slot:not([name])") as HTMLSlotElement;
      return {
        end: end.assignedNodes().map((node) => node.textContent),
        plain: plain.assignedNodes().map((node) => (node as Element).textContent ?? node.textContent),
      };
    });
    expect(slots.end).toEqual(["end child"]);
    expect(slots.plain).toEqual(["plain child"]);
  });

  test("a second pin for the same tag throws nothing", async ({ page }) => {
    await openFixture(page);
    expect(await page.evaluate(() => (window as unknown as { errors: string[] }).errors)).toEqual([]);
    expect(await page.evaluate(() => customElements.get("uf-button") !== undefined)).toBe(true);
  });
});
