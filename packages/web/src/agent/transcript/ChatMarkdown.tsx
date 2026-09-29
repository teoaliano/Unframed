import { Menu } from "@base-ui/react/menu";
import { Check, Copy, Ellipsis, WrapText } from "lucide-react";
import { memo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { itemClass, popupClass } from "../../chrome/ui.tsx";

const COPIED_MS = 1200;

const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node.props as { children?: ReactNode }).children);
  return "";
};

/** A fenced block with t3code's toolbar: line wrapping, Copy code (Copied for 1.2 s) and a language badge. No highlighter. */
const CodeBlock = ({ children, ...rest }: ComponentPropsWithoutRef<"pre">) => {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string; children?: ReactNode } } | undefined;
  const language = /language-([\w+-]+)/.exec(code?.props?.className ?? "")?.[1];
  const source = textOf(code?.props?.children).replace(/\n$/, "");
  const copy = () => {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  };
  return (
    <div className="chat-markdown-codeblock" data-wrap={wrap ? "" : undefined}>
      <div className="chat-markdown-codeblock__toolbar">
        {language !== undefined && <span className="chat-markdown-codeblock__language">{language}</span>}
        <span className="flex-1" />
        <button type="button" aria-label={wrap ? "Disable line wrap" : "Wrap lines"} title={wrap ? "Disable line wrap" : "Wrap lines"} onClick={() => setWrap(!wrap)}>
          <WrapText size={13} aria-hidden />
        </button>
        <button type="button" aria-label={copied ? "Copied" : "Copy code"} title={copied ? "Copied" : "Copy code"} onClick={copy}>
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        </button>
      </div>
      <pre {...rest}>{children}</pre>
    </div>
  );
};

const tableRows = (table: HTMLTableElement): string[][] =>
  [...table.rows].map((row) => [...row.cells].map((cell) => (cell.textContent ?? "").trim()));

const asMarkdown = (rows: string[][]): string => {
  const line = (cells: string[]) => `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
  const [head, ...body] = rows;
  if (!head) return "";
  return [line(head), line(head.map(() => "---")), ...body.map(line)].join("\n");
};

const asCsv = (rows: string[][]): string =>
  rows.map((cells) => cells.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n");

/** A table scrolls in its wrapper and offers Copy as Markdown and Copy as CSV. */
const Table = ({ children, ...rest }: ComponentPropsWithoutRef<"table">) => {
  const table = useRef<HTMLTableElement>(null);
  const copy = (format: "markdown" | "csv") => {
    if (!table.current) return;
    const rows = tableRows(table.current);
    void navigator.clipboard.writeText(format === "markdown" ? asMarkdown(rows) : asCsv(rows));
  };
  return (
    <div className="chat-markdown-table">
      <Menu.Root>
        <Menu.Trigger className="chat-markdown-table__actions" aria-label="Table actions">
          <Ellipsis size={14} aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-[1200]">
            <Menu.Popup className={popupClass}>
              <Menu.Item className={itemClass} onClick={() => copy("markdown")}>
                Copy as Markdown
              </Menu.Item>
              <Menu.Item className={itemClass} onClick={() => copy("csv")}>
                Copy as CSV
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <div className="chat-markdown-table__scroll" data-scrolls="true">
        <table ref={table} {...rest}>
          {children}
        </table>
      </div>
    </div>
  );
};

const COMPONENTS: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  table: ({ node: _node, ...props }) => <Table {...props} />,
  a: ({ node: _node, href, children, ...props }) =>
    href === undefined || href === "" ? (
      <span>{children}</span>
    ) : (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
};

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

/**
 * Raw HTML becomes the text it is: an inline tag is plain text, a block of it a paragraph
 * of text. Nothing a model writes as markup is ever parsed.
 */
const htmlAsText = () => (tree: MarkdownNode) => {
  const walk = (node: MarkdownNode) => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type !== "html") {
        walk(child);
        return child;
      }
      const text: MarkdownNode = { type: "text", value: child.value ?? "" };
      return node.type === "root" || node.type === "blockquote" || node.type === "listItem" ? { type: "paragraph", children: [text] } : text;
    });
  };
  walk(tree);
};

/** Drops `javascript:` and every other unsafe scheme, as react-markdown does. */
const urlTransform = (url: string): string => defaultUrlTransform(url);

/**
 * The agent's text as markdown (t3code's `ChatMarkdown`, its `.chat-markdown` rules on the
 * ported tokens). Raw HTML is never parsed: no rehype-raw and no sanitiser, so markup in a
 * reply shows as the text it is. That is the one deliberate difference from t3code.
 */
export const ChatMarkdown = memo(({ text }: { readonly text: string }) => (
  <div className="chat-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, htmlAsText]} components={COMPONENTS} urlTransform={urlTransform}>
      {text}
    </ReactMarkdown>
  </div>
));
