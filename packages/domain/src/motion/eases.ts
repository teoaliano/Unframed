/**
 * The eases the timeline's ease picker offers (spec 21). Spec 19's ease catalogue is the source
 * of these names; this copy is the same 31 entries until spec 19 lands on main, and the merge
 * reconciles the two. GSAP writes linear as `none` and the rest as `<family>.in|out|inOut`.
 */
const FAMILIES = ["sine", "power1", "power2", "power3", "power4", "expo", "circ", "back", "elastic", "bounce"] as const;

export const EASE_CATALOGUE: readonly string[] = [
  "none",
  ...FAMILIES.flatMap((family) => [`${family}.in`, `${family}.out`, `${family}.inOut`]),
];
