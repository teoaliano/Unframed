import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "../../engine/test/gitRepos.ts";

export const REACT_MAIN = `import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);
`;

export const REACT_APP = `import Card from "./Card.jsx";

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

export const positionOf = (source: string, needle: string) => {
  const at = source.indexOf(needle);
  if (at < 0) throw new Error(`${needle} is not in the source`);
  const before = source.slice(0, at).split("\n");
  return { line: before.length, col: before[before.length - 1]!.length + 1 };
};

const ESBUILD = fileURLToPath(new URL("../../../node_modules/esbuild", import.meta.url));
const NODE_MODULES = fileURLToPath(new URL("../node_modules", import.meta.url));

export const prepareReactApp = async (root: string) => {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "react-fixture.json"), JSON.stringify({ esbuild: ESBUILD, nodeModules: NODE_MODULES }) + "\n");
  await writeFile(join(root, "src", "main.jsx"), REACT_MAIN);
  await writeFile(join(root, "src", "App.jsx"), REACT_APP);
  await writeFile(join(root, "src", "Card.jsx"), REACT_CARD);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "react app");
};
