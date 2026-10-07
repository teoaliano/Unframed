# Node parameters: how node tools let you tweak a model's settings

Research for issue #103 ("Nodes"). Gathered 2026-10-07 from official docs, source code and live public endpoints. No implementation.

## Question

Issue #103 asks to "restore support for nodes & perhaps add nodes with dials that can be tweaked. Parameters can be generated as usual". The idea on the table: a card on the canvas that holds a prompt, a model and its settings, shows the settings as dials you can tweak, has a Generate button, and is connected to its inputs with wires.

Before deciding how the parameters are exposed, this note answers:

1. How does ComfyUI expose and drive a node's parameters?
2. How do the other node canvases for AI media do it (Figma Weave, Krea, Flora, fal, Runway, Freepik, tldraw's own kits)?
3. Where can a model's parameters be read automatically, and what does OpenRouter give for image and video models today?
4. What shapes could this take in Unframed, and which settled spec decisions would each one reverse?

## Short answer

- **Two places for parameters.** Almost every tool draws prompt and media inputs on the node and puts the model's settings either inline (ComfyUI, Invoke, tldraw's starter kits) or in a side panel or inspector (Weave, Runway, Freepik, Krea). Freepik spells out a two-tier rule: a few settings on the card, the rest (seed, guidance, negative prompt) in the inspector.
- **Wiring a parameter is rare outside the technical tools.** ComfyUI, Invoke, fal and tldraw's workflow kit let a wire drive any setting: the field has its own socket, and connecting a wire disables the field and shows the incoming value. Weave does it through "promote this setting to a Number, Seed or Toggle node". Runway, Freepik, Flora and Krea only wire prompts and media.
- **Sweeps are mostly lists of prompts, not parameter grids.** Most tools fan one node out over a list of prompts or files (often from CSV). True parameter sweeps exist only in Invoke (cartesian batches) and in ComfyUI custom nodes (XY plot). ComfyUI's seed "control after generate" is the light version.
- **Model settings come from a schema, then get curated.** Tools built on fal or Replicate read each model's JSON Schema and then hide, rename and retype fields (Weave shows 6 of fal's 12 fields for one model). Smaller tools hand-pick a few settings per model. ComfyUI hand-writes its partner nodes, including an OpenRouter node.
- **OpenRouter already gives Unframed typed settings for image and video models**, and spec 03 already reads them: enums, integer ranges and on/off flags. It gives no defaults, labels, help text, order or step, and no continuous knobs like guidance or steps. So with OpenRouter today, most "dials" on an image node would be dropdowns; real sliders exist only for counts (outputs, reference cap, compression) and for video upscalers.
- **tldraw's own workflow kit is the closest prior art.** It models a node as one custom shape, a wire as its own custom `connection` shape with two bindings (not tldraw's arrow), and every numeric field as a row that is also an input port.

## What Unframed settles today

These are the decisions any form of nodes runs into. Quoted from the specs.

- `docs/specs/00-index.md`: "There are no wires and no output nodes: **the selection is the input set**."
- `docs/specs/02-canvas.md`, Out of Scope: "Wires, edges, handles and output nodes no longer exist. There is no image, video or text output node, no connection, no "Connect all" or "Disconnect all", no ignored-edge styling and no lassoing of connectors." The Problem Statement gives the reason: the old node graph "had to reinvent every drawing interaction, it had no drawing tools, and it kept a hand-written sync and undo layer".
- `docs/specs/03-image-generation.md`: settings live in the composer's props tray, one chip per setting, each a menu of the values the model declares. The props come from OpenRouter's typed `supported_parameters` map (`GET /api/v1/images/models`). Defaults (`resolution: '1K'`, `quality: 'low'`, `aspect_ratio: '1:1'`) are hand-picked in the spec. A dashed tether, drawn only while a result is selected, shows its sources "without a wire".
- `docs/specs/04-video-generation.md`: the video tray reads `GET /api/v1/videos/models` (`supported_durations`, `supported_resolutions` and so on). Red ignored-input edges were replaced by badges.
- `docs/specs/06-groups-recipes-library.md`: a recipe group is a frame that holds standing settings (medium, model, params, runs) and no text; its sources are its members. Out of Scope: "A dedicated character, product or template shape type". The Further Notes say the toolbar Generate on a recipe group "is the same one click the old output node's Generate button was".
- `docs/specs/09-artifacts.md`: dials are DialKit controls declared by an artifact in a shorthand the agent writes (number, boolean, colour, text, `[value, min, max, step]`, list of strings, folder). DialKit "load[s] only with the editor". Contract 9 in the index keeps the canvas thread free of anything that would slow panning.
- `docs/specs/11-legacy-import.md`: every old output node becomes a recipe group, and every wire disappears.

So the codebase already has the two halves the issue asks for: settings derived from the model catalogue (spec 03 and 04 trays) and a dial panel (spec 09). What it lacks is a card that shows them together on the canvas, and wires.

## Findings

### 1. ComfyUI

Current releases: core v0.39.0 and frontend v1.57.0, both 2026-10-05. The repo moved to `Comfy-Org/ComfyUI`.

**Widgets.** A node declares typed inputs with `default`, `min`, `max`, `step`, `round`, `multiline`, `tooltip` and more ([node_typing.py](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/comfy_types/node_typing.py)). The frontend draws INT and FLOAT as `slider`, `number`, `knob` or `gradientslider` (gradient slider added 2026-02-20), COMBO as a dropdown, STRING as a field or multiline box, BOOLEAN as a toggle ([nodeDefSchema.ts](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/packages/object-info-parser/src/schemas/nodeDefSchema.ts)). Any input can be flagged `advanced`, which puts it in a collapsible "Advanced Inputs" section (added 2026-01-20; core marked 429 widgets advanced on 2026-02-19).

**Seeds.** An INT named `seed` or `noise_seed` gets a companion "control after generate" widget: `fixed`, `increment`, `decrement` or `randomize` (default `randomize`). The control is never sent with the prompt; it only changes the seed between runs ([widgets.ts](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/scripts/widgets.ts), [useIntWidget.ts](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/renderer/extensions/vueNodes/widgets/composables/useIntWidget.ts)). KSampler is the textbook example: `seed`, `steps` 1 to 10000, `cfg` 0 to 100 step 0.1, `denoise` 0 to 1 ([nodes.py](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py)).

**From definition to widget.** A node's Python class declares its inputs (`INPUT_TYPES`, or the newer V3 `io.Schema` with `io.Int.Input(...)` and friends). The server publishes every node's definition at `/object_info`, and the frontend builds widgets from it ([server overview](https://docs.comfy.org/custom-nodes/backend/server_overview), [V3 migration](https://docs.comfy.org/custom-nodes/v3_migration)). V3 adds `DynamicCombo`, where picking a value in a dropdown swaps in a different set of inputs (public since 2025-12-30) ([_io.py](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api/latest/_io.py)).

**Model parameters are hand-written.** Comfy's partner nodes (Flux, Kling, Veo, OpenAI and others) declare their widgets by hand in `comfy_api_nodes/nodes_*.py`; only one file of request models carries a "generated by datamodel-codegen" header ([comfy_api_nodes](https://github.com/Comfy-Org/ComfyUI/tree/master/comfy_api_nodes)). Since May 2026 the pattern is one node per provider family with a model dropdown (`DynamicCombo`) that carries each model's input list, plus a live price badge computed from the widget values. There is an OpenRouter partner node (added 2026-05-21) that uses a hand-curated table of models and limits ([nodes_openrouter.py](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api_nodes/nodes_openrouter.py)). Comfy's new Router API (2026-09-23) publishes a JSON Schema per model, yet the comfy.org website still layers a curated allowlist on top: labels, Standard or Advanced placement, defaults, blank optional seeds ([MODELS_INPUT_SCHEMA.md](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/apps/website/MODELS_INPUT_SCHEMA.md)).

**A wire can drive any widget.** Since frontend v1.16.0 (2025-04-07) every widget has its own input socket; connecting a wire to it drives the value, so the old "convert widget to input" step is gone ([v1.16.0 release](https://github.com/Comfy-Org/ComfyUI_frontend/releases/tag/v1.16.0)). `forceInput` makes an input socket-only and `socketless` widget-only. Core primitive nodes (Int, Float, Text, Boolean, added 2025-03-21) output one value that can be wired to many inputs ([nodes_primitive.py](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_primitive.py)). Reroutes are now points on a wire rather than nodes.

**Subgraphs expose chosen settings.** You select nodes and collapse them into a subgraph (frontend 1.24.3, announced 2025-08-07). Wiring an inner widget to the subgraph's input boundary shows a copy of it on the outer node, and a panel shows, hides and reorders those promoted widgets ([subgraph docs](https://docs.comfy.org/interface/features/subgraph), [subgraph JS docs](https://docs.comfy.org/custom-nodes/js/subgraphs)). The design changed twice; since 2026-05 a promoted widget is always a linked subgraph input whose value the outer node owns ([ADR 0009](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/SUBGRAPH-PROMOTION-0009-represent-promoted-widgets-as-linked-inputs.md)). Subgraphs can be published as reusable "blueprints". Legacy group nodes were removed on 2026-06-18 and convert to subgraphs on load.

**Re-running only what changed.** Each node's cache key is its type, its literal input values and the keys of everything upstream; a node re-runs only when that changes. A node can force a re-run (`IS_CHANGED` returning NaN, or `not_idempotent`) ([caching.py](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_execution/caching.py)). Since 2025-07-30 you can select one output node and run only its branch ([partial execution](https://docs.comfy.org/interface/features/partial-execution)).

**Batches and sweeps.** "Batch count" queues N separate runs, stepping seeds between them. Auto-queue modes re-run on every change or continuously ([queueSettingsStore.ts](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/stores/queueSettingsStore.ts)). A node that outputs a list makes the next node run once per item ([lists docs](https://docs.comfy.org/custom-nodes/backend/lists)). XY plots are not in core; they come from custom nodes such as [Efficiency Nodes](https://github.com/jags111/efficiency-nodes-comfyui) and [Inspire Pack](https://github.com/ltdrdata/ComfyUI-Inspire-Pack).

**Newer frontend features for tweaking.** A right-hand properties panel (first shipped 2025-12-03) with a Favorites tab (2026-01-14): you star single widgets from any node and edit them all in one list ([PR #7812](https://github.com/Comfy-Org/ComfyUI_frontend/pull/7812)). App Mode (launched 2026-03-10) turns a graph into a simple form with chosen inputs and a Run button ([App Mode docs](https://docs.comfy.org/interface/app-mode.md)). I found no saved-preset feature for widget values; node templates and favorites are the closest.

### 2. Other node canvases

| Tool | Where settings show | Can a wire drive a setting? | Sweeps, presets | Where per-model settings come from | Running |
| --- | --- | --- | --- | --- | --- |
| **Figma Weave** (was Weavy, bought Oct 2025) | Inputs as coloured handles on the node; settings in a right-side panel when the node is selected ([Understanding Nodes](https://help.weavy.ai/en/articles/12292386-understanding-nodes)) | Yes, by "Set as Output" on a setting, which makes a Number, Seed or Toggle node ([Datatypes](https://help.weavy.ai/en/articles/12268346-datatypes)). Prompt variables add a text input per `@variable` ([Prompt variables](https://help.weavy.ai/en/articles/14047674-prompt-variables)) | Iterators run a model over a list or CSV column ([Iterators](https://help.weavy.ai/en/articles/12343281-iterators)); "Tools" publish a workflow as a form with locked fields ([Tools](https://help.weavy.ai/en/articles/12267755-tools)); no seed or range sweep found | From fal and Replicate schemas, then curated. Paste a fal or Replicate URL and "all of the parameters ... appear" ([Importing models](https://help.weavy.ai/en/articles/12265334-importing-models)). Weave's model contract (read through its MCP tool) splits `inputs` (handles), `params` (panel) and `outputs`; params are typed `seed`, `number`, `integer`, `enum`, `boolean` with title, order, default, min, max | Run button per node, costs credits |
| **Krea Nodes** | Inputs on the left (wire or fill in), "Parameters: settings within the node itself" ([docs](https://www.krea.ai/docs/user-guide/features/nodes)) | Not documented; no number or seed node | Line Splitter batches prompts; App Builder exposes chosen settings as text, number, dropdown, slider or toggle, with an "Advanced" toggle advised | "predefined options from model parameters"; source unverified | Dependency-aware cache: "Change one parameter and watch only affected nodes rerun" |
| **Flora** | On the node, with a hover toolbar ([Node overview](https://docs.flora.ai/nodes/editor.md)) | Text output into a prompt only ([Text to Image](https://docs.flora.ai/nodes/image-node/text-to-image.md)) | Batch Node: a for-each over up to 100 items or CSV ([Batch Node](https://docs.flora.ai/nodes/batch-node.md)); Techniques are reusable subgraphs whose input values act as presets ([Technique Builder](https://docs.flora.ai/nodes/technique-builder.md)) | Hand-picked, small (Nano Banana Pro: prompt, aspect ratio, resolution, image) ([model page](https://docs.flora.ai/models/image-models/nano-banana-pro-by-google.md)) | Enter runs the selected nodes |
| **fal Workflows** | A JSON graph; each node names a fal endpoint and its `input` ([Custom Workflow UI](https://fal.ai/docs/examples/integrations/custom-workflow-ui.md)); the visual editor needs a login | Yes, any field can be a reference such as `"$node_1.images.0.url"` | None beyond a model's own `num_images` | Fully from each endpoint's OpenAPI schema; a saved workflow stores `schema.input` ([Create workflow](https://fal.ai/docs/platform-apis/v1/workflows/create.md)) | One call runs the graph and streams per-node events ([Workflow endpoints](https://fal.ai/docs/documentation/model-apis/workflows.md)) |
| **Runway Workflows** (2025-10) | Per-node "Settings" menu (aspect ratio, FPS, resolution, seed, temperature); multi-select edits shared settings ([Intro](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)) | No; wires carry text, image, audio, video | Each node keeps a run history you can cycle, restore and favourite ([Building your first Workflows](https://help.runwayml.com/hc/en-us/articles/45769159004691-Building-your-first-Workflows)); Apps hide inputs ([Apps](https://help.runwayml.com/hc/en-us/articles/47865876793747)) | Looks hand-picked | Run one node or Run all; "Lock node" freezes an output so re-runs skip it |
| **Freepik Spaces** | Two tiers: on the card, prompt, model, aspect ratio, resolution, number of generations (1 to 10); in the inspector, seed, negative prompt, guidance and model extras ([Image nodes](https://www.freepik.com/ai/docs/image-nodes)) | No; only prompt and reference ports. Prompts take `@mentions` of other nodes | List node feeds items; Variations node makes a grid along an axis such as angles or expressions ([Models and modes](https://www.freepik.com/ai/docs/image-models-and-modes)) | Looks hand-picked per model | Run Node, Run Workflow, Run Downstream ([Getting started](https://www.freepik.com/ai/docs/getting-started-with-spaces)) |
| **Invoke** (open source) | Inline on the node, built from the backend's OpenAPI schema (`parseSchema.ts`) | Yes; each field declares direct value, connection, or both (`fields.py`) | Batch nodes take the cartesian product of their lists, a true sweep, and show the run count ([PR #7553](https://github.com/invoke-ai/InvokeAI/pull/7553)) | From the schema | Per-node `use_cache` |
| **Visual Electric** | Shut down after Perplexity bought the team (2025-10); it was a free canvas, not a node graph | | | | |

### 3. tldraw: computer and the starter kits

**tldraw computer** (December 2024) connected text, image and audio components with arrows, each carrying a plain-language instruction, and ran them as a flow. I found no primary docs for its per-component controls (the Google case study page refused the fetch).

**Starter kits.** tldraw ships Workflow and Image Pipeline kits ([overview](https://tldraw.dev/starter-kits/overview), [templates folder](https://github.com/tldraw/tldraw/tree/main/templates); created with `npm create tldraw@latest -- --template workflow`). Unframed is on tldraw 5.4.2, so these are the most direct prior art. Read from the source; I checked the `NodeInputRow` comment and the connection files myself:

- **Nodes** are one custom shape type, `node`, whose props hold a union of node types. Each type implements `getPorts`, `execute`, `getOutputInfo`, `onPortConnect` and a React component (`templates/workflow/src/nodes/types/shared.tsx`, `NodeShapeUtil.tsx`).
- **Ports** are not records; `getPorts()` computes them from the node's state. The image pipeline types them (`image`, `text`, `model`, `number`, `latent`, `any`) in `src/ports/portCompatibility.ts`.
- **Wires** are a separate custom shape, `connection`, drawn as a curve, attached at each end by a `connection` binding that names a port (`src/connection/ConnectionShapeUtil.tsx`, `ConnectionBindingUtil.tsx`). They are not tldraw arrows. Deleting a node deletes its wires.
- **Settings** are inline React controls inside the shape. `NodeInputRow` is the key pattern: "A row in a node for a numeric input. If the port is connected, the input is disabled and the value is taken from the port." The same widget-plus-socket idea as ComfyUI.
- **Running.** Values propagate live through a computed cache, and an `isOutOfDate` flag spreads downstream. A box drawn around each connected group has a Play button (`WorkflowRegions.tsx`); the executor walks downstream and runs each node once its inputs are ready (`ExecutionGraph.tsx`). Results persist on the shape; there is no content-hash cache.
- **Image Pipeline** (the AI version; its README calls it "similar to ComfyUI"): `GenerateNode.tsx` has ports for model, prompt, negative prompt and image, plus inline steps and CFG sliders and a seed field that are not ports. The model node is a hand-written dropdown and the worker maps choices to Replicate inputs by hand. "Play from here" runs a node and everything downstream, reusing upstream results.

### 4. Where a model's settings can be read automatically

| Source | What it gives | Fetch |
| --- | --- | --- |
| OpenRouter `GET /api/v1/models` | Names only (`supported_parameters` is a list of strings); chat-style names even for image and video models; `default_parameters` nearly always empty; one typed field, `reasoning.supported_efforts`. Defaults to text models unless `?output_modalities=image` or `video` ([reference](https://openrouter.ai/docs/api/api-reference/models/get-models.md)) | No key |
| OpenRouter `GET /api/v1/images/models` (59 models) and `/images/models/{id}/endpoints` | Typed map: `enum` (values), `range` (min, max), `boolean` (present means supported). Model-level map is the union over providers; the endpoint map is exact ([image generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation.md)). No defaults, labels, descriptions or order | No key |
| OpenRouter `GET /api/v1/videos/models` (30 models) | Fixed fields: `supported_durations`, `supported_resolutions`, `supported_aspect_ratios`, `supported_sizes`, `supported_frame_images`, `generate_audio`, `seed`, `upscale_factor`, `creativity`, `pricing_skus`, plus `allowed_passthrough_parameters` (names only) ([video generation guide](https://openrouter.ai/docs/guides/overview/multimodal/video-generation.md), [VideoModel schema](https://openrouter.ai/docs/api/api-reference/video-generation/list-all-video-generation-models.md)) | No key |
| fal per-endpoint OpenAPI, and `GET https://api.fal.ai/v1/models?expand=openapi-3.0` | Full JSON Schema: types, enums, min, max, defaults, descriptions, field order (`x-fal-order-properties`). No widget hints beyond order ([models API](https://fal.ai/docs/platform-apis/v1/models.md)) | No key |
| Replicate `GET /v1/models/{owner}/{name}`, `latest_version.openapi_schema` | Full JSON Schema with `x-order`; enums behind `$ref`. Generated from Cog's `Input(ge, le, choices, ...)`. Replicate's own site renders its run form from it ([HTTP docs](https://replicate.com/docs/reference/http.md), [Cog python.md](https://github.com/replicate/cog/blob/main/docs/python.md)) | Token needed |
| Hugging Face task specs | One schema per task, not per model | No key |

**OpenRouter image settings seen across all 59 models today** (live, 2026-10-07):

| Setting | Kind | Models declaring it |
| --- | --- | --- |
| `aspect_ratio` | enum | 56 |
| `input_references` | range (cap 0 to 20) | 57 |
| `n` | range | 55 |
| `resolution` | enum (`1K`, `2K`, `4K`, sometimes `512`, `768`, `1.5K`) | 23 |
| `output_format` | enum | 14 |
| `seed` | boolean | 14 |
| `background` | enum | 10 |
| `quality` | enum | 9 |
| `output_compression` | range 0 to 100 | 8 |
| `size` | boolean | 3 |

A real entry (`black-forest-labs/flux.2-pro`):

```json
"aspect_ratio": {"type": "enum", "values": ["1:1","4:3","3:4","3:2","2:3","16:9","9:16","21:9","auto"]},
"output_format": {"type": "enum", "values": ["png","jpeg"]},
"n": {"type": "range", "min": 1, "max": 1},
"input_references": {"type": "range", "min": 0, "max": 8},
"seed": {"type": "boolean"}
```

A real video entry (`google/veo-3.1`): `supported_durations: [4,6,8]`, `supported_resolutions: ["720p","1080p","4K"]`, `supported_aspect_ratios: ["16:9","9:16"]`, `supported_frame_images: ["first_frame","last_frame"]`, `generate_audio: true`, `seed: true`, passthrough names `negativePrompt`, `enhancePrompt` and others with no types.

**What a node UI would still have to write by hand on top of OpenRouter:** defaults (none are given), labels and help text, control order, which resolution and ratio pairs combine, a seed's range (only a flag), types and ranges for passthrough settings (names only), the video reference cap (not exposed), and handling for models whose map is empty or `null`. Spec 03 and 04 already hand-write the defaults and labels for the settings they read.

**The consequence for "dials".** Of OpenRouter's image settings, only `n`, `input_references` and `output_compression` are ranges, and `n` is the run count Unframed already calls Runs. Everything else is a pick-one list. Video adds a duration list, and upscalers add `upscale_factor` (a range) and `creativity`. The continuous knobs people associate with node tools (guidance, steps, denoise, LoRA strength) are not exposed through OpenRouter at all. A dial panel built from OpenRouter today is mostly dropdowns and toggles, with very few sliders.

## Options for Unframed

This section is recommendation, not finding. Three shapes, from least to most change. Each lists the settled decisions it reverses.

### Option A: Recipe groups grow a settings panel (no wires)

The existing recipe group shows its settings as live controls under its label instead of a chip: a model picker, one control per declared setting (enum as a select, range as a slider, boolean as a toggle), Runs, and Generate. Controls are drawn as compact chips while the group is not selected and expand when it is, so the canvas thread stays light. Edits write the recipe as one undo step. Inputs stay what they are: the group's members.

- Reverses: nothing settled. It changes spec 06's "Editing the tray never writes to the group; only Save as recipe and Update recipe do" if the panel writes directly.
- For: smallest change; reuses spec 03's model params module, the recipe schema and spec 06's toolbar run; legacy import already maps old output nodes to recipe groups.
- Against: no wires, so it does not give the person what they asked for. Inputs are "whatever sits in the box", which cannot share one picture between two recipes without copying it.

### Option B: A recipe node fed by wires (recommended starting point)

A new shape kind, `node`: a card holding a prompt, a model, its settings and Generate, much like the old output node. Inputs reach it through wires from prompts, images, videos, groups and text results. Settings render from the catalogue entry exactly as spec 03 and 04 derive them, as controls on the card (selected) or chips (not selected). The run is spec 03's run with the wired shapes as the selection, so composition, pricing, sidecars, placeholders and recipes do not change. Results land beside the node as ordinary shapes, as recipe runs do now.

Two ways to draw the wire:

- **B1, tldraw's arrow.** An arrow whose end is bound to a node counts as an input; every other arrow stays a mark. Cheap, and arrows already bind, bend and label. But a mark gains meaning only from where its end lands, which is easy to do by accident and hard to read, and arrows have no ports.
- **B2, a dedicated connection shape**, as tldraw's own Workflow kit does: a `connection` shape with two bindings that name a port. Clear meaning, typed ports (image, text, video), room for "this input is ignored" styling. More code, and it is the custom connector layer spec 02 was written to get rid of, now built on tldraw's binding system rather than by hand.

- Reverses: the index's "There are no wires and no output nodes: the selection is the input set" (the selection stays one input set, wires add a second); spec 02's Out of Scope line on wires, edges, handles and output nodes; spec 06's "A dedicated ... template shape type" out of scope; spec 04's replacement of red edges with badges, if wire styling comes back. Spec 11 could map old output nodes to nodes instead of recipe groups.
- For: what the issue asks for; one picture can feed several nodes; the card is a visible, repeatable setup; nearly all generation logic is reused.
- Against: two ways to say "these are the inputs" (select, or wire), which must agree on order and numbering (top-to-bottom order still decides image 1, 2, 3, or the port order does); overlaps with recipe groups, so the person must decide whether recipe groups stay.

### Option C: A full node graph with wireable settings

Option B plus everything ComfyUI and tldraw's workflow kit do: each setting row is also a port; value nodes (number, seed, list, text) drive settings through wires; nodes chain, so a text node's answer feeds an image node; "run from here" re-runs downstream and skips nodes whose inputs did not change; list nodes and sweeps fan one node out over values.

- Reverses: everything Option B reverses, plus spec 05's model of results as loose shapes (chained nodes need a node's last output as a port value), and spec 03's "nothing on the canvas holding settings between runs" more broadly.
- For: the most expressive; matches ComfyUI, Invoke and fal.
- Against: the most work and the largest test surface; with OpenRouter's settings mostly being lists, wireable settings buy little beyond seed and sweeps; skipping unchanged nodes is a real money question in a pay-per-run app (a paid run must never repeat silently, and must never be skipped when the person meant to pay for a new one).

### Pieces that fit any option

- **Settings from the catalogue, defaults by hand.** Map OpenRouter's types onto spec 09's dial shorthand: enum to a list of strings (select), range to `[value, min, max, 1]`, boolean to a switch. Keep spec 03's hand-written defaults and labels.
- **Two tiers.** On the card, model, ratio or size, resolution or duration, and Runs; behind "More", seed, format, background, compression. Freepik, Krea and ComfyUI's "advanced" flag all land here.
- **Seed control.** For models that declare `seed`, ComfyUI's fixed or randomize after each run is the cheapest way to make "Generate again" either repeat or vary.
- **Prompt dials.** If "parameters can be generated as usual" means the agent writes them, a prompt could declare its own dials (`{{style: [noir, pastel, ink]}}`) that the node shows as a select and substitutes before sending. This is Weave's prompt variables with dials. It also gives sweeps a natural form: run once per value, as one batch.
- **Sweeps as batches.** A sweep over one setting is a batch whose outputs differ in that setting. It fits spec 05's batch (shared `batchId`, one result per output) and Invoke's cartesian rule, and the button can state the run count and estimate before spending.
- **Performance.** DialKit loads only in the editor today. Many live control panels on the canvas would put work on the canvas thread (contract 9). Show chips when not selected and controls only on the selected node, or render controls with the kit's own components rather than DialKit.

## Open questions for the person

1. Wires: do you want them as tldraw arrows (B1) or as their own connection shape with ports (B2)?
2. Do recipe groups stay once nodes exist, or does a node replace the recipe group?
3. When a node is wired, does selecting other shapes still add them to its run, or do wires become the only input set for that node?
4. Should one node's output feed another node (chaining, Option C), or do results stay loose shapes you wire in by hand?
5. "Parameters can be generated as usual": does that mean the settings come from the model catalogue as the composer's tray does now, or that the agent writes dials for a node the way it does for pages and motions?
6. Given that OpenRouter exposes mostly lists and few ranges, are dropdowns and toggles acceptable as "dials", or is the point continuous knobs (which would need another provider such as fal, whose schemas carry guidance and steps)?
7. Should old projects import their output nodes as nodes again (spec 11 now makes recipe groups)?
