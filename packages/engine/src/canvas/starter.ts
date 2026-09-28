/**
 * The two prompts a new canvas starts with, verbatim from assets/prompts/starter-canvas.md
 * (a test holds them to it). The subject gets the first ref, the scene the second, and
 * the scene references the subject by that ref.
 */
export const STARTER_SUBJECT = "lone red fox";
export const STARTER_SCENE = "A @<subject id> on a windswept cliff at golden hour, cinematic, 35mm";
export const SUBJECT_PLACEHOLDER = "@<subject id>";

export const STARTER_SCENE_AT = { x: 40, y: 60 } as const;
export const STARTER_SUBJECT_AT = { x: 40, y: 320 } as const;
