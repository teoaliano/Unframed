// Prose to JSON: an instruction prompt and a text node that turns whatever you
// wire in into a structured spec. Two nodes rather than a canned schema, because
// the useful field set depends on the subject — a character needs build and
// outfit, a UI component needs radius and elevation, and guessing either in
// advance produces a form nobody wants to fill in.
//
// The text node's result is @id-referenceable like any other, so one spec can
// feed several output nodes: generate from it, edit one field, generate again.
//
// The instruction is written to be order-agnostic. Prompt parts are joined by
// canvas Y position, so whether the user's prose lands above or below this node
// is theirs to decide, and "the prose accompanying this instruction" reads
// correctly either way — "the text below" would be a coin flip.
export default {
  id: 'to-json',
  name: 'Prose to JSON',
  type: 'flow',
  kind: 'text',
  summary: 'Turn a written prompt into a structured JSON spec you can reuse',
  needs: 'Wire your own prompt node in, then Run',
  fragment: {
    nodes: [
      {
        id: 'rules',
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: {
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
      {
        id: 'convert',
        type: 'text',
        position: { x: 380, y: 0 },
        data: { text: '', result: '' },
      },
    ],
    edges: [{ id: 'e-rules', source: 'rules', target: 'convert' }],
  },
};
