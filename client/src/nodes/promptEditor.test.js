import assert from 'node:assert/strict';
import {
  parsePromptSegments,
  filterCandidates,
  getTriggerMatch,
  serializeDomToText,
  TOKEN_RE,
} from './promptEditorUtils.js';

// ---- parsePromptSegments ----
{
  const nodes = [
    { id: 'c1', type: 'character', data: { name: 'Elara', text: 'Elf rogue' } },
    { id: 'c2', type: 'character', data: { name: '', text: 'Dwarf warrior' } },
    { id: 'p1', type: 'prompt', data: { text: 'sunset lighting' } },
    { id: 't1', type: 'textOutput', data: { name: 'Scene Text', result: 'magic castle' } },
  ];

  // Empty or non-string input
  assert.deepEqual(parsePromptSegments('', nodes), []);
  assert.deepEqual(parsePromptSegments(null, nodes), []);

  // Plain text with no mentions
  assert.deepEqual(parsePromptSegments('A simple prompt text', nodes), [
    { type: 'text', value: 'A simple prompt text' },
  ]);

  // Mention of a character with a name
  const segs1 = parsePromptSegments('Portrait of @c1 in a forest', nodes);
  assert.deepEqual(segs1, [
    { type: 'text', value: 'Portrait of ' },
    { type: 'mention', id: 'c1', nodeType: 'character', label: 'Elara', name: 'Elara' },
    { type: 'text', value: ' in a forest' },
  ]);

  // Mention of an unnamed character falls back to @id as label
  const segs2 = parsePromptSegments('Portrait of @c2 standing', nodes);
  assert.deepEqual(segs2, [
    { type: 'text', value: 'Portrait of ' },
    { type: 'mention', id: 'c2', nodeType: 'character', label: '@c2', name: '' },
    { type: 'text', value: ' standing' },
  ]);

  // Multiple mentions: character, prompt, text output
  const segs3 = parsePromptSegments('@c1 with @p1 at @t1', nodes);
  assert.deepEqual(segs3, [
    { type: 'mention', id: 'c1', nodeType: 'character', label: 'Elara', name: 'Elara' },
    { type: 'text', value: ' with ' },
    { type: 'mention', id: 'p1', nodeType: 'prompt', label: '@p1', name: '' },
    { type: 'text', value: ' at ' },
    { type: 'mention', id: 't1', nodeType: 'textOutput', label: 'Scene Text', name: 'Scene Text' },
  ]);

  // Unrecognized @ references (or email, @handles) are preserved as plain text
  const segs4 = parsePromptSegments('Contact @alice at @unknown-id and @golden hour', nodes);
  assert.deepEqual(segs4, [
    { type: 'text', value: 'Contact @alice at @unknown-id and @golden hour' },
  ]);

  // Dynamic name updates: when character name changes in nodes, parsePromptSegments returns updated label
  const updatedNodes = [
    { id: 'c1', type: 'character', data: { name: 'Aria', text: 'Elf rogue' } },
  ];
  const segsUpdated = parsePromptSegments('Portrait of @c1', updatedNodes);
  assert.equal(segsUpdated[1].label, 'Aria', 'label updates when character name changes');
  assert.equal(segsUpdated[1].id, 'c1', 'underlying id reference is preserved');
}

// ---- filterCandidates ----
{
  const nodes = [
    { id: 'c1', type: 'character', data: { name: 'Elara Brightwood', text: 'Elf archer' } },
    { id: 'c2', type: 'character', data: { name: 'Gimli', text: 'Dwarf warrior' } },
    { id: 'p1', type: 'prompt', data: { text: 'cinematic lighting 35mm' } },
    { id: 't1', type: 'textOutput', data: { name: 'Story Outline', result: 'A grand adventure' } },
    { id: 'i1', type: 'image', data: { dataUrl: 'data:image/png;base64,AAA' } },
  ];

  // Null query -> empty list
  assert.deepEqual(filterCandidates(nodes, 'p1', null), []);

  // Empty query -> returns all referenceable nodes except current node (images excluded)
  const all = filterCandidates(nodes, 'p1', '');
  assert.equal(all.length, 3, 'excludes current node and non-referenceable image node');
  assert.deepEqual(all.map((c) => c.id), ['c1', 'c2', 't1']);

  // Match by character name (case insensitive)
  const matchName = filterCandidates(nodes, 'p1', 'elara');
  assert.equal(matchName.length, 1);
  assert.equal(matchName[0].id, 'c1');
  assert.equal(matchName[0].label, 'Elara Brightwood');
  assert.equal(matchName[0].hasName, true);

  // Match by ID
  const matchId = filterCandidates(nodes, 'p1', 't1');
  assert.equal(matchId.length, 1);
  assert.equal(matchId[0].id, 't1');
  assert.equal(matchId[0].label, 'Story Outline');

  // Excludes self
  const matchSelf = filterCandidates(nodes, 'c1', 'elara');
  assert.equal(matchSelf.length, 0, 'excludes self node');
}

// ---- getTriggerMatch ----
{
  assert.equal(getTriggerMatch(null), null);
  assert.equal(getTriggerMatch('hello world'), null);
  assert.deepEqual(getTriggerMatch('hello @'), { query: '', matchLength: 1 });
  assert.deepEqual(getTriggerMatch('hello @el'), { query: 'el', matchLength: 3 });
  assert.deepEqual(getTriggerMatch('hello @c-123'), { query: 'c-123', matchLength: 6 });
  assert.deepEqual(getTriggerMatch('@'), { query: '', matchLength: 1 });
  assert.deepEqual(getTriggerMatch('@Aria'), { query: 'Aria', matchLength: 5 });
}

console.log('promptEditor.test.js ok');
