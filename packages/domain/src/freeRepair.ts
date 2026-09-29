/**
 * The one text call a Free batch makes when its list is not already a list, verbatim from
 * assets/prompts/free-repair.md (a test holds it to the asset). The rules go in the system
 * role and the text in the user turn, never one string: a description saying "apply that
 * style to image 3" was otherwise obeyed as an instruction instead of rewritten as data.
 */

const BASE = [
  "You rewrite a rough description into image prompts, one per image, separated by lines containing only ---.",
  "",
  "Each section must read as a complete prompt on its own: repeat the shared subject and style rather than referring back to another section.",
  'If the text asks for several versions or variations of one subject, write that many sections, each describing a different specific variation, and drop the count itself ("3 versions of a fox" becomes three sections, each describing one fox).',
  "Never emit the same section twice.",
  "If the text describes a single image with no variations implied, return it unchanged.",
  "No preamble, no numbering, no commentary. Output the sections and nothing else.",
];

const imageBlock = (count: number) => [
  "",
  count === 1 ? "1 reference image is attached, numbered 1 to 1." : `${count} reference images are attached, numbered 1 to ${count}.`,
  'A section that needs only some of them opens with a line reading "images: " followed by their numbers, for example "images: 1, 4". Omit that line when the section should receive all of them.',
  "Never write \"image 3\" inside a section. Refer to an image by its POSITION in that section's own images: line, in square brackets. [1] is the first number you listed, [2] the second. The brackets restart at [1] in every section.",
  "",
  "Example. Three images are attached and the description reads:",
  '  "Use image 1 as a style reference. Apply it to image 2 and to image 3, as two separate images."',
  "You output exactly:",
  "  images: 1, 2",
  "  Apply the visual style of [1] to the subject and composition of [2].",
  "  ---",
  "  images: 1, 3",
  "  Apply the visual style of [1] to the subject and composition of [2].",
];

/** The repair's system message: the base rules, and the image rules only when `images` are attached. */
export const repairSystemPrompt = (images: number): string => [...BASE, ...(images > 0 ? imageBlock(images) : [])].join("\n");

/** The repair's user message: the text to rewrite, behind its label. */
export const repairUserTurn = (text: string): string => `Text to rewrite:\n\n${text}`;
