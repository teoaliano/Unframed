/**
 * Where shape components report that they rendered. Nothing listens unless the frame
 * meter (`?fps=1`) is loaded, so the call costs one check.
 */
let sink: ((shapeId: string) => void) | undefined;

export const noteRender = (shapeId: string): void => {
  if (sink) sink(shapeId);
};

export const setRenderSink = (next: ((shapeId: string) => void) | undefined): void => {
  sink = next;
};
