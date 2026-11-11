import { designDisplayValues, shapeDesignOf, type DesignableType } from "@unframed/domain";
import type { CSSProperties, ReactElement } from "react";
import {
  ArrowShapeUtil,
  DrawShapeUtil,
  GeoShapeUtil,
  HighlightShapeUtil,
  LineShapeUtil,
  NoteShapeUtil,
  type TLAnyShapeUtilConstructor,
  type TLGeoShape,
  type TLNoteShape,
  type TLShape,
} from "tldraw";

export const customValuesFor =
  <V,>(type: DesignableType) =>
  (_editor: unknown, shape: TLShape): Partial<V> =>
    designDisplayValues(type, shapeDesignOf(shape.meta)) as Partial<V>;

const designJson = (shape: TLShape): string => JSON.stringify(shapeDesignOf(shape.meta));

export const weightStyle = (shape: TLShape): CSSProperties | undefined => {
  const weight = shapeDesignOf(shape.meta).fontWeight;
  return weight === undefined ? undefined : ({ "--uf-weight": weight } as CSSProperties);
};

const withWeight = (shape: TLShape, body: ReactElement): ReactElement => {
  const style = weightStyle(shape);
  return style === undefined ? body : (
    <div className="contents" data-uf-weight="" style={style}>
      {body}
    </div>
  );
};

export class DesignedGeoShapeUtil extends GeoShapeUtil.configure({ getCustomDisplayValues: customValuesFor<ReturnType<GeoShapeUtil["options"]["getDefaultDisplayValues"]>>("geo") }) {
  override component(shape: TLGeoShape) {
    return withWeight(shape, super.component(shape));
  }

  override onBeforeUpdate(prev: TLGeoShape, next: TLGeoShape) {
    if (designJson(prev) === designJson(next)) return super.onBeforeUpdate(prev, next);
    return super.onBeforeUpdate({ ...prev, props: { ...prev.props, size: prev.props.size === "s" ? "m" : "s" } }, next);
  }
}

export class DesignedNoteShapeUtil extends NoteShapeUtil.configure({ getCustomDisplayValues: customValuesFor<ReturnType<NoteShapeUtil["options"]["getDefaultDisplayValues"]>>("note") }) {
  override component(shape: TLNoteShape) {
    return withWeight(shape, super.component(shape));
  }
}

export const DesignedArrowShapeUtil = ArrowShapeUtil.configure({ getCustomDisplayValues: customValuesFor<ReturnType<ArrowShapeUtil["options"]["getDefaultDisplayValues"]>>("arrow") });

export const DesignedDrawShapeUtil = DrawShapeUtil.configure({ getCustomDisplayValues: customValuesFor<ReturnType<DrawShapeUtil["options"]["getDefaultDisplayValues"]>>("draw") });

export const DesignedLineShapeUtil = LineShapeUtil.configure({ getCustomDisplayValues: customValuesFor<ReturnType<LineShapeUtil["options"]["getDefaultDisplayValues"]>>("line") });

export const DesignedHighlightShapeUtil = HighlightShapeUtil.configure({ getCustomDisplayValues: customValuesFor<ReturnType<HighlightShapeUtil["options"]["getDefaultDisplayValues"]>>("highlight") });

export const DESIGNED_SHAPE_UTILS = [DesignedGeoShapeUtil, DesignedNoteShapeUtil, DesignedArrowShapeUtil, DesignedDrawShapeUtil, DesignedLineShapeUtil, DesignedHighlightShapeUtil] as unknown as readonly TLAnyShapeUtilConstructor[];
