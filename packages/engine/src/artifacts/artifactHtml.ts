/**
 * The one way an artifact file's text is made ready to write (spec 18): spec 09's tags for the
 * kind, then element ids, so the size check counts the ids. Every writer of a page or motion
 * file calls this, so none can leave an untagged or unstamped file.
 */
import { ARTIFACT_SIZE_LIMIT, BRIDGE_TAG, COMPONENT_HELPER_TAG, injectTags, type ArtifactKind } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";

/** The sheet helper goes right after the bridge tag, or at the head's open tag when the bridge is absent (spec 20). */
const injectHelper = (html: string): string => {
  if (html.includes(COMPONENT_HELPER_TAG)) return html;
  if (html.includes(BRIDGE_TAG)) return html.replace(BRIDGE_TAG, `${BRIDGE_TAG}\n${COMPONENT_HELPER_TAG}`);
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (open) => `${open}\n${COMPONENT_HELPER_TAG}`) : `${COMPONENT_HELPER_TAG}\n${html}`;
};

/** A component sheet made ready for writing (spec 20): the tags of a sheet, then element ids. Any writer of a sheet calls this. */
export const prepareComponentHtml = (html: string): string => stampElementIds(injectHelper(injectTags(html, "component")));

export const prepareArtifactHtml = (html: string, kind: ArtifactKind): string => stampElementIds(injectTags(html, kind));

export const byteSize = (text: string): number => Buffer.byteLength(text, "utf8");

/** The kind of a composition already on disk: a motion carries the runtime tag, a page never does. */
export const kindOfArtifactHtml = (html: string): ArtifactKind => (/data-hyperframes-preview-runtime|hyperframes-runtime\.js/i.test(html) ? "motion" : "page");

export const isHtmlFileName = (name: string): boolean => /\.html?$/i.test(name);

/** The message a page or motion over the artifact limit gets from every writer. */
export const tooLargeMessage = (kind: ArtifactKind, bytes: number): string =>
  `The ${kind} would be too large (${bytes} bytes; the limit is ${ARTIFACT_SIZE_LIMIT}).`;
