import type { Box } from "@unframed/domain";
import { plainText } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";

type ShapeLike = { id: string; typeName: string; type: string; x: number; y: number; parentId: string; props: Record<string, unknown> };

const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const FONT_SIZES: Record<string, number> = { s: 18, m: 24, l: 36, xl: 44 };

const pointsBox = (points: ReadonlyArray<{ x?: unknown; y?: unknown }>): { x: number; y: number; w: number; h: number } | undefined => {
  if (points.length === 0) return undefined;
  const xs = points.map((point) => num(point.x));
  const ys = points.map((point) => num(point.y));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
};

/** A text's height, estimated from its lines and wrapping: the engine has no text layout. */
const textHeight = (props: Record<string, unknown>, width: number): number => {
  const size = FONT_SIZES[String(props.size)] ?? 18;
  const perLine = Math.max(1, Math.floor(width / (size * 0.55)));
  const lines = plainText(props.richText)
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.max(28, lines * size * 1.35);
};

/** A shape's box in its parent's space, near enough to keep results from landing on it. */
const localBox = (shape: ShapeLike): Box => {
  const { props } = shape;
  const scale = num(props.scale, 1);
  switch (shape.type) {
    case "text": {
      const w = num(props.w, 320) * scale;
      return { x: shape.x, y: shape.y, w, h: textHeight(props, w) * scale };
    }
    case "note":
      return { x: shape.x, y: shape.y, w: 200 * scale, h: (200 + num(props.growY)) * scale };
    case "draw":
    case "highlight": {
      const segments = Array.isArray(props.segments) ? (props.segments as Array<{ points?: unknown }>) : [];
      const points = segments.flatMap((segment) => (Array.isArray(segment.points) ? (segment.points as Array<{ x?: unknown; y?: unknown }>) : []));
      const box = pointsBox(points);
      return box ? { x: shape.x + box.x * scale, y: shape.y + box.y * scale, w: box.w * scale, h: box.h * scale } : { x: shape.x, y: shape.y, w: 1, h: 1 };
    }
    case "line": {
      const points = typeof props.points === "object" && props.points !== null ? Object.values(props.points as Record<string, { x?: unknown; y?: unknown }>) : [];
      const box = pointsBox(points);
      return box ? { x: shape.x + box.x * scale, y: shape.y + box.y * scale, w: box.w * scale, h: box.h * scale } : { x: shape.x, y: shape.y, w: 1, h: 1 };
    }
    case "arrow": {
      const box = pointsBox([props.start as { x?: unknown; y?: unknown }, props.end as { x?: unknown; y?: unknown }].filter(Boolean));
      return box ? { x: shape.x + box.x, y: shape.y + box.y, w: box.w, h: box.h } : { x: shape.x, y: shape.y, w: 1, h: 1 };
    }
    default: {
      const w = num(props.w, 1);
      const h = num(props.h, 1) + num(props.growY);
      return { x: shape.x, y: shape.y, w: w * scale, h: h * scale };
    }
  }
};

/** The page bounds of every shape in `records` (a group's members moved by their group's origin). */
export const shapePageBounds = (records: ReadonlyArray<TLRecord>): Box[] => {
  const shapes = records.filter((record) => record.typeName === "shape") as unknown as ShapeLike[];
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const originOf = (shape: ShapeLike, depth = 0): { x: number; y: number } => {
    const parent = byId.get(shape.parentId);
    if (!parent || depth > 8) return { x: 0, y: 0 };
    const above = originOf(parent, depth + 1);
    return { x: above.x + parent.x, y: above.y + parent.y };
  };
  return shapes.map((shape) => {
    const box = localBox(shape);
    const origin = originOf(shape);
    return { x: origin.x + box.x, y: origin.y + box.y, w: box.w, h: box.h };
  });
};
