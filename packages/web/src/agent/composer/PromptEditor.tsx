import { mergeAttributes, Node, type Editor as TiptapEditor, type JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

/**
 * An inline chip in the draft: a mention of a shape or a file, or a skill. It is one atom,
 * so the arrow keys step over it in one press, and it serialises into the text the model
 * reads.
 */
export interface DraftChip {
  readonly kind: "mention" | "skill";
  /** A mention's kind word ("Prompt", "Image", "Page", "File", ...); unused for a skill. */
  readonly label: string;
  /** A mention's shape id or file name; a skill's name. */
  readonly ref: string;
  readonly title: string;
}

/** How a chip reads in the text sent: `[<Kind>: <label>; ref=<id>]`, or `$<name>` for a skill. */
export const serialiseChip = (chip: DraftChip): string => (chip.kind === "skill" ? `$${chip.ref}` : `[${chip.label}: ${chip.title}; ref=${chip.ref}]`);

const CHIP_TOKEN = /\[([A-Z][A-Za-z]*): ([^;\]]*); ref=([^\]]+)\]/g;

const ChipNode = Node.create({
  name: "agentChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes: () => ({ kind: { default: "mention" }, label: { default: "" }, ref: { default: "" }, title: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-agent-chip]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, {
      "data-agent-chip": node.attrs.kind,
      "data-ref": node.attrs.ref,
      class: "mx-px inline-flex h-[1.41em] max-w-full items-center rounded-[0.5em] border border-border/70 bg-accent/40 px-[0.5em] align-middle font-medium text-[0.86em] leading-none whitespace-nowrap text-foreground",
      contenteditable: "false",
    }),
    node.attrs.kind === "skill" ? `$${node.attrs.ref}` : `${node.attrs.title}`,
  ],
  renderText: ({ node }) => serialiseChip(node.attrs as DraftChip),
});

/** The draft as the text the model reads: paragraphs joined by `\n`, chips serialised. */
export const draftText = (doc: JSONContent): string => {
  const inline = (node: JSONContent): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "agentChip") return serialiseChip(node.attrs as DraftChip);
    return (node.content ?? []).map(inline).join("");
  };
  return (doc.content ?? []).map(inline).join("\n");
};

/** Text back into a document: serialised chips become chips again. */
export const draftDoc = (text: string): JSONContent => ({
  type: "doc",
  content: text.split("\n").map((line) => {
    const content: JSONContent[] = [];
    let at = 0;
    for (const match of line.matchAll(CHIP_TOKEN)) {
      if (match.index > at) content.push({ type: "text", text: line.slice(at, match.index) });
      content.push({ type: "agentChip", attrs: { kind: "mention", label: match[1], title: match[2], ref: match[3] } });
      at = match.index + match[0].length;
    }
    if (at < line.length) content.push({ type: "text", text: line.slice(at) });
    return content.length === 0 ? { type: "paragraph" } : { type: "paragraph", content };
  }),
});

/** Marks a transaction the composer made, so the typing guard does not take it for typing. */
const SET_BY_COMPOSER = "agentDraftSetByComposer";

/** The caret's line box (t3code's `caretLineRect`): a collapsed range at a line or chip edge has no rect of its own, so it measures a neighbour. */
const caretLineRect = (range: Range, edge: "start" | "end"): DOMRect | null => {
  const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
  const own = edge === "start" ? rects.at(-1) : rects[0];
  if (own) return own;
  const container = range.startContainer;
  const probe = (text: Text, at: number): DOMRect | null => {
    const measure = document.createRange();
    measure.setStart(text, at);
    measure.setEnd(text, at + 1);
    const found = [...measure.getClientRects()].find((rect) => rect.height > 0);
    if (found) return found;
    const bounds = measure.getBoundingClientRect();
    return bounds.height > 0 ? bounds : null;
  };
  if (container instanceof Text) {
    if (container.data.length === 0) return null;
    return probe(container, Math.max(0, Math.min(edge === "start" ? range.startOffset : range.startOffset - 1, container.data.length - 1)));
  }
  if (!(container instanceof HTMLElement)) return null;
  const before = container.childNodes[range.startOffset - 1];
  const neighbour = before ?? container.childNodes[range.startOffset];
  if (neighbour instanceof HTMLElement) {
    const bounds = neighbour.getBoundingClientRect();
    if (bounds.height > 0) return bounds;
  } else if (neighbour instanceof Text && neighbour.data.length > 0) {
    const found = probe(neighbour, neighbour === before ? neighbour.data.length - 1 : 0);
    if (found) return found;
  }
  const bounds = container.getBoundingClientRect();
  return bounds.height > 0 ? bounds : null;
};

/** The text before the caret, for the `@`, `/` and `$` menus. */
export interface Trigger {
  readonly char: "@" | "/" | "$";
  readonly query: string;
  readonly from: number;
  readonly to: number;
  /** The trigger opens the whole draft (a slash command must). */
  readonly atStart: boolean;
}

const readTrigger = (editor: TiptapEditor): Trigger | undefined => {
  const { from, to, $from } = editor.state.selection;
  if (from !== to) return undefined;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const match = /(^|\s)([@/$])([\w:.\-/]*)$/.exec(before);
  if (!match) return undefined;
  const char = match[2] as Trigger["char"];
  const query = match[3] ?? "";
  const start = from - query.length - 1;
  const atStart = $from.index(0) === 0 && before.length === query.length + 1;
  if (char === "/" && !atStart) return undefined;
  return { char, query, from: start, to: from, atStart };
};

export interface PromptEditorHandle {
  readonly element: () => HTMLElement | null;
  focus(): void;
  text(): string;
  /**
   * Replaces the draft; it takes the focus unless `focus` is false (a draft shown, not one the
   * person asked for), and is an undo step unless `undoable` is false.
   */
  setText(text: string, options?: { readonly focus?: boolean; readonly undoable?: boolean }): void;
  clear(): void;
  /** Replaces a trigger's text with a chip, or with plain text. */
  replaceTrigger(trigger: Trigger, insert: DraftChip | string): void;
  insertText(text: string): void;
  /** Whether the caret is on the draft's first visual line (`start`, where ArrowUp recalls) or its last (`end`), wrapped lines counted. */
  caretOnVisualEdge(edge: "start" | "end"): boolean;
}

export interface PromptEditorProps {
  readonly placeholder: string;
  readonly label: string;
  /** Every change to the draft; `typed` is false for one the composer made (`setText`, `clear`). */
  readonly onChange: (text: string, typed: boolean) => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  readonly onTrigger: (trigger: Trigger | undefined) => void;
  /**
   * Keys the composer handles before the editor: return true to take the key. Enter
   * (without Shift or Option, never while composing) is `submit`.
   */
  readonly onKey: (event: KeyboardEvent) => boolean;
  /** Enter, with the key event: Cmd+Enter flips queue and steer for one message. */
  readonly onSubmit: (event: KeyboardEvent) => void;
  readonly onPaste: (event: ClipboardEvent) => boolean;
  readonly handle: Ref<PromptEditorHandle>;
  readonly disabled?: boolean;
  readonly autofocus?: boolean;
  /** The draft the box opens with. */
  readonly initialText?: string;
}

/**
 * The Agent tray's box (t3code's composer editor): Tiptap with every mark and block
 * formatting off, so typed markdown stays literal, and one paragraph per line. Enter
 * sends; Shift+Enter and Option+Enter break the line.
 */
export const PromptEditor = ({ placeholder, label, onChange, onFocus, onBlur, onTrigger, onKey, onSubmit, onPaste, handle, disabled, autofocus, initialText }: PromptEditorProps) => {
  const latest = useRef({ onChange, onFocus, onBlur, onTrigger, onKey, onSubmit, onPaste });
  latest.current = { onChange, onFocus, onBlur, onTrigger, onKey, onSubmit, onPaste };
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        link: false,
        orderedList: false,
        underline: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
        code: false,
        bold: false,
        italic: false,
        strike: false,
        listKeymap: false,
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current, showOnlyWhenEditable: false }),
      ChipNode,
    ],
    content: initialText ? draftDoc(initialText) : { type: "doc", content: [{ type: "paragraph" }] },
    autofocus: autofocus === true ? "end" : false,
    editorProps: {
      attributes: {
        class: "block min-h-12 whitespace-pre-wrap break-words bg-transparent leading-relaxed text-foreground focus:outline-none",
        "data-agent-prompt": "",
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
      },
      handleKeyDown: (view, event) => {
        if (latest.current.onKey(event)) {
          event.preventDefault();
          return true;
        }
        if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return false;
        if (event.shiftKey) return false;
        event.preventDefault();
        if (event.altKey) {
          view.dispatch(view.state.tr.split(view.state.selection.from).scrollIntoView());
          return true;
        }
        latest.current.onSubmit(event);
        return true;
      },
      handlePaste: (_view, event) => latest.current.onPaste(event),
    },
    onUpdate: ({ editor: current, transaction }) => latest.current.onChange(draftText(current.getJSON()), transaction.getMeta(SET_BY_COMPOSER) !== true),
    onFocus: () => latest.current.onFocus?.(),
    onBlur: () => latest.current.onBlur?.(),
    onTransaction: ({ editor: current }) => latest.current.onTrigger(readTrigger(current)),
  });
  useEffect(() => {
    // The placeholder is read at render time by the extension; a transaction redraws it.
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("placeholder", placeholder));
  }, [editor, placeholder]);
  useEffect(() => {
    // No update: it would save the box's text as the draft before the composer puts the draft back.
    editor?.setEditable(disabled !== true, false);
  }, [editor, disabled]);

  useImperativeHandle(
    handle,
    () => ({
      element: () => (editor?.view.dom as HTMLElement | undefined) ?? null,
      focus: () => editor?.commands.focus("end"),
      text: () => (editor && !editor.isDestroyed ? draftText(editor.getJSON()) : ""),
      // The first editor can be destroyed and replaced while the box mounts: a call then does nothing.
      setText: (text, options) => {
        if (!editor || editor.isDestroyed) return;
        editor
          .chain()
          .setMeta("addToHistory", options?.undoable !== false)
          .setMeta(SET_BY_COMPOSER, true)
          .setContent(draftDoc(text), { emitUpdate: true })
          .run();
        if (options?.focus === false) return;
        // Focused already, the caret goes to the end at once: Tiptap's focus lands a frame
        // later and would put it back after an arrow key the person pressed meanwhile.
        if (editor.view.hasFocus()) editor.view.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)));
        else editor.commands.focus("end");
      },
      clear: () => {
        editor?.chain().setMeta(SET_BY_COMPOSER, true).setContent({ type: "doc", content: [{ type: "paragraph" }] }, { emitUpdate: true }).run();
      },
      replaceTrigger: (trigger, insert) => {
        if (!editor) return;
        const content: JSONContent[] =
          typeof insert === "string" ? [{ type: "text", text: insert }] : [{ type: "agentChip", attrs: { ...insert } }, { type: "text", text: " " }];
        editor.chain().focus().insertContentAt({ from: trigger.from, to: trigger.to }, content).run();
      },
      insertText: (text) => {
        const content: JSONContent[] = text.split("\n").flatMap((line, index): JSONContent[] => [...(index === 0 ? [] : [{ type: "hardBreak" }]), ...(line === "" ? [] : [{ type: "text", text: line }])]);
        editor?.chain().focus().insertContent(content).run();
      },
      caretOnVisualEdge: (edge) => {
        if (!editor || editor.isDestroyed || draftText(editor.getJSON()) === "") return true;
        // Read from the DOM: the editor state catches up with a caret move only after the key that made it.
        const root = editor.view.dom;
        const selection = window.getSelection();
        if (!selection || !selection.isCollapsed || selection.rangeCount === 0 || !selection.anchorNode || !root.contains(selection.anchorNode)) return false;
        let line: globalThis.Node | null = selection.anchorNode;
        while (line && line.parentNode !== root) line = line.parentNode;
        if (!line || line !== (edge === "start" ? root.firstChild : root.lastChild)) return false;
        const caret = caretLineRect(selection.getRangeAt(0), edge);
        if (!caret) return false;
        const bounds = (line instanceof HTMLElement ? line : root).getBoundingClientRect();
        const threshold = caret.height / 2;
        return edge === "start" ? caret.top - bounds.top < threshold : bounds.bottom - caret.bottom < threshold;
      },
    }),
    [editor],
  );

  return (
    <div className="relative max-h-45 overflow-y-auto text-sm" data-scrolls="true">
      <EditorContent editor={editor} />
    </div>
  );
};
