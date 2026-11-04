const LABELS: Readonly<Record<string, string>> = {
  x: "X",
  y: "Y",
  xPercent: "X percent",
  yPercent: "Y percent",
  scale: "Scale",
  scaleX: "Scale X",
  scaleY: "Scale Y",
  rotation: "Rotation",
  rotationX: "Rotation X",
  rotationY: "Rotation Y",
  skewX: "Skew X",
  skewY: "Skew Y",
  width: "Width",
  height: "Height",
  opacity: "Opacity",
  autoAlpha: "Opacity",
  backgroundColor: "Background",
  color: "Colour",
  borderColor: "Border colour",
  borderRadius: "Corner radius",
  borderWidth: "Border width",
  boxShadow: "Shadow",
  fontSize: "Font size",
  letterSpacing: "Letter spacing",
  lineHeight: "Line height",
  gap: "Gap",
};

const DEGREES: ReadonlySet<string> = new Set(["rotation", "rotationX", "rotationY", "skewX", "skewY"]);

export const propertyLabel = (property: string): string => {
  const known = LABELS[property];
  if (known !== undefined) return known;
  const words = property.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const bareUnitOf = (property: string): string => (DEGREES.has(property) ? "°" : "");
