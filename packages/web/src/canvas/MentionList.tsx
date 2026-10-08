import { parseAssetMarker } from "@unframed/contracts";
import type { MentionCandidate } from "@unframed/domain";
import { AppWindow, Clapperboard, Image, SquarePlay } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Editor, TLAssetId, TLShapeId } from "tldraw";
import { listboxPopupClass, listboxRowClass } from "../chrome/listbox.ts";
import { useCanvasProject } from "../context.ts";
import { fileUrl, previewUrl } from "./assetStore.ts";

const THUMB_CLASS = "size-5 shrink-0 rounded-sm object-cover";
const ICONS = { image: Image, video: SquarePlay, page: AppWindow, motion: Clapperboard } as const;

/** Where a filled image's or video's picture comes from: a project file or a linked clip. */
const mediaSource = (editor: Editor, id: string): { file?: string; url?: string } => {
  const assetId = (editor.getShape(id as TLShapeId)?.props as { assetId?: string | null } | undefined)?.assetId;
  const src = assetId ? (editor.getAsset(assetId as TLAssetId)?.props as { src?: string | null } | undefined)?.src : undefined;
  const marker = parseAssetMarker(src ?? "");
  return marker?.kind === "project-file" ? { file: marker.file } : marker?.kind === "link" ? { url: marker.url } : {};
};

/**
 * A row's picture, so `@507` and `@508` can be told apart: a filled image's small preview, a
 * filled clip's first frame, else the kind's icon for media, pages and motions. A prompt and
 * a group have none.
 */
const MentionThumb = ({ editor, row }: { readonly editor: Editor; readonly row: MentionCandidate }) => {
  const project = useCanvasProject();
  const [broken, setBroken] = useState(false);
  if (row.kind !== "image" && row.kind !== "video" && row.kind !== "page" && row.kind !== "motion") return null;
  const source = row.kind === "image" || row.kind === "video" ? mediaSource(editor, row.id) : {};
  if (row.kind === "image" && source.file !== undefined) {
    return (
      <span data-testid="mention-thumb" data-thumb="image" className="contents">
        {/* A missing preview falls back to the original, as everywhere else (spec 02). */}
        <img className={THUMB_CLASS} src={broken ? fileUrl(project, source.file) : previewUrl(project, source.file, 512)} alt="" draggable={false} onError={() => setBroken(true)} />
      </span>
    );
  }
  if (row.kind === "video" && (source.file !== undefined || source.url !== undefined)) {
    return (
      <span data-testid="mention-thumb" data-thumb="video" className="contents">
        <video className={THUMB_CLASS} src={`${source.file !== undefined ? fileUrl(project, source.file) : source.url}#t=0.1`} muted preload="metadata" playsInline />
      </span>
    );
  }
  const Icon = ICONS[row.kind];
  return (
    <span data-testid="mention-thumb" data-thumb="icon" className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
};

/**
 * The rows of an `@` mention menu: a prompt's while it is edited (spec 02) and the
 * composer's box (spec 03). A press on a row inserts it; the highlighted row stays in view.
 */
export const MentionList = ({
  editor,
  rows,
  highlight,
  style,
  onPick,
  onHighlight,
}: {
  readonly editor: Editor;
  readonly rows: ReadonlyArray<MentionCandidate>;
  readonly highlight: number;
  readonly style: CSSProperties;
  readonly onPick: (ref: string) => void;
  readonly onHighlight: (index: number) => void;
}) => {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    list.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Mentions"
      className={`${listboxPopupClass} pointer-events-auto absolute z-[600] max-h-[168px] w-[260px]`}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {rows.map((row, index) => (
        <div
          key={row.ref}
          role="option"
          aria-selected={index === highlight}
          data-index={index}
          data-highlighted={index === highlight ? "" : undefined}
          className={`${listboxRowClass} whitespace-nowrap`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPick(row.ref);
          }}
          onPointerEnter={() => onHighlight(index)}
        >
          <MentionThumb editor={editor} row={row} />
          <span className="max-w-[60%] shrink-0 truncate text-highlight">@{row.ref}</span>
          {row.preview !== undefined && <span className="min-w-0 truncate text-muted-foreground">{row.preview}</span>}
        </div>
      ))}
    </div>
  );
};
