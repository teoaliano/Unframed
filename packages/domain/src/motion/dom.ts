import { parseHTML } from "linkedom";

export const linkedomDocument = (html: string): unknown => (parseHTML(html) as unknown as { document: unknown }).document;
