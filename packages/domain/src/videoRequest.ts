/**
 * Video request composition (spec 04): from a selection's composition, the input mode, the
 * model and the tray's values, what each source will do and exactly what is sent. Badges,
 * warnings and the request all read this, so they can never disagree.
 */
import { UNUSED_ROLE, type Composition, type Slot } from "./composition.ts";
import { videoParams, type InputMode, type VideoEntry, type VideoPropValue } from "./videoProps.ts";

export type VideoRequestReference =
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } }
  | { readonly type: "video_url"; readonly video_url: { readonly url: string } };

export interface VideoRequestFrame {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
  readonly frame_type: "first_frame" | "last_frame";
}

export interface VideoRequest {
  readonly prompt: string;
  readonly input_references: ReadonlyArray<VideoRequestReference>;
  readonly frame_images: ReadonlyArray<VideoRequestFrame>;
  readonly duration?: number;
  readonly resolution?: string;
  readonly aspect_ratio?: string;
  readonly size?: string;
  readonly generate_audio?: boolean;
}

export interface VideoCounts {
  readonly referencedImages: number;
  readonly referencedVideos: number;
  /** Clips that name a project file and go as references: they need a share link. */
  readonly localVideos: number;
  readonly frames: number;
  /** Sources the mode has no room for. */
  readonly unused: number;
}

export interface VideoRequestInput {
  readonly composition: Composition;
  readonly entry: VideoEntry | undefined;
  readonly props: Readonly<Record<string, VideoPropValue>>;
  /**
   * The URL each sent slot goes as. At send time these are the files the web rendered and
   * uploaded; by default a file is its project-file marker, a link itself, and a composite
   * or sketch the marker of what it is rendered from.
   */
  readonly urlOf?: (slot: Slot) => string;
}

export interface VideoRequestPlan {
  readonly mode: InputMode;
  /** One role per media source, keyed as the composition keys its slots. */
  readonly roles: Readonly<Record<string, string>>;
  readonly request: VideoRequest;
  readonly counts: VideoCounts;
  /** The slots that are sent, in the order they go: the references, or the first then the last frame. */
  readonly sent: ReadonlyArray<Slot>;
}

const MODES: ReadonlyArray<InputMode> = ["reference", "first_frame", "first_last"];

export const inputModeOf = (props: Readonly<Record<string, unknown>>): InputMode =>
  MODES.find((mode) => mode === props.inputMode) ?? "reference";

const defaultUrl = (slot: Slot): string => {
  switch (slot.source.type) {
    case "file":
      return `project-file:${slot.source.file}`;
    case "link":
      return slot.source.url;
    case "composite":
      return `project-file:${slot.source.file}`;
    case "sketch":
      return "sketch";
  }
};

export type VideoSettings = Omit<VideoRequest, "prompt" | "input_references" | "frame_images">;

/**
 * The params a video request sends: the chosen duration when declared, else the first
 * declared; only `size` when the model declares exact sizes, else tier and ratio, each only
 * when set to a declared value; audio as a boolean only when declared, false when unticked.
 */
export const videoSettings = (entry: VideoEntry | undefined, props: Readonly<Record<string, VideoPropValue>>): VideoSettings => {
  const params = videoParams(entry);
  const chosen = props.duration;
  const duration = chosen !== undefined && params.supported("duration", chosen) ? Number(chosen) : params.durations[0];
  const setting = (key: string): string | undefined => {
    const value = props[key];
    return value !== undefined && params.supported(key, value) ? String(value) : undefined;
  };
  const size = params.exactSizes ? setting("size") : undefined;
  const resolution = params.exactSizes ? undefined : setting("resolution");
  const aspect_ratio = params.exactSizes ? undefined : setting("aspect_ratio");
  return {
    ...(duration === undefined ? {} : { duration }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(aspect_ratio === undefined ? {} : { aspect_ratio }),
    ...(size === undefined ? {} : { size }),
    ...(params.audio ? { generate_audio: props.generate_audio === true } : {}),
  };
};

export const composeVideoRequest = (input: VideoRequestInput): VideoRequestPlan => {
  const { composition, props } = input;
  const urlOf = input.urlOf ?? defaultUrl;
  const mode = inputModeOf(props);
  const roles: Record<string, string> = {};
  const input_references: VideoRequestReference[] = [];
  const frame_images: VideoRequestFrame[] = [];
  const sent: Slot[] = [];
  let unused = 0;
  let localVideos = 0;

  if (mode === "reference") {
    for (const slot of composition.references) {
      roles[slot.shapeId] = `${slot.kind} ${slot.number}`;
      const url = urlOf(slot);
      input_references.push(slot.kind === "image" ? { type: "image_url", image_url: { url } } : { type: "video_url", video_url: { url } });
      if (slot.kind === "video" && slot.source.type === "file") localVideos++;
      sent.push(slot);
    }
  } else {
    // A frame mode sends frames and no references: the provider treats a request with frames
    // as image-to-video and discards references.
    const room = mode === "first_last" ? 2 : 1;
    for (const slot of composition.references) {
      if (slot.kind === "image" && frame_images.length < room) {
        const frame_type = frame_images.length === 0 ? "first_frame" : "last_frame";
        roles[slot.shapeId] = frame_type === "first_frame" ? "first" : "last";
        frame_images.push({ type: "image_url", image_url: { url: urlOf(slot) }, frame_type });
        sent.push(slot);
      } else {
        roles[slot.shapeId] = UNUSED_ROLE;
        unused++;
      }
    }
  }

  const request: VideoRequest = { prompt: composition.prompt, input_references, frame_images, ...videoSettings(input.entry, props) };

  return {
    mode,
    roles,
    request,
    sent,
    counts: {
      referencedImages: input_references.filter((ref) => ref.type === "image_url").length,
      referencedVideos: input_references.filter((ref) => ref.type === "video_url").length,
      localVideos,
      frames: frame_images.length,
      unused,
    },
  };
};
