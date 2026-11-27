import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./gitRepos.ts";

export const REACT_MAIN = `import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);
`;

export const REACT_APP = `import Button from "./Button.jsx";
import Card from "./Card.jsx";

function Header() {
  return (
    <header className="flex h-12 items-center pl-3.5 pr-2">
      <h2 className="text-sm font-medium">Agent</h2>
    </header>
  );
}

export default function App() {
  return (
    <main className="flex min-h-screen gap-4 p-4">
      <Header />
      <ul>
        <Card title="First" />
        <Card title="Second" />
        <Card title="Third" />
      </ul>
      <Button variant="ghost" size="sm" pressed={false}>Save</Button>
    </main>
  );
}
`;

export const REACT_CARD = `export default function Card({ title }) {
  return (
    <li className="rounded-lg p-4">
      <h3 className="text-base">{title}</h3>
      <p className="text-sm">Static body</p>
    </li>
  );
}
`;

export const REACT_BUTTON = `const cva = (base, config) => (props) => [base, ...Object.keys(config.variants).map((axis) => config.variants[axis][props[axis] ?? config.defaultVariants[axis]])].join(" ");

const buttonVariants = cva("rounded px-2", {
  variants: {
    variant: { ghost: "bg-[#ffffff]", outline: "bg-[#eeeeee]", destructive: "bg-[#ff0000]" },
    size: { sm: "h-7", lg: "h-9" },
  },
  defaultVariants: { variant: "ghost", size: "sm" },
});

export default function Button({ variant, size, pressed, children }) {
  return (
    <button className={buttonVariants({ variant, size })} aria-pressed={pressed}>
      {children}
    </button>
  );
}
`;

export const REACT_CSS = `@import "tailwindcss";

@theme {
  --color-zinc-800: #27272a;
  --color-sky-600: #0084d1;
  --text-5xs: 0.4375rem;
  --text-5xs--line-height: 0.75rem;
}

:root {
  --text-default: var(--color-zinc-800);
  --action-highlight: var(--color-sky-600);
  --surface-page: #fafafa;
  --border-default: #e4e4e7;
  --button-ghost-foreground: var(--text-default);
  --button-ghost-surface: #ffffff;
}
`;

export const positionOf = (source: string, needle: string) => {
  const at = source.indexOf(needle);
  if (at < 0) throw new Error(`${needle} is not in the source`);
  const before = source.slice(0, at).split("\n");
  return { line: before.length, col: before[before.length - 1]!.length + 1 };
};

const ESBUILD = fileURLToPath(new URL("../../../node_modules/esbuild", import.meta.url));
const NODE_MODULES = fileURLToPath(new URL("../../web/node_modules", import.meta.url));

export const prepareReactApp = async (root: string) => {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "react-fixture.json"), JSON.stringify({ esbuild: ESBUILD, nodeModules: NODE_MODULES }) + "\n");
  await writeFile(join(root, "src", "main.jsx"), REACT_MAIN);
  await writeFile(join(root, "src", "App.jsx"), REACT_APP);
  await writeFile(join(root, "src", "Card.jsx"), REACT_CARD);
  await writeFile(join(root, "src", "Button.jsx"), REACT_BUTTON);
  await writeFile(join(root, "src", "index.css"), REACT_CSS);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "react app");
};
