import { isHttpsLink, linkedVideoName, VIDEO_LINK_MESSAGE } from "@unframed/domain";
import { LoaderCircle, Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import {
  HTMLContainer,
  ImageShapeUtil,
  useEditor,
  useImageOrVideoAsset,
  useValue,
  Vec,
  VideoShapeUtil,
  type Editor,
  type TLImageShape,
  type TLResizeInfo,
  type TLShapePartial,
  type TLVideoShape,
} from "tldraw";
import { showError } from "../../toasts.tsx";
import {
  emptyShape,
  fillShape,
  linkAsset,
  MEDIA_DEFAULT_SIZE,
  MEDIA_MAX_WIDTH,
  MEDIA_MIN_HEIGHT,
  MEDIA_MIN_WIDTH,
  MediaRefused,
  uploadMedia,
  type MediaKind,
  type MediaShape,
} from "../media.ts";
import { ShapeLabel } from "./ShapeLabel.tsx";
import { noteRender } from "../../fps/renders.ts";
import { runMarkerOf } from "@unframed/contracts";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Keeps a press on a control inside a shape from starting a canvas drag or selection. */
const controlEvents = (editor: Editor) => ({
  onPointerDown: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onPointerUp: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onPointerMove: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onDoubleClick: (event: SyntheticEvent) => editor.markEventAsHandled(event),
});

/**
 * Media resizes keep their aspect from every edge and corner, between 140 and 900 wide and
 * at least 100 high.
 */
const resizeMedia = <S extends MediaShape>(shape: S, info: TLResizeInfo<S>): TLShapePartial<S> => {
  const { initialShape, handle, scaleX, scaleY } = info;
  const aspect = initialShape.props.h / initialShape.props.w;
  const scale = handle === "top" || handle === "bottom" ? Math.abs(scaleY) : Math.abs(scaleX);
  const lowest = Math.max(MEDIA_MIN_WIDTH, MEDIA_MIN_HEIGHT / aspect);
  const w = Math.min(Math.max(lowest, MEDIA_MAX_WIDTH), Math.max(lowest, initialShape.props.w * scale));
  const h = w * aspect;
  const dx = handle.includes("left") ? initialShape.props.w - w : handle === "top" || handle === "bottom" ? (initialShape.props.w - w) / 2 : 0;
  const dy = handle.includes("top") ? initialShape.props.h - h : handle === "left" || handle === "right" ? (initialShape.props.h - h) / 2 : 0;
  const offset = Vec.Rot({ x: dx, y: dy }, initialShape.rotation);
  return { id: shape.id, type: shape.type, x: initialShape.x + offset.x, y: initialShape.y + offset.y, props: { w, h } } as TLShapePartial<S>;
};

const useIsSelected = (shape: MediaShape) => {
  const editor = useEditor();
  return useValue("media selected", () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id]);
};

/** The empty state: a card with its kind label that asks for a file (and, for a video, a link). */
const EmptyMedia = ({ shape, kind }: { readonly shape: MediaShape; readonly kind: MediaKind }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const events = controlEvents(editor);

  const run = async (name: string, task: () => Promise<void>) => {
    setProblem(undefined);
    setBusy(true);
    try {
      await task();
    } catch (error) {
      if (error instanceof MediaRefused) setProblem(error.message);
      else showError(`Could not add ${name}: ${messageOf(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run(file.name, async () => fillShape(editor, shape.id, await uploadMedia(editor, kind, file)));
  };

  const onLink = () => {
    const value = link.trim();
    if (!isHttpsLink(value)) return setProblem(VIDEO_LINK_MESSAGE);
    void run(linkedVideoName(value), async () => fillShape(editor, shape.id, await linkAsset(editor, value)));
  };

  return (
    <HTMLContainer id={shape.id} className="unframed-media-empty" style={{ width: shape.props.w, height: shape.props.h }}>
      <ShapeLabel shapeId={shape.id} kind={kind}>
        {kind === "image" ? "Image" : "Video"}
      </ShapeLabel>
      <div className="unframed-media-empty__body">
        <button type="button" className="unframed-media-button" disabled={busy} onClick={() => input.current?.click()} {...events}>
          Choose file
        </button>
        <input
          ref={input}
          type="file"
          accept={kind === "image" ? "image/*" : "video/*"}
          hidden
          onChange={(event) => {
            onFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        {kind === "video" && (
          <div className="unframed-media-link">
            <input
              type="text"
              className="unframed-media-link__input"
              placeholder="or paste an https:// link"
              value={link}
              onChange={(event) => {
                setLink(event.currentTarget.value);
                setProblem(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") onLink();
                event.stopPropagation();
              }}
              {...events}
            />
            {/^https:\/\/./.test(link.trim()) && (
              <button type="button" className="unframed-media-button" disabled={busy} onClick={onLink} {...events}>
                Use link
              </button>
            )}
          </div>
        )}
        {problem !== undefined && (
          <p role="alert" className="unframed-media-problem">
            {problem}
          </p>
        )}
      </div>
    </HTMLContainer>
  );
};

/** A placeholder: where a result lands, while the run that makes it is in flight. */
const Generating = ({ shape, kind }: { readonly shape: MediaShape; readonly kind: MediaKind }) => {
  noteRender(shape.id);
  return (
    <HTMLContainer id={shape.id} className="unframed-media-empty unframed-placeholder" style={{ width: shape.props.w, height: shape.props.h }}>
      <ShapeLabel shapeId={shape.id} kind={kind}>
        {kind === "image" ? "Image" : "Video"}
      </ShapeLabel>
      <div className="unframed-media-empty__body" role="status">
        <LoaderCircle size={18} className="unframed-placeholder__spinner" aria-hidden />
        <span>Generating…</span>
      </div>
    </HTMLContainer>
  );
};

/** The remove control of a selected filled shape: it empties the shape and leaves the file on disk. */
const RemoveButton = ({ shape, name }: { readonly shape: MediaShape; readonly name: string }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const selected = useIsSelected(shape);
  return (
    <button
      type="button"
      className="unframed-media-remove"
      aria-label={`Remove ${name}`}
      data-selected={selected ? "true" : undefined}
      onClick={(event) => {
        editor.markEventAsHandled(event);
        editor.markHistoryStoppingPoint("remove media");
        emptyShape(editor, shape.id);
      }}
      {...controlEvents(editor)}
    >
      <X size={14} strokeWidth={2} aria-hidden />
    </button>
  );
};

const assetName = (editor: Editor, shape: MediaShape): string => {
  const asset = shape.props.assetId ? editor.getAsset(shape.props.assetId) : undefined;
  return (asset?.props as { name?: string } | undefined)?.name ?? "";
};

/** An image: tldraw's own, with its crop; bare once filled, with the remove control when selected. */
export class ImageMediaUtil extends ImageShapeUtil {
  static override type = "image" as const;

  override getDefaultProps(): TLImageShape["props"] {
    return { ...super.getDefaultProps(), ...MEDIA_DEFAULT_SIZE.image };
  }

  override component(shape: TLImageShape) {
    noteRender(shape.id);
    if (!shape.props.assetId) return runMarkerOf(shape) ? <Generating shape={shape} kind="image" /> : <EmptyMedia shape={shape} kind="image" />;
    return (
      <>
        {super.component(shape)}
        <RemoveButton shape={shape} name={assetName(this.editor, shape)} />
      </>
    );
  }

  override onResize(shape: TLImageShape, info: TLResizeInfo<TLImageShape>) {
    return resizeMedia(shape, info) as ReturnType<ImageShapeUtil["onResize"]>;
  }
}

const clock = (seconds: number) => {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** A filled clip: no native controls, muted, metadata preloaded; the transport sits below it, outside its bounds. */
const VideoClip = ({ shape }: { readonly shape: TLVideoShape }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const video = useRef<HTMLVideoElement>(null);
  const { url } = useImageOrVideoAsset({ shapeId: shape.id, assetId: shape.props.assetId, width: shape.props.w });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const events = controlEvents(editor);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
  }, [url]);

  return (
    <>
      <HTMLContainer id={shape.id} className="unframed-video" style={{ width: shape.props.w, height: shape.props.h }}>
        {url && (
          <video
            key={url}
            ref={video}
            className="unframed-video__clip"
            src={url}
            muted
            preload="metadata"
            playsInline
            loop
            disablePictureInPicture
            disableRemotePlayback
            draggable={false}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
      </HTMLContainer>
      <div className="unframed-transport" style={{ top: shape.props.h, width: shape.props.w }} {...events}>
        <button
          type="button"
          className="unframed-transport__play"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            const clip = video.current;
            if (!clip) return;
            if (clip.paused) void clip.play();
            else clip.pause();
          }}
          {...events}
        >
          {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        </button>
        <input
          type="range"
          aria-label="Position"
          className="unframed-transport__slider"
          min={0}
          max={Number.isFinite(duration) && duration > 0 ? duration : 0}
          step={0.01}
          value={time}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            setTime(next);
            if (video.current) video.current.currentTime = next;
          }}
          {...events}
        />
        <span className="unframed-transport__time">
          {clock(time)} / {clock(duration)}
        </span>
      </div>
    </>
  );
};

/** A video: a file or an https link, with its transport below it and no crop. */
export class VideoMediaUtil extends VideoShapeUtil {
  static override type = "video" as const;

  override getDefaultProps(): TLVideoShape["props"] {
    return { ...super.getDefaultProps(), ...MEDIA_DEFAULT_SIZE.video, autoplay: false };
  }

  override component(shape: TLVideoShape) {
    noteRender(shape.id);
    if (!shape.props.assetId) return <EmptyMedia shape={shape} kind="video" />;
    return (
      <>
        <VideoClip shape={shape} />
        <RemoveButton shape={shape} name={assetName(this.editor, shape)} />
      </>
    );
  }

  override onResize(shape: TLVideoShape, info: TLResizeInfo<TLVideoShape>) {
    return resizeMedia(shape, info);
  }
}
