/**
 * The component compiler (spec 20): a sheet becomes a self-contained script that defines its
 * custom element. The runtime below is one string, built into every compiled file and, later,
 * into the sheet helper, so the two cannot drift. The compiled file is frozen with its version.
 */
import { readComponentSheet } from "./sheet.ts";

/** The element definer. Its only global is `customElements`; it is wrapped in a block by `compileComponent`. */
export const COMPONENT_RUNTIME = `
function ufDefineComponent(decl, style, template, file) {
  if (customElements.get(decl.tag)) return;
  const variants = Object.keys(decl.variants);
  const props = Object.keys(decl.props);
  class UfComponent extends HTMLElement {
    static get observedAttributes() {
      return variants.concat(props);
    }
    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      const sheet = document.createElement("style");
      sheet.textContent = style;
      root.appendChild(sheet);
      const holder = document.createElement("template");
      holder.innerHTML = template;
      root.appendChild(holder.content.cloneNode(true));
      this.ufBindings = {};
      for (const name of props) {
        if (decl.props[name] === "boolean") continue;
        this.ufBindings[name] = Array.from(root.querySelectorAll('[data-uf-prop="' + name + '"]'), (el) => ({
          el: el,
          text: el.textContent,
          src: el.getAttribute("src"),
        }));
      }
    }
    connectedCallback() {
      this.ufSync();
    }
    attributeChangedCallback() {
      this.ufSync();
    }
    ufSync() {
      for (const name of variants) {
        const value = this.getAttribute(name);
        if (value === null || decl.variants[name].indexOf(value) === -1) {
          this.setAttribute(name, decl.variants[name][0]);
        }
      }
      for (const name of props) {
        const type = decl.props[name];
        if (type === "boolean") continue;
        const value = this.getAttribute(name);
        for (const binding of this.ufBindings[name]) {
          if (type === "text") {
            binding.el.textContent = value === null ? binding.text : value;
          } else if (value !== null) {
            binding.el.setAttribute("src", value);
          } else if (binding.src === null) {
            binding.el.removeAttribute("src");
          } else {
            binding.el.setAttribute("src", binding.src);
          }
        }
      }
    }
  }
  UfComponent.declaration = decl;
  UfComponent.sheet = file;
  customElements.define(decl.tag, UfComponent);
}
`;

/** `<sheet base>.component.js` beside the sheet `<sheet base>.html`. */
export const compiledFileName = (sheetFile: string): string => `${sheetFile.replace(/\.html$/i, "")}.component.js`;

/** A JSON string literal that cannot close a script element or start a comment. */
const literal = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * The compiled script for a sheet. Throws with the reader's refusal when the sheet is not a
 * valid component; the engine checks a sheet before it compiles it.
 */
export const compileComponent = (sheetHtml: string, sheetFile: string): string => {
  const read = readComponentSheet(sheetHtml);
  if (!read.ok) throw new Error(read.refusal);
  const { declaration, style, template } = read.sheet;
  const header = `// Compiled by Unframed from ${sheetFile.replace(/[\r\n\u2028\u2029*/]/g, "_")}. Built from that sheet; do not edit.`;
  return [
    header,
    "(function () {",
    COMPONENT_RUNTIME.trim(),
    `ufDefineComponent(${literal(declaration)}, ${literal(style)}, ${literal(template)}, ${literal(sheetFile)});`,
    "})();",
    "",
  ].join("\n");
};
