import { describe, expect, it } from "vitest";
import { designSystemOf, searchDesignSystem } from "../../src/index.ts";

const tree = (entries: Record<string, string>) => new Map(Object.entries(entries));

const BUTTON = [
  'import * as React from "react";',
  'import { cva, type VariantProps } from "class-variance-authority";',
  "",
  "const buttonVariants = cva(",
  '  "inline-flex items-center hover:bg-primary/90",',
  "  {",
  "    variants: {",
  "      variant: {",
  '        default: "bg-primary text-primary-foreground",',
  '        destructive: "bg-destructive",',
  '        "ghost-subtle": "hover:bg-accent",',
  "      },",
  '      size: { sm: "h-8", lg: "h-10", icon: "size-9" },',
  "    },",
  '    defaultVariants: { variant: "default", size: "sm" },',
  "  },",
  ");",
  "",
  "export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {",
  "  asChild?: boolean;",
  "  readonly loading?: boolean",
  "  onPress(event: Event): void;",
  "}",
  "",
  "const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => null);",
  "",
  "export { Button, buttonVariants };",
].join("\n");

const files = tree({
  "src/components/ui/button.tsx": BUTTON,
  "src/components/Card.tsx": "export function Card({ title, footer = null, children }: { title: string }) {\n  return <div />;\n}\nexport const CardTitle = ({ text }) => null;\nfunction helper() {}\nconst Internal = () => null;",
  "src/components/Avatar.vue": '<script setup lang="ts">\nconst props = defineProps<{ src: string; size?: number }>()\n</script>',
  "src/pages/Home.tsx": "export default function Home() {\n  return <Card title='x'><Button variant=\"ghost\">a</Button><Button/><Button\n size='sm'>b</Button><Avatar /></Card>;\n}",
  "src/pages/Other.tsx": "export const Other = () => <Button>c</Button>; const ButtonGroup = 1; <ButtonGroup />",
  "src/styles/globals.css": [
    '@import "tailwindcss";',
    "@theme {",
    "  --color-brand: oklch(0.7 0.1 200);",
    "  --radius-lg: 0.75rem;",
    "  --font-display: 'Inter', sans-serif;",
    "  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.1);",
    "}",
    "/* --commented: 1px; */",
    ":root { --primary: 222 47% 11%; --spacing-gutter: 24px; }",
    ".dark { --primary: 210 40% 98%; }",
    ".a { color: var(--primary); }",
  ].join("\n"),
  "tailwind.config.ts": [
    "export default {",
    "  theme: {",
    "    fontFamily: { sans: ['Inter', 'system-ui'] },",
    "    extend: {",
    "      colors: {",
    '        border: "hsl(var(--border))",',
    "        primary: {",
    '          DEFAULT: "hsl(var(--primary))",',
    '          foreground: "hsl(var(--primary-foreground))",',
    "        },",
    "      },",
    '      borderRadius: { lg: "var(--radius)" },',
    "    },",
    "  },",
    "};",
  ].join("\n"),
});

describe("the design-system index", () => {
  const index = designSystemOf(files);

  it("lists exported components with their props, variants and usage, most used first", () => {
    const button = index.components.find((component) => component.name === "Button")!;
    expect(button).toEqual({
      name: "Button",
      file: "src/components/ui/button.tsx",
      line: 25,
      props: ["asChild", "loading", "onPress"],
      variants: { variant: ["default", "destructive", "ghost-subtle"], size: ["sm", "lg", "icon"] },
      uses: 4,
      usedIn: ["src/pages/Home.tsx", "src/pages/Other.tsx"],
    });
    expect(index.components[0]!.name).toBe("Button");
    expect(index.components.find((component) => component.name === "Card")).toMatchObject({ line: 1, props: ["title", "footer", "children"], uses: 1, variants: {} });
    expect(index.components.find((component) => component.name === "CardTitle")).toMatchObject({ props: ["text"], uses: 0 });
    expect(index.components.find((component) => component.name === "Avatar")).toMatchObject({ file: "src/components/Avatar.vue", props: ["src", "size"], uses: 1 });
    expect(index.components.map((component) => component.name)).not.toContain("Internal");
  });

  it("lists CSS variables and Tailwind theme keys with where they are declared", () => {
    const byName = (name: string, source = "css") => index.tokens.find((token) => token.name === name && token.source === source);
    expect(byName("--color-brand")).toEqual({ name: "--color-brand", value: "oklch(0.7 0.1 200)", file: "src/styles/globals.css", line: 3, kind: "color", source: "css" });
    expect(byName("--radius-lg")!.kind).toBe("radius");
    expect(byName("--font-display")!.kind).toBe("font");
    expect(byName("--shadow-card")!.kind).toBe("shadow");
    expect(byName("--spacing-gutter")!.kind).toBe("spacing");
    expect(byName("--primary")).toMatchObject({ value: "222 47% 11%", line: 9, kind: "color" });
    expect(byName("--commented")).toBeUndefined();
    expect(index.tokens.filter((token) => token.source === "tailwind").map((token) => [token.name, token.kind, token.line])).toEqual([
      ["sans", "font", 3],
      ["border", "color", 6],
      ["primary", "color", 8],
      ["primary-foreground", "color", 9],
      ["lg", "radius", 12],
    ]);
    expect(byName("primary", "tailwind")!.value).toBe('"hsl(var(--primary))"');
  });

  it("finds components and tokens by words, best match first", () => {
    expect(searchDesignSystem(index, "button").components.map((component) => component.name)).toEqual(["Button"]);
    expect(searchDesignSystem(index, "destructive").components.map((component) => component.name)).toEqual(["Button"]);
    expect(searchDesignSystem(index, "TITLE").components.map((component) => component.name)).toEqual(["CardTitle", "Card"]);
    expect(searchDesignSystem(index, "primary", { kind: "token" }).tokens.map((token) => token.name)).toEqual(["--primary", "primary", "primary-foreground"]);
    expect(searchDesignSystem(index, "primary", { kind: "token" }).components).toEqual([]);
    expect(searchDesignSystem(index, "", { limit: 2 }).components).toHaveLength(2);
  });
});
