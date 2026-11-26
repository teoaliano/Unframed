import { describe, expect, it } from "vitest";
import { inlineViewportUnits, rewriteCssUrls, rootSelectors, screenBridgeSource } from "../src/index.ts";

describe("viewport units in a page copy", () => {
  it("writes every viewport unit as pixels of the page's own viewport", () => {
    expect(inlineViewportUnits("a{height:100vh;width:50vw;min-height:100dvh;max-width:10svw;top:1lvh}", 1280, 800)).toBe("a{height:800px;width:640px;min-height:800px;max-width:128px;top:8px}");
    expect(inlineViewportUnits("a{width:10vmin;height:10vmax;margin:-2.5vw .5vh 1e1vw}", 1280, 800)).toBe("a{width:80px;height:128px;margin:-32px 4px 128px}");
  });

  it("rounds to two decimals", () => {
    expect(inlineViewportUnits("a{width:33.333vw}", 1000, 700)).toBe("a{width:333.33px}");
    expect(inlineViewportUnits("a{width:calc(100vw - 1px)}", 390, 844)).toBe("a{width:calc(390px - 1px)}");
  });

  it("writes rem as pixels when the page's root font size is given", () => {
    expect(inlineViewportUnits("a{padding:1.5rem 2vw}", 1000, 800, 10)).toBe("a{padding:15px 20px}");
    expect(inlineViewportUnits("a{padding:1.5rem}", 1000, 800)).toBe("a{padding:1.5rem}");
  });

  it("leaves strings, url() and names alone", () => {
    const css = `.h-\\[100vh\\],.w10vw,#a-5vw{content:"50vw";background:url(img-10vw.png) ,url("x 2vh.png");--size-10vw:1px;animation:fade10vh 1s}`;
    expect(inlineViewportUnits(css, 1000, 800)).toBe(css);
    expect(inlineViewportUnits(".\\31 0vw{width:10vw}", 1000, 800)).toBe(".\\31 0vw{width:100px}");
    expect(inlineViewportUnits("/* 10vw */a{width:10vw}", 1000, 800)).toBe("/* 10vw */a{width:100px}");
  });
});

describe("url() references in a page copy", () => {
  const upper = (url: string) => (url.startsWith("data:") ? url : `part:${url.toUpperCase()}`);

  it("rewrites quoted and unquoted references to quoted ones", () => {
    expect(rewriteCssUrls(`a{background:url(a.png),URL( 'b c.png' ),url("d.png")}`, upper)).toBe(`a{background:url("part:A.PNG"),url("part:B C.PNG"),url("part:D.PNG")}`);
  });

  it("unescapes the reference before mapping it and escapes the result", () => {
    const seen: string[] = [];
    expect(
      rewriteCssUrls(`a{b:url("q\\"x.png");c:url(sp\\ ace.png)}`, (url) => {
        seen.push(url);
        return `${url}"`;
      }),
    ).toBe(`a{b:url("q\\"x.png\\"");c:url("sp ace.png\\"")}`);
    expect(seen).toEqual(['q"x.png', "sp ace.png"]);
  });

  it("keeps data: URLs as written unless the map changes them", () => {
    const css = `a{background:url(data:image/svg+xml;utf8,<svg/>)}b{c:url( "data:image/png;base64,AA" )}`;
    expect(rewriteCssUrls(css, (url) => url)).toBe(css);
    expect(rewriteCssUrls(`a{b:url(data:x)}`, () => "uf-part:0")).toBe(`a{b:url("uf-part:0")}`);
  });

  it("leaves url text inside strings, comments and longer names alone", () => {
    const css = `a{content:"url(x.png)";b:myurl(x.png)}/* url(y.png) */`;
    expect(rewriteCssUrls(css, upper)).toBe(css);
  });

  it("rewrites references inside @font-face and image-set", () => {
    expect(rewriteCssUrls(`@font-face{font-family:X;src:url(x.woff2) format("woff2"),url(x.woff)}`, upper)).toBe(`@font-face{font-family:X;src:url("part:X.WOFF2") format("woff2"),url("part:X.WOFF")}`);
  });
});

describe("root selectors in a page copy", () => {
  it("maps :root, html and body type selectors to the copy's wrappers", () => {
    expect(rootSelectors(":root")).toBe("[data-uf-html]");
    expect(rootSelectors("html, body")).toBe("[data-uf-html], [data-uf-body]");
    expect(rootSelectors("html.dark body > main")).toBe("[data-uf-html].dark [data-uf-body] > main");
    expect(rootSelectors(":root[data-theme=dark] .x")).toBe("[data-uf-html][data-theme=dark] .x");
    expect(rootSelectors("HTML BODY")).toBe("[data-uf-html] [data-uf-body]");
    expect(rootSelectors("body+div,html~p")).toBe("[data-uf-body]+div,[data-uf-html]~p");
  });

  it("leaves classes, ids, attributes and longer names that contain them alone", () => {
    for (const selector of [".html", "#body", ".html-x", "[data-x=html]", '[title="body"]', "html-viewer", "x-body", "tbody", ".a\\:html", "div.body-copy", "a:hover", ":rooted"]) expect(rootSelectors(selector)).toBe(selector);
  });

  it("maps type selectors inside :is(), :where(), :not() and :has()", () => {
    expect(rootSelectors(":is(html, body) .x")).toBe(":is([data-uf-html], [data-uf-body]) .x");
    expect(rootSelectors(":where(:root) a")).toBe(":where([data-uf-html]) a");
    expect(rootSelectors("div:not(body > *)")).toBe("div:not([data-uf-body] > *)");
    expect(rootSelectors("html:has(dialog[open]) body")).toBe("[data-uf-html]:has(dialog[open]) [data-uf-body]");
  });

  it("leaves arguments that are not selectors alone", () => {
    expect(rootSelectors("x-y::part(body)")).toBe("x-y::part(body)");
    expect(rootSelectors(":lang(html) p")).toBe(":lang(html) p");
    expect(rootSelectors("html::before")).toBe("[data-uf-html]::before");
  });
});

describe("the page copy in the Screen bridge", () => {
  const load = (origin: string) => {
    const listeners: Record<string, Array<(event: any) => void>> = {};
    const posted: Array<{ message: any; to: string }> = [];
    const parent = { postMessage: (message: any, to: string) => posted.push({ message, to }) };
    const win: any = {
      parent,
      location: { origin: "http://127.0.0.1:4101", href: "http://127.0.0.1:4101/", pathname: "/", search: "", hash: "", ancestorOrigins: [origin] },
      document: { readyState: "loading", referrer: "", head: { appendChild: () => undefined }, createElement: () => ({ src: "" }), addEventListener: () => undefined, querySelector: () => null },
      console: { error: () => undefined },
      addEventListener: (type: string, listener: (event: any) => void) => (listeners[type] ??= []).push(listener),
      requestAnimationFrame: () => undefined,
    };
    new Function("window", screenBridgeSource())(win);
    return { win, listeners, posted };
  };

  it("offers window.__unframedSnapshot and answers a take only from a loopback parent", async () => {
    const { win, listeners, posted } = load("http://127.0.0.1:8787");
    expect(typeof win.__unframedSnapshot).toBe("function");
    win.__unframedSnapshot = async () => ({ html: "<p>", w: 1, h: 2, parts: [] });
    for (const listener of listeners.message ?? []) listener({ source: win.parent, origin: "https://evil.example", data: { type: "unframed:snapshot:take" } });
    for (const listener of listeners.message ?? []) listener({ source: win.parent, origin: "http://127.0.0.1:8787", data: { type: "unframed:snapshot:take" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted.filter((entry) => entry.message.type === "unframed:snapshot")).toEqual([
      { message: { type: "unframed:snapshot", href: "http://127.0.0.1:4101/", final: true, snapshot: { html: "<p>", w: 1, h: 2, parts: [] } }, to: "http://127.0.0.1:8787" },
    ]);
  });
});
