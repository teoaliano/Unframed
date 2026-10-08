import { isMintedRef, readRef } from "@unframed/domain";
import type { TLShape } from "tldraw";

/** A name a person gave the shape (spec 06), or `undefined` while its `@id` is a minted number. */
export const nameOf = (shape: TLShape): string | undefined => {
  const ref = readRef(shape);
  return ref !== undefined && !isMintedRef(ref) ? ref : undefined;
};

/**
 * What a shape that is waiting for its content (an empty or generating medium, a render, an
 * empty artifact) says above its corner: `@<name>` once named, else what it is.
 */
export const waitingLabel = (shape: TLShape, kindWord: string): string => {
  const name = nameOf(shape);
  return name === undefined ? kindWord : `@${name}`;
};
