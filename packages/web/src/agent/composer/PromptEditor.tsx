import { mergeAttributes, Node, type Editor as TiptapEditor, type JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { closeHistory } from "@tiptap/pm/history";
import { Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

/** The draft's text with chips as placeholders: two drafts that read the same have their positions in the same places. */
const docText = (doc: { readonly content: { readonly size: number }; textBetween: (from: number, to: number, block?: string, leaf?: string) => string }) =>
  doc.textBetween(0, doc.content.size, "\n", "\ufffc");

/** A caret position and the draft it was in: it still holds while the draft has not changed. */
export interface CaretMark {
  readonly pos: number;
  readonly doc: string;
}

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

/** A serialised chip (`[<Kind>: <label>; ref=<id>]`) as a chip node's attributes. */
export const chipOfToken = (token: string): DraftChip | undefined => {
  const match = new RegExp(CHIP_TOKEN.source).exec(token);
  return match ? { kind: "mention", label: match[1]!, title: match[2]!, ref: match[3]! } : undefined;
};

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

/** Text as inline content, its line breaks kept. */
const lineBreaks = (text: string): JSONContent[] =>
  text.split("\n").flatMap((line, index): JSONContent[] => [...(index === 0 ? [] : [{ type: "hardBreak" }]), ...(line === "" ? [] : [{ type: "text", text: line }])]);

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
  /** Puts a chip at the caret, a space on either side as needed, without taking the focus (t3code's attachment reference). */
  insertChip(chip: DraftChip, at?: CaretMark): void;
  /** Where the caret is now, to put a chip there later (an upload that finishes after a paste). */
  caretMark(): CaretMark | undefined;
  /** Removes every chip of `ref`, each with the space after it; not an edit the person typed. */
  removeChips(ref: string): void;
  /** Puts text at the end of the draft and focuses it; false when the box takes no typing now. */
  insertTextAtEnd(text: string): boolean;
  /** Whether the caret is on the draft's first visual line (`start`, where ArrowUp recalls) or its last (`end`), wrapped lines counted. */
  caretOnVisualEdge(edge: "start" | "end"): boolean;
  /** Whether the caret sits before the draft's first character, nothing selected. */
  caretAtStart(): boolean;
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
   * Keys the composer handles before the editor: return true to take the key. The composer
   * decides which Enter sends (the Send shortcut setting); an Enter it leaves breaks the line.
   */
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly onPaste: (event: ClipboardEvent) => boolean;
  readonly handle: Ref<PromptEditorHandle>;
  readonly disabled?: boolean;
  readonly autofocus?: boolean;
  /** A resting composer's prompt: one line, clipped. */
  readonly resting?: boolean;
  /** The draft the box opens with. */
  readonly initialText?: string;
}

/**
 * The Agent tray's box (t3code's composer editor): Tiptap with every mark and block
 * formatting off, so typed markdown stays literal, and one paragraph per line. Shift+Enter,
 * Option+Enter and any Enter the composer does not send with break the line.
 */
export const PromptEditor = ({ placeholder, label, onChange, onFocus, onBlur, onTrigger, onKey, onPaste, handle, disabled, autofocus, initialText, resting = false }: PromptEditorProps) => {
  const latest = useRef({ onChange, onFocus, onBlur, onTrigger, onKey, onPaste });
  latest.current = { onChange, onFocus, onBlur, onTrigger, onKey, onPaste };
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
        view.dispatch(view.state.tr.split(view.state.selection.from).scrollIntoView());
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
      element: () => (editor?.isInitialized && !editor.isDestroyed ? (editor.view.dom as HTMLElement) : null),
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
      insertTextAtEnd: (text) => {
        if (!editor || editor.isDestroyed || !editor.isEditable) return false;
        editor.chain().focus("end").insertContent(lineBreaks(text)).run();
        return true;
      },
      insertText: (text) => {
        editor?.chain().focus().insertContent(lineBreaks(text)).run();
      },
      caretMark: () => {
        if (!editor || editor.isDestroyed) return undefined;
        // The page's selection, not the editor's: the editor learns of a caret moved by a key a moment later.
        const view = editor.view;
        const selection = view.dom.ownerDocument.getSelection();
        let pos = editor.state.selection.from;
        if (selection?.focusNode && view.dom.contains(selection.focusNode)) {
          try {
            pos = view.posAtDOM(selection.focusNode, selection.focusOffset);
          } catch {
            // A node the editor does not map: its own selection stands.
          }
        }
        return { pos, doc: docText(editor.state.doc) };
      },
      insertChip: (chip, at) => {
        if (!editor || editor.isDestroyed) return;
        // The caret of the paste, while the draft is as it was then: a draft put back in the box meanwhile moved the caret, not the place.
        const marked = at !== undefined && at.pos <= editor.state.doc.content.size && docText(editor.state.doc) === at.doc ? editor.state.doc.resolve(at.pos) : undefined;
        const { from, to, $from } = marked ? { from: marked.pos, to: marked.pos, $from: marked } : editor.state.selection;
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
        const after = editor.state.doc.textBetween(to, Math.min(to + 1, editor.state.doc.content.size - 1), undefined, "￼");
        const content: JSONContent[] = [
          ...(before === "" || /\s$/.test(before) ? [] : [{ type: "text", text: " " }]),
          { type: "agentChip", attrs: { ...chip } },
          ...(after === " " ? [] : [{ type: "text", text: " " }]),
        ];
        // Its own undo step, so an undo just after it does not also take back what was typed before.
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor.chain().setMeta(SET_BY_COMPOSER, true).insertContentAt({ from, to }, content).run();
        editor.view.dispatch(closeHistory(editor.state.tr));
      },
      removeChips: (ref) => {
        if (!editor || editor.isDestroyed) return;
        const ranges: Array<{ from: number; to: number }> = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== "agentChip" || node.attrs.ref !== ref) return;
          const next = editor.state.doc.textBetween(pos + 1, Math.min(pos + 2, editor.state.doc.content.size), undefined, "￼");
          ranges.push({ from: pos, to: pos + (next === " " ? 2 : 1) });
        });
        if (ranges.length === 0) return;
        const tr = editor.state.tr.setMeta(SET_BY_COMPOSER, true);
        for (const range of ranges.reverse()) tr.delete(range.from, range.to);
        editor.view.dispatch(tr);
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
      caretAtStart: () => {
        if (!editor || editor.isDestroyed) return false;
        // Read from the DOM, as above: an arrow key just pressed may not be in the editor state yet.
        const root = editor.view.dom;
        const selection = window.getSelection();
        if (!selection || !selection.isCollapsed || !selection.anchorNode || !root.contains(selection.anchorNode)) return false;
        return editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset) === Selection.atStart(editor.state.doc).from;
      },
    }),
    [editor],
  );

  return (
    <div
      className={
        resting
          ? "relative h-8 min-w-0 flex-1 overflow-hidden text-sm [&_.ProseMirror]:min-h-8 [&_.ProseMirror]:overflow-hidden [&_.ProseMirror]:leading-8 [&_.ProseMirror]:whitespace-pre"
          : "relative max-h-45 overflow-y-auto text-sm"
      }
      data-scrolls={resting ? undefined : "true"}
    >
      <EditorContent editor={editor} />
    </div>
  );
};
