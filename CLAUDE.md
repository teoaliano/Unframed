# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Unframed: a local, node-based image generator. A React Flow canvas lets you wire `prompt` and `reference` nodes into an `output` node; clicking Generate calls an image model (GPT Image 2 by default) through OpenRouter and writes the result plus a `.json` sidecar to disk. No hosting, pay-per-generation.

## Commands

```bash
npm run install:all   # installs root + server + client (each has its own package.json)
npm run dev           # runs server (8787) and client (5173) together via concurrently
npm run server        # server only (node --watch)
npm run client        # client only (vite)
```

Requires Node 18+ (server relies on built-in `fetch`). No lint or test setup exists.

Config lives in `.env` at the project root (copy from `.env.example`): `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OUTPUT_DIR`, `PORT`. The server prints the resolved model, key status, and output dir on startup. The client dev server proxies `/api` → `http://localhost:8787` (see `client/vite.config.js`), so both must be running.

## Architecture

Three-package monorepo, no shared build. The only non-trivial logic is in `client/src/graph/resolve.js` — read it first.

**Data flow:** `OutputNode.onGenerate` → `buildRequest(nodes, edges, outputId)` (pure, in `resolve.js`) → `POST /api/generate` (via `client/src/api.js`) → server's single `/api/generate` handler → OpenRouter `POST /api/v1/images` → image written to disk + returned as a data URL to the browser.

**Key design decisions:**
- **Only the output node consumes edges.** Wiring is always "sources → output." Prompt-to-prompt composition happens through `@id` tokens in prompt text, *not* edges. `resolveText` in `resolve.js` recursively substitutes `@id` references (`TOKEN_RE = /@([\w-]+)/g`) and throws on cycles; unknown ids resolve to empty string.
- **Source ordering is by node Y position** (top-to-bottom), so canvas layout determines prompt concatenation order. Prompt parts are joined with `\n\n`; reference images become `input_references` (base64 data URLs).
- **The API key lives in the server process** — the client only talks to `/api`, and the only key material sent back is the last 4 chars (`keyHint` on `/api/health`). `POST /api/key` accepts a key typed in the UI, validates it against `/^sk-or-[\w.-]{8,200}$/` (rejecting whitespace and newlines, which would corrupt `.env` or inject a header), upserts the `OPENROUTER_API_KEY` line in `.env`, and reassigns the module-level `API_KEY` so no restart is needed. `DELETE /api/key` drops the line entirely (not blanks it, so a shell-provided value isn't shadowed by an empty string). `.env` is therefore generated, not a prerequisite.
- **Reference images are base64 data URLs** carried in `node.data.dataUrl`, which is why the server sets a 30mb JSON body limit.
- **Server is a single file** (`server/index.js`): health, models, key, the project CRUD routes, and `/api/generate` — plus extensive error branching around the OpenRouter call, and filename slugify. Each successful generation writes `<timestamp>-<slug>.<ext>` + a `.json` sidecar (prompt, params, cost) to `OUTPUT_DIR`.

**Node types** (`client/src/nodes/`): `PromptNode` (labeled free text), `ImageNode` (reference image picker), `OutputNode` (resolution/quality/ratio controls + Generate button and result display). Registered in `App.jsx`'s `nodeTypes`; `App.jsx` also holds the starter graph demonstrating the `@p-subject` embed.

## Switching models

`OPENROUTER_MODEL` accepts any image slug OpenRouter lists. Different models honor different params (resolution tiers, aspect ratios, whether `quality` applies); the output node exposes the common ones and the server only forwards params that are set (`quality: 'auto'` is treated as unset). A param that seems ignored is likely unsupported by the chosen model.
