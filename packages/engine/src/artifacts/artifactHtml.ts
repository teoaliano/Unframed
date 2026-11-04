import { ARTIFACT_SIZE_LIMIT, BRIDGE_TAG, COMPONENT_HELPER_TAG, injectTags, type ArtifactKind } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";

const injectHelper = (html: string): string => {
  if (html.includes(COMPONENT_HELPER_TAG)) return html;
  if (html.includes(BRIDGE_TAG)) return html.replace(BRIDGE_TAG, `${BRIDGE_TAG}\n${COMPONENT_HELPER_TAG}`);
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (open) => `${open}\n${COMPONENT_HELPER_TAG}`) : `${COMPONENT_HELPER_TAG}\n${html}`;
};

export const prepareComponentHtml = (html: string): string => stampElementIds(injectHelper(injectTags(html, "component")));

export const prepareArtifactHtml = (html: string, kind: ArtifactKind): string => stampElementIds(injectTags(html, kind));

export const byteSize = (text: string): number => Buffer.byteLength(text, "utf8");

export const kindOfArtifactHtml = (html: string): ArtifactKind => (/data-hyperframes-preview-runtime|hyperframes-runtime\.js/i.test(html) ? "motion" : "page");

export const isHtmlFileName = (name: string): boolean => /\.html?$/i.test(name);

export const tooLargeMessage = (kind: ArtifactKind, bytes: number): string =>
  `The ${kind} would be too large (${bytes} bytes; the limit is ${ARTIFACT_SIZE_LIMIT}).`;
