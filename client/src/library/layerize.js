// Layerize: split an image into its parts, one generation per part. Four nodes
// and four edges, nothing bespoke — the whole flow is ordinary wiring over the
// Free-runs machinery. The image node ships empty but already wired into both
// outputs — the planner has to see the picture, and each layer generation has to
// match its style — so the only setup left is putting a picture in it.
export default {
  id: 'layerize',
  name: 'Layerize',
  type: 'flow',
  kind: 'image',
  summary: 'Split an image into its parts as separate generations',
  needs: 'Drop your picture into the image node, then Run the planner',
  fragment: {
    nodes: [
      {
        id: 'plan',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: {
          // Leads with "writing prompts, plain prose" and bans coordinates before
          // anything else: asked bare, "identify every distinct visual part" of a
          // busy image trips Gemini's object-detection mode, which answers with
          // box_2d bounding boxes instead of sections. Reproduced on flash-lite
          // with a UI screenshot; this wording returned ten prose sections from
          // the same image.
          // Each section opens "From image 1, recreate": the source image rides
          // along with every layer generation (it is wired into the output node
          // too), and a section written as a from-scratch scene description left
          // the model treating that reference as loose inspiration. Naming the
          // part as a piece of image 1 anchors the run to extraction.
          text:
            'You are writing prompts for an image generator, in plain prose only: ' +
            'no JSON, no coordinates, no bounding boxes, no code blocks. The ' +
            'generator will be given image 1 alongside each prompt, so write ' +
            'prompts that recreate parts of image 1 rather than describe scenes ' +
            'from scratch. Look at image 1 and identify every distinct visual ' +
            'part of it. For each part, write one section, separated by a line ' +
            'containing only ---. Start each section with "From image 1, ' +
            'recreate" and name the part, then instruct the generator to ' +
            'reproduce it exactly as it appears there: alone, nothing else in ' +
            'the frame, on a plain flat background, in the same aspect ratio as ' +
            'the source, keeping its original style, colours and text. No ' +
            'preamble, no numbering.',
        },
      },
      {
        id: 'planner',
        type: 'textOutput',
        position: { x: 380, y: 0 },
        data: { text: '', result: '' },
      },
      {
        // Left on the app's default model deliberately. Layerize exists to get the
        // closest possible match to the source, so the strongest image model wins
        // over a weaker one that happens to emit alpha: the point of a layer is
        // fidelity, and transparency is a packaging problem to solve separately.
        // (Measured: passing a finished layer through a cheaper alpha-capable
        // model to "just remove the background" re-rendered it — 1448x1086 came
        // back 1536x1024 — so a second pass buys alpha by throwing away the
        // fidelity the first pass paid for.)
        id: 'out',
        type: 'imageOutput',
        position: { x: 760, y: 0 },
        data: { freeRuns: true, runs: 1 },
      },
      {
        id: 'ref',
        type: 'image',
        position: { x: 0, y: 320 },
        data: { fileName: '', dataUrl: '' },
      },
    ],
    edges: [
      { id: 'e-plan', source: 'plan', target: 'planner' },
      { id: 'e-out', source: 'planner', target: 'out' },
      { id: 'e-ref-planner', source: 'ref', target: 'planner' },
      { id: 'e-ref-out', source: 'ref', target: 'out' },
    ],
  },
};
