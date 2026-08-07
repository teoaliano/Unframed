# Unframed

A tiny, local, node-based image generator. Wire prompt and image nodes into an output node, hit **Generate**, and it calls **GPT Image 2 through OpenRouter** and writes the result to a folder on your machine. No hosting, pay-per-generation.

## What's inside

- **client/** — React + React Flow (`@xyflow/react`) canvas with four node types: `prompt` and `image` inputs, `output` (image) and `text` outputs.
- **server/** — a small Express server that holds your OpenRouter key, calls the Image API, and writes files to disk.
- **client/src/graph/resolve.js** — the only part with real logic: prompt-to-prompt reference substitution, cycle detection, and building the request. Worth reading first.

## Requirements

- **Node.js 18 or newer** — the server relies on the built-in `fetch`. Check with `node -v`.
- **npm** (ships with Node).
- An **OpenRouter API key** — create one at https://openrouter.ai/keys and put a few dollars of credit on the account. You are billed per generated image, so nothing is charged until you press Generate.

## Install and run

### 1. Get the code

```bash
git clone https://github.com/teoaliano/Unframed.git
cd Unframed
```

### 2. Install dependencies

```bash
npm run install:all
```

This is three installs in one: the repo root, `server/`, and `client/` each have their own `package.json`. Running plain `npm install` only does the root and the app will not start.

### 3. Start it

```bash
npm run dev
```

This runs both processes together — the backend on **8787** and the canvas on **5173**. Both must be running; the client proxies `/api` to the server.

### 4. Add your API key

Open **http://localhost:5173** and click the **key icon** in the top right. Paste your OpenRouter key and save — that's it. The key is sent to the local server, which writes it to a `.env` file next to the code so it survives a restart, and keeps it server-side from then on. The browser never stores it.

The same dialog replaces the key later, or removes it with **Remove key** (two clicks, since the key can't be read back out).

<details>
<summary>Prefer to configure by file instead?</summary>

```bash
cp .env.example .env
```

Then set `OPENROUTER_API_KEY=sk-or-v1-...` in it and restart. Same result — the UI writes to this file.
</details>

`.env` is gitignored, so your key is never committed. Nothing else needs configuring, but three more variables are available if you want them — set them in `.env`, they have no UI:

| Variable | Default | What it does |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | — | Required. Set it in the app, or here. |
| `OPENROUTER_MODEL` | `openai/gpt-image-2` | Any image model slug OpenRouter lists. |
| `OPENROUTER_TEXT_MODEL` | `google/gemini-3.5-flash-lite` | Model for text nodes. Must accept image input. |
| `OPENROUTER_VIDEO_MODEL` | `bytedance/seedance-2.0` | Model for the output node's Video tab. Billed per second. |
| `OUTPUT_DIR` | `./output` | Where images, sidecars, and saved graphs are written. Created automatically. |
| `PORT` | `8787` | Backend port. The client dev server proxies `/api` here. |

### 5. Generate

The starter graph gives you two prompt nodes wired into an output node. Press **Generate** and the image appears in the node and lands in `output/<project>/` alongside a `.json` sidecar recording the prompt, parameters, and what OpenRouter charged.

At startup the server prints what it resolved, which is the quickest way to confirm the key took:

```
  Unframed server  →  http://localhost:8787
  model:    openai/gpt-image-2
  api key:  loaded
  output:   /path/to/Unframed/output
```

### Running the halves separately

Useful when you only want to restart one:

```bash
npm run server   # backend only, on 8787
npm run client   # canvas only, on 5173
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `api key:  MISSING` on startup | No key saved yet — add one with the key icon in the top right. If you set it by hand, it must be `OPENROUTER_API_KEY` in a `.env` at the repo root, not inside `server/`. |
| "That does not look like an OpenRouter key" | The key must start with `sk-or-`, with no spaces or line breaks. Copy it again from openrouter.ai/keys. |
| `EADDRINUSE` on 8787 or 5173 | Something else holds the port. Find it with `lsof -ti tcp:8787` (macOS/Linux) and stop it, or set a different `PORT` in `.env`. |
| Generate returns a 401 | The key is wrong or revoked. Test it: `curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/key` |
| Generate returns a 402 | No credit on the OpenRouter account. |
| The canvas loads but Generate does nothing | The backend isn't up. Check http://localhost:8787/api/health — it returns the model, whether the key loaded, and the output folder. |
| A parameter seems ignored | The chosen model doesn't support it. See [Switching models](#switching-models). |
| `SyntaxError` / unsupported syntax on startup | Node is older than 18. `node -v` to confirm. |

## How the graph works

Nodes come in two families. **Inputs** feed edges; **outputs** consume them.

- **Prompt** (input) — free text. Embed another prompt or text node's content inline by typing `@` and picking it from the menu; each node shows its own id in its header. Circular references (`A -> B -> A`) are caught and reported instead of looping forever.
- **Image** (input) — a picture handed to the model as image-to-image guidance (GPT Image 2 accepts several). Connect it to an output node and it gets a number; refer to it in a prompt as "image 1". Numbering is per consumer: an image feeding both a text node and an output node shows both ranks at once, e.g. "1 / 2", one per node it's wired into.
- **Output** — collects everything wired into it, resolves the prompts top-to-bottom, sends the lot to OpenRouter, then shows the image plus the exact cost OpenRouter reports. **Runs** generates the same prompt up to 10 times at once; switch it to **Free** and the number comes from a wired-in text node instead — each `---`-separated item in its result becomes one image, which is how one prompt turns into a set.
- **Text** (output) — same wiring, but runs the prompt through a *text* model and keeps the answer. Any images wired in are sent along, so it can describe or plan from a picture. The answer is editable, and downstream prompts pull it in with `@id`. Use it to have one model write the prompt for another.

Only output nodes (Output, Text) consume edges, so wiring is always "sources → output." Prompt composition happens through `@id` tokens, not edges. The starter graph shows this: the `scene` prompt embeds the `subject` prompt.

Source order is decided by vertical position on the canvas — prompts are concatenated top to bottom, so move a node up or down to reorder it.

## The Library

The book button above **+** opens a small library of ready-made fragments. Adding one
drops plain copies onto the canvas — fresh ids, nothing linking back to the preset, so
edit them like anything you built by hand. Each entry says what it still **needs** wired
in. The first preset is **Layerize**: a planner prompt, a text node, and a Free-mode
output; wire one image node into both the text and output nodes, Run the planner, read
its plan, then Generate one image per part.

## Projects

The project menu in the top bar switches between graphs. Each is a folder under `output/`, holding its images, their sidecars, and a `graph.json` of the canvas. Edits save automatically about half a second after you stop, so there's no save button.

## Switching models

`OPENROUTER_MODEL` in `.env` accepts any image model slug OpenRouter lists — `openai/gpt-image-2`, `black-forest-labs/flux.2-pro`, `google/gemini-3.1-flash-image`, and so on. Browse them: https://openrouter.ai/models?output_modalities=image

Each model exposes different parameters (resolution tiers, aspect ratios, whether `quality` applies). The output node's controls map to the common ones; check a model's page if a parameter seems ignored.

## Extensions left out on purpose

These are the obvious next steps if you want to grow it, each small:

- **Read references from a watched local folder** instead of the browser picker: add a `GET /api/references?dir=` endpoint that reads files and base64-encodes them, then a node that lists them.
- **Streaming previews**: the Image API supports SSE (`stream: true`) and emits partial images. Swap the server's `fetch` for a streaming read and forward chunks to the client.
- **Package as a desktop app**: wrap the client in Tauri or Electron for a double-clickable app with native file access (and drop the separate dev server).

## Notes

- Your key lives server-side. If you set it in `.env` the browser never sees it at all; if you paste it into the dialog it is POSTed once to the local server over loopback and never stored in the browser or sent back to it — the app only ever receives the last 4 characters, to show you which key is in use.
- OpenRouter bills per completed image (a failed generation isn't charged), so each output-node run maps to one billable image.
- Verify current per-image pricing on the model's OpenRouter page before running large batches.
