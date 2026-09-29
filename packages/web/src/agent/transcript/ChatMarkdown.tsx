import { Check, Copy, WrapText } from "lucide-react";
import { memo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Tip } from "../../chrome/ui.tsx";

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
  const wrapLabel = wrap ? "Disable line wrap" : "Wrap lines";
  const copyLabel = copied ? "Copied" : "Copy code";
  return (
    <div
      className="chat-markdown-codeblock my-[0.65rem] overflow-hidden rounded-lg border border-border/70 bg-secondary leading-snug dark:border-transparent dark:bg-input/32"
      data-language={language}
      data-wrap={wrap ? "true" : "false"}
      data-testid="code-block"
    >
      <div className="chat-markdown-codeblock-header flex items-center justify-between gap-2 pt-1.5 pr-1.5 pb-0 pl-3 select-none">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-2xs">{language !== undefined && <span className="truncate">{language}</span>}</span>
        <span className="flex items-center gap-0.5" role="toolbar" aria-label="Code block actions">
          <Tip label={wrapLabel} side="top">
            <Button variant={wrap ? "secondary" : "ghost-muted"} size="icon-xs" aria-pressed={wrap} aria-label={wrapLabel} onClick={() => setWrap(!wrap)}>
              <WrapText aria-hidden className="size-3" />
            </Button>
          </Tip>
          <Tip label={copyLabel} side="top">
            <Button variant="ghost-muted" size="icon-xs" aria-label={copyLabel} onClick={copy}>
              {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
            </Button>
          </Tip>
        </span>
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
    <div className="chat-markdown-table-container">
      <div className="w-full max-w-full overflow-x-auto" data-scrolls="true">
        <table ref={table} {...rest}>
          {children}
        </table>
      </div>
      <div className="mt-0.5 flex items-center justify-end select-none">
        <Menu>
          <MenuTrigger render={<Button variant="ghost-muted" size="icon-xs" aria-label="Table actions" />}>
            <Copy aria-hidden className="size-3" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => copy("markdown")}>Copy as Markdown</MenuItem>
            <MenuItem onClick={() => copy("csv")}>Copy as CSV</MenuItem>
          </MenuPopup>
        </Menu>
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
  <div className="chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/[calc(80%+var(--appearance-contrast-boost)/5)] [overflow-wrap:anywhere] [word-break:break-word]">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, htmlAsText]} components={COMPONENTS} urlTransform={urlTransform}>
      {text}
    </ReactMarkdown>
  </div>
));
