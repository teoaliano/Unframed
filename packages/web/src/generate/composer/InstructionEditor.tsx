import { Extension, type Editor as TiptapEditor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { mentionCandidates, mentionQuery, plainText, type MentionCandidate } from "@unframed/domain";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor as useCanvas } from "tldraw";

interface Mention {
  readonly from: number;
  readonly to: number;
  readonly query: string;
}

const readMention = (text: TiptapEditor): Mention | undefined => {
  const { from, to } = text.state.selection;
  if (from !== to) return undefined;
  const query = mentionQuery(text.state.doc.textBetween(0, from, "\n", "\n"));
  return query === undefined ? undefined : { from: from - query.length - 1, to: from, query };
};

/** One paragraph per line: the plain text of the box. */
export const instructionText = (text: TiptapEditor): string => plainText(text.getJSON());

const toDoc = (value: string) => ({
  type: "doc",
  content: value.split("\n").map((line) => (line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] })),
});

export interface InstructionEditorProps {
  readonly initial: string;
  readonly placeholder: string;
  readonly onChange: (text: string) => void;
  /** Cmd+Enter (Ctrl+Enter off macOS). Plain Enter and Shift+Enter insert a line. */
  readonly onSend: () => void;
  /** Whether a menu of the box is open, so the shell leaves Esc to it. */
  readonly onMenuOpen: (open: boolean) => void;
}

/**
 * The composer's box: a Tiptap editor, one paragraph per line, with spec 02's `@` mention
 * menu. Attachments and chips are off in the Generate tray.
 */
export const InstructionEditor = ({ initial, placeholder, onChange, onSend, onMenuOpen }: InstructionEditorProps) => {
  const canvas = useCanvas();
  const [mention, setMention] = useState<Mention>();
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number>();
  const latest = useRef({ onSend, onChange, rows: [] as MentionCandidate[], open: false, highlight: 0, mention: undefined as Mention | undefined });
  const editorRef = useRef<TiptapEditor | null>(null);

  const insert = (ref: string) => {
    const at = latest.current.mention;
    const current = editorRef.current;
    if (!current || !at) return;
    current.chain().focus().insertContentAt({ from: at.from, to: at.to }, `@${ref} `).run();
  };

  const text = useEditor({
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
      Placeholder.configure({ placeholder }),
      Extension.create({
        name: "unframedSend",
        addKeyboardShortcuts: () => ({
          "Mod-Enter": () => {
            latest.current.onSend();
            return true;
          },
        }),
      }),
    ],
    content: toDoc(initial),
    autofocus: "end",
    editorProps: {
      attributes: { class: "unframed-composer-input", "aria-label": placeholder, role: "textbox", "aria-multiline": "true" },
      handleKeyDown: (_view, event) => {
        const { open, rows, highlight: index, mention: at } = latest.current;
        if (!open || !at) return false;
        if (event.key === "ArrowDown") setHighlight((index + 1) % rows.length);
        else if (event.key === "ArrowUp") setHighlight((index - 1 + rows.length) % rows.length);
        else if (event.key === "Enter" || event.key === "Tab") {
          const row = rows[index];
          if (row) insert(row.ref);
        } else if (event.key === "Escape") setDismissedAt(at.from);
        else return false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
    },
    onUpdate: ({ editor }) => latest.current.onChange(instructionText(editor)),
    onTransaction: ({ editor }) => setMention(readMention(editor)),
  });

  editorRef.current = text;

  const rows = mention ? mentionCandidates(canvas.getCurrentPageShapes(), undefined, mention.query) : [];
  const open = mention !== undefined && rows.length > 0 && dismissedAt !== mention.from;
  latest.current = { onSend, onChange, rows, open, highlight, mention };

  useEffect(() => setHighlight(0), [mention?.query, mention?.from]);
  useEffect(() => {
    if (mention === undefined || mention.from !== dismissedAt) setDismissedAt(undefined);
  }, [mention, dismissedAt]);
  useEffect(() => onMenuOpen(open), [open, onMenuOpen]);

  const box = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    if (!open || !box.current) return setAnchor(undefined);
    const rect = box.current.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.bottom + 6 });
  }, [open, mention?.from]);

  return (
    <div ref={box} className="unframed-composer-editor" data-scrolls="true">
      <EditorContent editor={text} />
      {open &&
        anchor &&
        createPortal(
          <div
            role="listbox"
            aria-label="Mentions"
            className="unframed-mention-menu"
            style={{ position: "fixed", left: anchor.left, top: anchor.top, zIndex: 1200 }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {rows.map((row, index) => (
              <div
                key={row.ref}
                role="option"
                aria-selected={index === highlight}
                className="unframed-mention-row"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  insert(row.ref);
                }}
                onPointerEnter={() => setHighlight(index)}
              >
                <span className="unframed-mention-ref">@{row.ref}</span>
                {row.preview !== undefined && <span className="unframed-mention-preview">{row.preview}</span>}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
};
