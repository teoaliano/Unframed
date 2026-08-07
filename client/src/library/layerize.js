// Layerize: split an image into its parts, one generation per part. Three nodes
// and two edges, nothing bespoke — the whole flow is ordinary wiring over the
// Free-runs machinery. The user supplies the image node and wires it into both
// outputs themselves (`needs` says so): the planner has to see the picture, and
// each layer generation has to match its style. A preset cannot pre-wire a node
// that does not exist yet.
export default {
  id: 'layerize',
  name: 'Layerize',
  category: 'flows',
  summary: 'Split an image into its parts as separate generations',
  needs: 'One image node wired into both the text and output nodes',
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
    ],
    edges: [
      { id: 'e-plan', source: 'plan', target: 'planner' },
      { id: 'e-out', source: 'planner', target: 'out' },
    ],
  },
};
