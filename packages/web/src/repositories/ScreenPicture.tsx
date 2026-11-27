import type { ScreenShapeProps } from "@unframed/contracts";
import { pictureKeyOf, pictureUrl } from "@unframed/domain";
import { useState } from "react";
import { useValue } from "tldraw";
import { repositoryState, screenSnapshotUrl } from "./store.ts";

export type PictureSize = "tiny" | "small" | "full";

const IMAGE = "pointer-events-none absolute inset-0 block size-full object-cover select-none";

const drawnPictures = new Map<string, string>();

export const ScreenPicture = ({
  project,
  shapeId,
  props,
  branch,
  size,
}: {
  readonly project: string;
  readonly shapeId: string;
  readonly props: ScreenShapeProps;
  readonly branch: string;
  readonly size: PictureSize;
}) => {
  const legacy = useValue("screen snapshot", () => repositoryState(project).snapshots.get().get(shapeId), [project, shapeId]);
  const key = pictureKeyOf(props);
  const src = key !== undefined ? pictureUrl(project, key, size === "tiny" ? "w128" : size === "small" ? "w384" : "full") : legacy !== undefined ? screenSnapshotUrl(project, legacy) : undefined;
  const slot = `${project}\n${shapeId}\n${size}`;
  const [drawn, setDrawn] = useState<string | undefined>(undefined);
  const before = drawnPictures.get(slot);
  const fallback = src !== undefined && drawn !== src && before !== src ? before : undefined;
  if (src === undefined)
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-(--artifact-card-surface) p-3 text-center font-sans text-sm text-(--artifact-card-foreground)" data-testid="screen-placeholder">
        <span className="font-medium text-(--artifact-card-title)">{branch}</span>
        <span>{props.state?.trim() || props.route}</span>
      </div>
    );
  return (
    <>
      {fallback !== undefined && <img className={IMAGE} data-testid="screen-snapshot-fallback" src={fallback} alt="" draggable={false} />}
      <img
        className={IMAGE}
        data-testid="screen-snapshot"
        data-picture-size={key === undefined ? undefined : size}
        src={src}
        alt=""
        draggable={false}
        onLoad={() => {
          drawnPictures.set(slot, src);
          setDrawn(src);
        }}
      />
    </>
  );
};
