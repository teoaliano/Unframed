const PAGE = typeof CHUNK === "number" ? CHUNK : 0;
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const variables = await figma.variables.getLocalVariablesAsync();
const byId = new Map(variables.map((v) => [v.id, v]));
const order = ["Primitives", "Tokens", "Theme", "Components"];
const hex = (c) => {
  const h = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a !== undefined && c.a < 1 ? h(c.a) : ""}`;
};
const value = (x) => {
  if (x && typeof x === "object" && x.type === "VARIABLE_ALIAS") return `{${byId.get(x.id).name}}`;
  if (x && typeof x === "object" && "r" in x) return hex(x);
  if (typeof x === "number") return String(Math.round(x * 1e4) / 1e4);
  return String(x);
};
const lines = ["collection\tname\ttype\tlight\tdark\tcode"];
for (const name of order) {
  const c = collections.find((k) => k.name === name);
  const vars = variables.filter((v) => v.variableCollectionId === c.id).sort((a, b) => a.name.localeCompare(b.name));
  for (const v of vars) {
    const values = c.modes.map((m) => value(v.valuesByMode[m.modeId]));
    const dark = values.length > 1 && values[1] !== values[0] ? values[1] : "";
    const code = (v.codeSyntax.WEB || "").trim();
    const fallback = `var(--${v.name.replaceAll("/", "-")})`;
    lines.push([name, v.name, v.resolvedType, values[0], dark, code === fallback ? "" : code].join("\t"));
  }
}
const text = `${lines.join("\n")}\n`;
const size = 40000;
return { chunks: Math.ceil(text.length / size), body: text.slice(PAGE * size, (PAGE + 1) * size) };
