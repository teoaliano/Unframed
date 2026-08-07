// Layerize: split an image into its parts, one generation per part. Four nodes
// and four edges, nothing bespoke — the whole flow is ordinary wiring over the
// Free-runs machinery. The image node ships empty but already wired into both
// outputs — the planner has to see the picture, and each layer generation has to
// match its style — so the only setup left is putting a picture in it.
export default {
  id: 'layerize',
  name: 'Layerize',
  category: 'flows',
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
          text:
            'Look at image 1. Identify every distinct visual part of it. For each part, ' +
            'output one section separated by a line containing only ---. Each section ' +
            'describes that part alone, isolated on a plain neutral background, in the ' +
            'same aspect ratio as the source, matching its original style and colours. ' +
            'No preamble, no numbering.',
        },
      },
      {
        id: 'planner',
        type: 'text',
        position: { x: 380, y: 0 },
        data: { text: '', result: '' },
      },
      {
        id: 'out',
        type: 'output',
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
