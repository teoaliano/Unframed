import { AUDIO_DEFAULT_SIZE, AUDIO_EMPTY_SIZE, AUDIO_HEIGHT, AUDIO_WIDTH, resultMetaOf, runMarkerOf, type AudioShapeProps } from "@unframed/contracts";
import { audioClock, audioTitle, readRef } from "@unframed/domain";
import { Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { atom, BaseBoxShapeUtil, HTMLContainer, T, useEditor, useValue, Vec, type Editor, type RecordProps, type TLResizeInfo, type TLShape, type TLShapeId, type TLShapePartial } from "tldraw";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useCanvasProject } from "../../context.ts";
import { noteRender } from "../../fps/renders.ts";
import { showError } from "../../toasts.tsx";
import { fileUrl, uploadFile } from "../assetStore.ts";
import { waitingLabel } from "./labels.ts";
import { mediaCardClass } from "./looks.ts";
import { controlEvents } from "./media.tsx";
import { ShapeLabel } from "./ShapeLabel.tsx";

export type AudioShape = TLShape<"audio">;

const audioProps: RecordProps<AudioShape> = { w: T.nonZeroNumber, h: T.nonZeroNumber, file: T.string, fileName: T.string };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const playing = new Set<HTMLAudioElement>();

const durations = atom<ReadonlyMap<string, number>>("audio durations", new Map());

export const audioDurationOf = (shapeId: string): number | undefined => durations.get().get(shapeId);

const noteDuration = (shapeId: string, seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0 || durations.get().get(shapeId) === seconds) return;
  durations.update((current) => new Map(current).set(shapeId, seconds));
};

const spoken = new Map<string, Promise<string | undefined>>();

const spokenText = (project: string, sidecar: string): Promise<string | undefined> => {
  const key = `${project}/${sidecar}`;
  let known = spoken.get(key);
  if (!known) {
    known = fetch(fileUrl(project, sidecar))
      .then((response) => (response.ok ? response.json() : undefined))
      .then((value: unknown) => {
        const prompt = (value as { prompt?: unknown } | undefined)?.prompt;
        return typeof prompt === "string" ? prompt : undefined;
      })
      .catch(() => undefined);
    spoken.set(key, known);
  }
  return known;
};

const useTitle = (shape: AudioShape): string => {
  const project = useCanvasProject();
  const sidecar = resultMetaOf(shape)?.sidecar;
  const [text, setText] = useState<string>();
  useEffect(() => {
    if (typeof sidecar !== "string") return setText(undefined);
    let live = true;
    void spokenText(project, sidecar).then((value) => live && setText(value));
    return () => {
      live = false;
    };
  }, [project, sidecar]);
  if (text !== undefined && text.trim() !== "") return audioTitle(text);
  return shape.props.fileName !== "" ? shape.props.fileName : shape.props.file;
};

const AudioLabel = ({ shape }: { readonly shape: AudioShape }) => (
  <ShapeLabel shapeId={shape.id} kind="audio" name={readRef(shape)} width={shape.props.w} text={waitingLabel(shape, "Audio")} />
);

const useIsSelected = (shape: AudioShape) => {
  const editor = useEditor();
  return useValue("audio selected", () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id]);
};

/** Fills an audio shape with an uploaded file. */
export const fillAudio = (editor: Editor, shapeId: TLShapeId, saved: { readonly file: string; readonly fileName: string }) => {
  const shape = editor.getShape<AudioShape>(shapeId);
  if (!shape) return;
  editor.updateShape<AudioShape>({ id: shape.id, type: "audio", props: { file: saved.file, fileName: saved.fileName, w: shape.props.file === "" && shape.props.w === AUDIO_EMPTY_SIZE.w ? AUDIO_DEFAULT_SIZE.w : shape.props.w } });
};

const EmptyAudio = ({ shape }: { readonly shape: AudioShape }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const project = useCanvasProject();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const events = controlEvents(editor);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const saved = await uploadFile(project, file, file.name || "audio.mp3");
      editor.markHistoryStoppingPoint("fill audio");
      fillAudio(editor, shape.id, saved);
    } catch (error) {
      showError(`Could not add ${file.name || "that sound file"}: ${messageOf(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <HTMLContainer id={shape.id} className={mediaCardClass} data-testid="audio-empty" style={{ width: shape.props.w, height: shape.props.h }}>
      <AudioLabel shape={shape} />
      <div className="box-border flex h-full items-center justify-center p-2.5">
        <Button variant="outline" size="sm" className="pointer-events-auto" disabled={busy} onClick={() => input.current?.click()} {...events}>
          Choose file
        </Button>
        {/* oxlint-disable-next-line react/forbid-elements -- a hidden native file picker, opened by Choose file */}
        <input
          ref={input}
          type="file"
          accept="audio/*"
          hidden
          onChange={(event) => {
            void onFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </div>
    </HTMLContainer>
  );
};

const Generating = ({ shape }: { readonly shape: AudioShape }) => {
  noteRender(shape.id);
  return (
    <HTMLContainer id={shape.id} className={mediaCardClass} data-testid="audio-empty" data-placeholder="" style={{ width: shape.props.w, height: shape.props.h }}>
      <AudioLabel shape={shape} />
      <div className="box-border flex h-full items-center justify-center gap-2 p-2.5 text-sm text-muted-foreground" role="status">
        <Spinner size="md" aria-hidden />
        <span>Generating…</span>
      </div>
    </HTMLContainer>
  );
};

const RemoveButton = ({ shape }: { readonly shape: AudioShape }) => {
  const editor = useEditor();
  const selected = useIsSelected(shape);
  return (
    <div
      className="pointer-events-none absolute top-1 right-1 opacity-0 data-[selected]:pointer-events-auto data-[selected]:opacity-100 has-focus-visible:pointer-events-auto has-focus-visible:opacity-100"
      data-testid="media-remove"
      data-selected={selected ? "true" : undefined}
    >
      <Button
        variant="outline"
        size="icon-micro"
        aria-label={`Remove ${shape.props.fileName !== "" ? shape.props.fileName : shape.props.file}`}
        onClick={(event) => {
          editor.markEventAsHandled(event);
          editor.markHistoryStoppingPoint("remove audio");
          editor.updateShape<AudioShape>({ id: shape.id, type: "audio", props: { file: "", fileName: "" } });
        }}
        {...controlEvents(editor)}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
};

const Player = ({ shape }: { readonly shape: AudioShape }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const project = useCanvasProject();
  const audio = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const title = useTitle(shape);
  const events = controlEvents(editor);
  const url = fileUrl(project, shape.props.file);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    const element = audio.current;
    return () => {
      if (element) playing.delete(element);
    };
  }, [url]);

  return (
    <HTMLContainer id={shape.id} className={mediaCardClass} data-testid="audio-card" style={{ width: shape.props.w, height: shape.props.h }}>
      <AudioLabel shape={shape} />
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- spoken lines made here have no caption track */}
      <audio
        key={url}
        ref={audio}
        src={url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration);
          noteDuration(shape.id, event.currentTarget.duration);
        }}
        onDurationChange={(event) => {
          setDuration(event.currentTarget.duration);
          noteDuration(shape.id, event.currentTarget.duration);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={(event) => {
          for (const other of playing) if (other !== event.currentTarget) other.pause();
          playing.add(event.currentTarget);
          setPlaying(true);
        }}
        onPause={(event) => {
          playing.delete(event.currentTarget);
          setPlaying(false);
        }}
        onEnded={(event) => {
          playing.delete(event.currentTarget);
          setPlaying(false);
        }}
      />
      <div className="box-border flex h-full items-center gap-2 py-2 pr-3 pl-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto shrink-0"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={() => {
            const element = audio.current;
            if (!element) return;
            if (element.paused) void element.play();
            else element.pause();
          }}
          {...events}
        >
          {isPlaying ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-xs text-foreground" data-testid="audio-title">
            {title}
          </span>
          <div className="flex items-center gap-2">
            {/* oxlint-disable-next-line react/forbid-elements -- the kit has no slider, so the scrubber is the native range input */}
            <input
              type="range"
              aria-label="Position"
              className="pointer-events-auto h-3 min-w-0 flex-1 accent-highlight"
              min={0}
              max={Number.isFinite(duration) && duration > 0 ? duration : 0}
              step={0.01}
              value={time}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                setTime(next);
                if (audio.current) audio.current.currentTime = next;
              }}
              {...events}
            />
            <span className="shrink-0 text-2xs text-muted-foreground tabular-nums" data-testid="audio-time">
              {audioClock(time)} / {audioClock(duration)}
            </span>
          </div>
        </div>
      </div>
      <RemoveButton shape={shape} />
    </HTMLContainer>
  );
};

const resizeAudio = (shape: AudioShape, info: TLResizeInfo<AudioShape>): TLShapePartial<AudioShape> => {
  const { initialShape, handle, scaleX } = info;
  const w = Math.min(AUDIO_WIDTH.max, Math.max(AUDIO_WIDTH.min, initialShape.props.w * Math.abs(scaleX)));
  const dx = handle.includes("left") ? initialShape.props.w - w : 0;
  const offset = Vec.Rot({ x: dx, y: 0 }, initialShape.rotation);
  return { id: shape.id, type: "audio", x: initialShape.x + offset.x, y: initialShape.y + offset.y, props: { w, h: AUDIO_HEIGHT } };
};

export class AudioShapeUtil extends BaseBoxShapeUtil<AudioShape> {
  static override type = "audio" as const;
  static override props = audioProps;

  override getDefaultProps(): AudioShapeProps {
    return { ...AUDIO_EMPTY_SIZE, file: "", fileName: "" };
  }

  override canEdit() {
    return false;
  }

  override component(shape: AudioShape) {
    noteRender(shape.id);
    if (shape.props.file === "") return runMarkerOf(shape) ? <Generating shape={shape} /> : <EmptyAudio shape={shape} />;
    return <Player shape={shape} />;
  }

  override getIndicatorPath(shape: AudioShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 8);
    return path;
  }

  override onResize(shape: AudioShape, info: TLResizeInfo<AudioShape>) {
    return resizeAudio(shape, info);
  }
}
