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
      class: "unframed-agent-inline-chip",
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
  setText(text: string): void;
  clear(): void;
  /** Replaces a trigger's text with a chip, or with plain text. */
  replaceTrigger(trigger: Trigger, insert: DraftChip | string): void;
  insertText(text: string): void;
  /** Whether the caret is on the draft's first line (ArrowUp recalls there) or last line. */
  caretLine(): { first: boolean; last: boolean };
}

export interface PromptEditorProps {
  readonly placeholder: string;
  readonly label: string;
  readonly onChange: (text: string) => void;
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
}

/**
 * The Agent tray's box (t3code's composer editor): Tiptap with every mark and block
 * formatting off, so typed markdown stays literal, and one paragraph per line. Enter
 * sends; Shift+Enter and Option+Enter break the line.
 */
export const PromptEditor = ({ placeholder, label, onChange, onTrigger, onKey, onSubmit, onPaste, handle, disabled, autofocus }: PromptEditorProps) => {
  const latest = useRef({ onChange, onTrigger, onKey, onSubmit, onPaste });
  latest.current = { onChange, onTrigger, onKey, onSubmit, onPaste };
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
    content: { type: "doc", content: [{ type: "paragraph" }] },
    autofocus: autofocus === true ? "end" : false,
    editorProps: {
      attributes: { class: "unframed-composer-input unframed-agent-input", "aria-label": label, role: "textbox", "aria-multiline": "true" },
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
    onUpdate: ({ editor: current }) => latest.current.onChange(draftText(current.getJSON())),
    onTransaction: ({ editor: current }) => latest.current.onTrigger(readTrigger(current)),
  });
  useEffect(() => {
    // The placeholder is read at render time by the extension; a transaction redraws it.
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("placeholder", placeholder));
  }, [editor, placeholder]);
  useEffect(() => {
    editor?.setEditable(disabled !== true);
  }, [editor, disabled]);

  useImperativeHandle(
    handle,
    () => ({
      element: () => (editor?.view.dom as HTMLElement | undefined) ?? null,
      focus: () => editor?.commands.focus("end"),
      text: () => (editor ? draftText(editor.getJSON()) : ""),
      setText: (text) => {
        if (!editor) return;
        editor.commands.setContent(draftDoc(text), { emitUpdate: true });
        // Focused already, the caret goes to the end at once: Tiptap's focus lands a frame
        // later and would put it back after an arrow key the person pressed meanwhile.
        if (editor.view.hasFocus()) editor.view.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)));
        else editor.commands.focus("end");
      },
      clear: () => {
        editor?.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] }, { emitUpdate: true });
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
      caretLine: () => {
        if (!editor) return { first: true, last: true };
        // Read from the DOM: the editor state catches up with a caret move only after the key that made it.
        const root = editor.view.dom;
        let node = window.getSelection()?.anchorNode ?? null;
        while (node && node.parentNode !== root) node = node.parentNode;
        if (!node) return { first: true, last: true };
        return { first: node === root.firstChild, last: node === root.lastChild };
      },
    }),
    [editor],
  );

  return (
    <div className="unframed-composer-editor" data-scrolls="true">
      <EditorContent editor={editor} />
    </div>
  );
};
