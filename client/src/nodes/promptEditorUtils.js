import { isReferenceable, TOKEN_RE } from '../graph/resolve.js';

export { TOKEN_RE };
export const TRIGGER_RE = /@([\w-]*)$/;

// Parse a prompt string containing @id tokens into an array of text and mention
// segments. Known referenceable nodes become mention segments with their live label
// (character name if set, or @id); unknown tokens (e.g. @golden, emails) remain
// plain text.
export function parsePromptSegments(text, nodes = []) {
  if (!text) return [];

  const nodeMap = new Map();
  for (const n of nodes) {
    if (isReferenceable(n)) {
      nodeMap.set(n.id, n);
    }
  }

  const segments = [];
  let lastIndex = 0;
  const str = String(text);

  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(str)) !== null) {
    const [fullMatch, refId] = match;
    const matchStart = match.index;

    if (nodeMap.has(refId)) {
      if (matchStart > lastIndex) {
        segments.push({
          type: 'text',
          value: str.slice(lastIndex, matchStart),
        });
      }

      const node = nodeMap.get(refId);
      const name = (node.data?.name || '').replace(/\s+/g, ' ').trim();
      segments.push({
        type: 'mention',
        id: node.id,
        nodeType: node.type,
        label: name || `@${node.id}`,
        name,
      });

      lastIndex = matchStart + fullMatch.length;
    }
  }

  if (lastIndex < str.length) {
    segments.push({
      type: 'text',
      value: str.slice(lastIndex),
    });
  }

  return segments;
}

// Filter and format candidate nodes for the @ autocomplete menu.
// Matches against node id or character/node name.
export function filterCandidates(nodes = [], currentId, query) {
  if (query == null) return [];
  const lower = query.toLowerCase();

  return nodes
    .filter((n) => isReferenceable(n) && n.id !== currentId)
    .filter((n) => {
      if (!lower) return true;
      if (n.id.toLowerCase().includes(lower)) return true;
      const name = (n.data?.name || '').toLowerCase();
      return name.includes(lower);
    })
    .map((n) => {
      const name = (n.data?.name || '').replace(/\s+/g, ' ').trim();
      return {
        id: n.id,
        type: n.type,
        label: name || `@${n.id}`,
        hasName: Boolean(name),
        hint: (n.data?.result || n.data?.text || '').replace(/\s+/g, ' ').slice(0, 32),
      };
    });
}

// Match an active @query right before the caret.
export function getTriggerMatch(textBeforeCaret) {
  if (textBeforeCaret == null) return null;
  const match = TRIGGER_RE.exec(textBeforeCaret);
  if (!match) return null;
  return {
    query: match[1],
    matchLength: match[0].length,
  };
}

// Convert contenteditable DOM nodes into the canonical @id prompt text.
export function serializeDomToText(rootEl) {
  if (!rootEl) return '';

  function walk(node) {
    if (node.nodeType === 3) { // Node.TEXT_NODE
      return node.textContent.replace(/\u200B/g, '');
    }
    if (node.nodeType === 1) { // Node.ELEMENT_NODE
      if (node.dataset?.mentionId) {
        return `@${node.dataset.mentionId}`;
      }
      if (node.tagName === 'BR') {
        return '\n';
      }
      let result = '';
      for (const child of node.childNodes) {
        result += walk(child);
      }
      // Browser-generated block containers (<div>, <p>) on newline
      if (
        (node.tagName === 'DIV' || node.tagName === 'P') &&
        node !== rootEl &&
        node.previousSibling
      ) {
        return '\n' + result;
      }
      return result;
    }
    return '';
  }

  return walk(rootEl);
}
