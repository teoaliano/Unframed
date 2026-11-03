/**
 * The one place the motion code reads HTML as a document. linkedom is the parser HyperFrames
 * itself uses in the engine; the domain has no DOM lib, so the types here are the few members
 * the motion code reads.
 */
import { parseHTML } from "linkedom";

export const linkedomDocument = (html: string): unknown => (parseHTML(html) as unknown as { document: unknown }).document;
