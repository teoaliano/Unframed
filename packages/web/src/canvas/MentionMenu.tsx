import { mentionCandidates, mentionQuery, type MentionCandidate } from "@unframed/domain";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEditor, useValue, type TiptapEditor, type TLShapeId } from "tldraw";

interface MentionState {
  /** Where the typed `@query` starts in the document. */
  readonly from: number;
  /** The caret: where it ends. */
  readonly to: number;
  readonly query: string;
}

/** The `@query` right before the caret of the prompt being edited, if any. */
const readMention = (text: TiptapEditor): MentionState | undefined => {
  const { from, to } = text.state.selection;
  if (from !== to) return undefined;
  const before = text.state.doc.textBetween(0, from, "\n", "\n");
  const query = mentionQuery(before);
  return query === undefined ? undefined : { from: from - query.length - 1, to: from, query };
};

/** Follows the rich text editor of the prompt being edited and reports its `@query`. */
const useMention = (text: TiptapEditor | null): MentionState | undefined => {
  const [mention, setMention] = useState<MentionState>();
  useEffect(() => {
    if (!text) {
      setMention(undefined);
      return;
    }
    const update = () => setMention(readMention(text));
    update();
    text.on("transaction", update);
    return () => void text.off("transaction", update);
  }, [text]);
  return mention;
};

/**
 * The `@` mention menu: while a prompt is edited and the text before the caret ends in `@`
 * and word characters, it lists every prompt and group whose ref starts with them, below
 * the prompt. Arrow keys move the highlight, Enter or Tab inserts, Escape closes it.
 */
export const MentionMenu = () => {
  const editor = useEditor();
  const editingId = useValue(
    "editing prompt",
    () => {
      const shape = editor.getEditingShape();
      return shape?.type === "text" ? shape.id : undefined;
    },
    [editor],
  );
  const text = useValue("rich text editor", () => (editingId ? editor.getRichTextEditor() : null), [editor, editingId]);
  const mention = useMention(text);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number>();

  const rows: MentionCandidate[] = useMemo(() => {
    if (!mention || !editingId) return [];
    const self = editor.getShape(editingId as TLShapeId);
    const selfRef = (self?.meta as { ref?: string } | undefined)?.ref;
    return mentionCandidates(editor.getCurrentPageShapes(), selfRef, mention.query);
  }, [editor, editingId, mention]);

  const open = mention !== undefined && rows.length > 0 && dismissedAt !== mention.from && text !== null;

  useEffect(() => setHighlight(0), [mention?.query, mention?.from]);
  useEffect(() => {
    if (mention === undefined || mention.from !== dismissedAt) setDismissedAt(undefined);
  }, [mention, dismissedAt]);

  const insert = (ref: string) => {
    if (!text || !mention) return;
    text.chain().focus().insertContentAt({ from: mention.from, to: mention.to }, `@${ref} `).run();
  };

  // Keys reach this menu before the text editor and tldraw see them.
  const latest = useRef({ open, rows, highlight, insert, mention });
  latest.current = { open, rows, highlight, insert, mention };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { open: isOpen, rows: current, highlight: index, insert: put, mention: at } = latest.current;
      if (!isOpen || !at) return;
      const stop = () => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      };
      if (event.key === "ArrowDown") {
        stop();
        setHighlight((index + 1) % current.length);
      } else if (event.key === "ArrowUp") {
        stop();
        setHighlight((index - 1 + current.length) % current.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        stop();
        const row = current[index];
        if (row) put(row.ref);
      } else if (event.key === "Escape") {
        stop();
        setDismissedAt(at.from);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  const position = useValue(
    "mention menu position",
    () => {
      if (!open || !editingId) return undefined;
      const bounds = editor.getShapePageBounds(editingId as TLShapeId);
      if (!bounds) return undefined;
      return editor.pageToViewport({ x: bounds.minX, y: bounds.maxY });
    },
    [editor, editingId, open],
  );

  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    list.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  if (!open || !position) return null;
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Mentions"
      className="unframed-mention-menu"
      style={{ left: position.x, top: position.y + 6 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {rows.map((row, index) => (
        <div
          key={row.ref}
          role="option"
          aria-selected={index === highlight}
          data-index={index}
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
    </div>
  );
};
