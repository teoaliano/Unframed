# weave-lite

A tiny, local, node-based image generator. Wire prompt and reference-image nodes into an output node, hit **Generate**, and it calls **GPT Image 2 through OpenRouter** and writes the result to a folder on your machine. No hosting, pay-per-generation.

![nodes: prompt + reference -> output -> gpt-image-2 -> disk]

## What's inside

- **client/** — React + React Flow (`@xyflow/react`) canvas with three node types: `prompt`, `reference`, `output`.
- **server/** — a small Express server that holds your OpenRouter key, calls the Image API, and writes files to disk.
- **client/src/graph/resolve.js** — the only part with real logic: prompt-to-prompt reference substitution, cycle detection, and building the request. Worth reading first.

## Requirements

- **Node.js 18 or newer** (the server uses the built-in `fetch`).
- An **OpenRouter API key**: https://openrouter.ai/keys

## Setup

```bash
# 1. install everything (root + client + server)
npm run install:all

# 2. add your key
cp .env.example .env
#    then open .env and paste your OPENROUTER_API_KEY

# 3. run the server and the canvas together
npm run dev
```

Open **http://localhost:5173**. The server logs the exact output folder on startup. Generated images land in `./output/` next to a `.json` sidecar recording the prompt, params, and cost.

> On Windows, `cp` may not exist in your shell — just copy `.env.example` to `.env` manually.

## How the graph works

- **Prompt node** — free text. Embed another prompt node's text inline with `{{its-label}}`. Labels should be unique. Circular references (`A -> B -> A`) are caught and reported instead of looping forever.
- **Reference node** — an image handed to the model as image-to-image guidance (GPT Image 2 accepts several).
- **Output node** — collects everything wired into it, resolves the prompts top-to-bottom, sends the lot to OpenRouter, then shows the image plus the exact cost OpenRouter reports.

Only the output node consumes edges, so wiring is always "sources → output." Prompt composition happens through `{{label}}` tokens, not edges. The starter graph shows this: the `scene` prompt embeds the `subject` prompt.

## Switching models

`OPENROUTER_MODEL` in `.env` accepts any image model slug OpenRouter lists — `openai/gpt-image-2`, `black-forest-labs/flux.2-pro`, `google/gemini-3.1-flash-image`, and so on. Browse them: https://openrouter.ai/models?output_modalities=image

Each model exposes different parameters (resolution tiers, aspect ratios, whether `quality` applies). The output node's controls map to the common ones; check a model's page if a parameter seems ignored.

## Extensions left out on purpose

These are the obvious next steps if you want to grow it, each small:

- **Read references from a watched local folder** instead of the browser picker: add a `GET /api/references?dir=` endpoint that reads files and base64-encodes them, then a node that lists them.
- **Streaming previews**: the Image API supports SSE (`stream: true`) and emits partial images. Swap the server's `fetch` for a streaming read and forward chunks to the client.
- **Save / load a workflow**: the graph is just `{ nodes, edges }` JSON. Write it to a file and read it back on load.
- **Package as a desktop app**: wrap the client in Tauri or Electron for a double-clickable app with native file access (and drop the separate dev server).

## Notes

- Your key stays server-side; the browser never sees it.
- OpenRouter bills per completed image (a failed generation isn't charged), so each output-node run maps to one billable image.
- Verify current per-image pricing on the model's OpenRouter page before running large batches.
