// Prose to JSON: one text node whose Instructions turn whatever you wire in into
// a structured spec. A block, not a flow — the instruction lives in the node's
// own Instructions field, which the text node appends after anything wired in,
// so no separate prompt node is needed.
//
// Derives the keys from the subject rather than shipping a canned schema: a
// character needs different fields than a UI component, and guessing either in
// advance produces a form nobody wants to fill in. The result is
// @id-referenceable like any text node, so one spec can feed several output
// nodes: generate, edit one field, generate again.
export default {
  id: 'to-json',
  name: 'Prose to JSON',
  type: 'block',
  kind: 'text',
  summary: 'Turn a written prompt into a structured JSON spec you can reuse',
  needs: 'Wire your prompt node in, then Run',
  fragment: {
    nodes: [
      {
        id: 'convert',
        type: 'text',
        position: { x: 0, y: 0 },
        data: {
          result: '',
          text:
            'Convert the prose image description accompanying this instruction into ' +
            'a single JSON object, and output nothing but that object: no prose, no ' +
            'code fences, no commentary.\n\n' +
            'Derive the keys from what the description actually specifies — a ' +
            'character needs different fields than a UI component or a product ' +
            'shot, so do not force a fixed template. Group related details into ' +
            'nested objects, and use arrays for lists such as colours.\n\n' +
            'Every detail stated in the prose must survive into a field. Do not ' +
            'invent details that were not stated: leave a key out rather than ' +
            'filling it with a guess. Keep the wording of specifics (exact ' +
            'colours, names, text content) verbatim.\n\n' +
            'Do not add fields for things the generator cannot honour: no negative ' +
            'or "avoid" key, since no image model here supports negative prompting, ' +
            'and no resolution, aspect ratio or quality keys, which are controls on ' +
            'the output node rather than part of the prompt.',
        },
      },
    ],
    edges: [],
  },
};
