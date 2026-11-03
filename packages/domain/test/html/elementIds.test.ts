import { describe, expect, it } from "vitest";
import { stampElementIds } from "../../src/html/index.ts";

const ID = /^hf-[0-9a-z]{4}$/;
const idsIn = (html: string): string[] => [...html.matchAll(/data-hf-id="([^"]*)"/g)].map((m) => m[1]!);
const withoutIds = (html: string): string => html.replace(/ data-hf-id="[^"]*"/g, "");

describe("stampElementIds", () => {
  it("mints an id on every body element and keeps an existing one", () => {
    const out = stampElementIds('<body><h1>Hi</h1><p data-hf-id="hf-keep">a</p></body>');
    expect(out).toContain('<p data-hf-id="hf-keep">a</p>');
    const minted = out.match(/<h1 data-hf-id="([^"]+)">Hi<\/h1>/);
    expect(minted?.[1]).toMatch(ID);
  });

  it("gives identical twins distinct ids", () => {
    const ids = idsIn(stampElementIds("<span>x</span><span>x</span><span>x</span>"));
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(ID);
  });

  it("re-mints a later duplicate and leaves the first in document order holding the id", () => {
    const html = '<div><p data-hf-id="hf-aaaa">one</p><p data-hf-id="hf-aaaa">two</p></div>';
    const out = stampElementIds(html);
    const second = out.match(/<p data-hf-id="([^"]+)">two<\/p>/)?.[1];
    expect(second).toMatch(ID);
    expect(second).not.toBe("hf-aaaa");
    expect(out).toMatch(/<p data-hf-id="hf-aaaa">one<\/p>/);
    expect(new Set(idsIn(out)).size).toBe(idsIn(out).length);
  });

  it("gives a fresh id to a copy that holds the same id as a sibling with other text", () => {
    const html = '<div data-hf-id="hf-bbbb"><p data-hf-id="hf-cccc">x</p><p data-hf-id="hf-cccc">y</p></div>';
    const out = stampElementIds(html);
    expect(out.startsWith('<div data-hf-id="hf-bbbb"><p data-hf-id="hf-cccc">x</p><p data-hf-id="')).toBe(true);
    expect(new Set(idsIn(out)).size).toBe(3);
  });

  it("stamps a document that has a doctype and a body but no html tag", () => {
    const html = '<!doctype html>\n<body>\n  <div class="card"><p>a</p></div>\n</body>';
    const out = stampElementIds(html);
    expect(withoutIds(out)).toBe(html);
    expect(idsIn(out)).toHaveLength(2);
  });

  it("gives no id to html, head, body, a title in head, or the excluded tags", () => {
    const out = stampElementIds(
      '<!doctype html><html><head><title>T</title><style>p{}</style><meta charset="utf-8"><link rel="x"></head>' +
        "<body><p>a</p><script>var x = 1</script><noscript></noscript></body></html>",
    );
    expect(out).toMatch(/<html>/);
    expect(out).toMatch(/<head>/);
    expect(out).toMatch(/<title>T<\/title>/);
    expect(out).toMatch(/<body>/);
    expect(out).toMatch(/<p data-hf-id="hf-[0-9a-z]{4}">a<\/p>/);
    expect(out).toMatch(/<script>var x = 1<\/script>/);
    expect(out).toMatch(/<noscript><\/noscript>/);
    expect(idsIn(out)).toHaveLength(1);
  });

  it("keeps the head and body out of a fragment that carries those tags itself", () => {
    const out = stampElementIds("<head><title>t</title></head><p>x</p>");
    expect(out).toBe(`<head><title>t</title></head><p data-hf-id="${idsIn(out)[0]}">x</p>`);
  });

  it("gives no id inside a plain template, and gives ids inside a composition template", () => {
    const plain = stampElementIds("<div><template><span>x</span></template><b>y</b></div>");
    expect(plain).toMatch(/<template><span>x<\/span><\/template>/);
    expect(idsIn(plain)).toHaveLength(2);

    const composition = stampElementIds('<div><template data-composition-id="c"><span>x</span></template></div>');
    expect(composition).toMatch(/<template data-composition-id="c"><span data-hf-id="hf-[0-9a-z]{4}">x<\/span><\/template>/);
    expect(idsIn(composition)).toHaveLength(2);
  });

  it("writes an id only where it is missing and changes no other byte", () => {
    const html = '<!doctype html>\n<body>\n  <div class="card">\n    <h2 style="color: red">Title &amp; more</h2>\n    <img src="a.png" alt="A">\n  </div>\n</body>';
    const out = stampElementIds(html);
    expect(withoutIds(out)).toBe(html);
    expect(idsIn(out)).toHaveLength(3);
  });

  it("leaves a file that already has every id and no duplicate exactly as given", () => {
    const html = '<P  data-hf-id="hf-aaaa"  >a</P>\n<span data-hf-id="hf-bbbb" >b</span>';
    expect(stampElementIds(html)).toBe(html);
  });

  it("is idempotent", () => {
    const once = stampElementIds('<body><p>a</p><p>a</p><section><em>x</em></section></body>');
    expect(stampElementIds(once)).toBe(once);
  });

  it("keeps the first copy's id when a whole subtree is copied", () => {
    const html = '<section data-hf-id="hf-dddd"><p data-hf-id="hf-eeee">a</p></section><section data-hf-id="hf-dddd"><p data-hf-id="hf-eeee">a</p></section>';
    const out = stampElementIds(html);
    const ids = idsIn(out);
    expect(ids[0]).toBe("hf-dddd");
    expect(ids[1]).toBe("hf-eeee");
    expect(new Set(ids).size).toBe(4);
  });

  it("does not change an attribute on an element outside the scope that already had one", () => {
    const html = '<head data-hf-id="hf-hhhh"></head><p>a</p>';
    expect(stampElementIds(html)).toBe(`<head data-hf-id="hf-hhhh"></head><p data-hf-id="${idsIn(stampElementIds(html))[1]}">a</p>`);
  });

  it("writes the ids into markup the package re-serialises, and says so by changing its bytes", () => {
    // An unquoted attribute holding a quote: the package's in-place path cannot align it, so it re-serialises.
    const out = stampElementIds('<p a=b"c>x</p><span>y</span>');
    expect(out).toContain('a="b&quot;c"');
    expect(idsIn(out)).toHaveLength(2);
    expect(stampElementIds(out)).toBe(out);
  });

  it("gives no id to an element inside a noscript, in the body or the head", () => {
    const body = stampElementIds("<body><p>x</p><noscript><i>q</i></noscript></body>");
    expect(body).toBe(`<body><p data-hf-id="${idsIn(body)[0]}">x</p><noscript><i>q</i></noscript></body>`);

    const doc = stampElementIds(
      '<!doctype html><html><head><title>T</title><noscript><link rel="x"><span>h</span></noscript></head>' +
        "<body><div><noscript><p>a</p></noscript><b>b</b></div><noscript><em>c</em></noscript></body></html>",
    );
    expect(doc).toMatch(/<noscript><link rel="x"><span>h<\/span><\/noscript>/);
    expect(doc).toMatch(/<noscript><p>a<\/p><\/noscript>/);
    expect(doc).toMatch(/<noscript><em>c<\/em><\/noscript>/);
    expect(idsIn(doc)).toHaveLength(2);
    expect(stampElementIds(doc)).toBe(doc);
  });

  it("gives no id inside a noscript when the source needs a re-serialised stamp", () => {
    const out = stampElementIds('<p a=b"c>x</p><noscript><i>q</i></noscript>');
    expect(out).toContain("<noscript><i>q</i></noscript>");
    expect(idsIn(out)).toHaveLength(1);
  });
});
