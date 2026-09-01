import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  parsePromptSegments,
  filterCandidates,
  getTriggerMatch,
  serializeDomToText,
} from './promptEditorUtils.js';
import { NODE_ICONS } from './nodeIcons.jsx';
import { isReferenceable } from '../graph/resolve.js';

function getTagIconSvg(nodeType) {
  if (nodeType === 'character') {
    return `<svg class="mention-tag-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
  if (nodeType === 'textOutput') {
    return `<svg class="mention-tag-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>`;
  }
  return `<svg class="mention-tag-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/></svg>`;
}

function buildTagElement(segment) {
  const span = document.createElement('span');
  span.className = `mention-tag mention-tag--${segment.nodeType || 'node'} nodrag`;
  span.contentEditable = 'false';
  span.dataset.mentionId = segment.id;
  span.dataset.nodeType = segment.nodeType || 'node';
  span.setAttribute('tabindex', '-1');

  const iconWrapper = document.createElement('span');
  iconWrapper.className = 'mention-tag-icon-wrap';
  iconWrapper.innerHTML = getTagIconSvg(segment.nodeType);
  span.appendChild(iconWrapper);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'mention-tag-label';
  labelSpan.textContent = segment.label;
  span.appendChild(labelSpan);

  return span;
}

export default function PromptEditor({
  nodeId,
  value = '',
  nodes = [],
  onChange,
  placeholder = 'Describe the image. Reference a prompt, text output or character with @',
}) {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const lastSyncedTextRef = useRef(null);
  const savedRangeRef = useRef(null);
  const [portalTarget, setPortalTarget] = useState(null);

  const [query, setQuery] = useState(null);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (editorRef.current) {
      const target = editorRef.current.closest('.react-flow__node');
      setPortalTarget(target || editorRef.current.parentElement);
    }
  }, []);

  const candidates = useMemo(
    () => filterCandidates(nodes, nodeId, query),
    [nodes, nodeId, query],
  );

  // Populate contenteditable DOM from prompt text string
  function populateDom(text) {
    const el = editorRef.current;
    if (!el) return;

    el.innerHTML = '';
    if (!text) return;

    const segments = parsePromptSegments(text, nodes);
    for (const seg of segments) {
      if (seg.type === 'mention') {
        el.appendChild(buildTagElement(seg));
      } else if (seg.type === 'text') {
        el.appendChild(document.createTextNode(seg.value));
      }
    }
  }

  // Initial population and external value sync (e.g. project switch, undo/redo)
  useEffect(() => {
    if (value !== lastSyncedTextRef.current) {
      populateDom(value);
      lastSyncedTextRef.current = value;
    }
  }, [value]);

  // Live label update: when character names or node names change elsewhere on the canvas,
  // update the text of existing mention tags in-place without rebuilding DOM or dropping cursor.
  useEffect(() => {
    if (!editorRef.current) return;
    const tags = editorRef.current.querySelectorAll('.mention-tag');
    if (!tags.length) return;

    const nodeMap = new Map();
    for (const n of nodes) {
      if (isReferenceable(n)) {
        nodeMap.set(n.id, n);
      }
    }

    tags.forEach((tag) => {
      const id = tag.dataset.mentionId;
      const node = nodeMap.get(id);
      if (node) {
        const name = (node.data?.name || '').replace(/\s+/g, ' ').trim();
        const expectedLabel = name || `@${node.id}`;
        const labelEl = tag.querySelector('.mention-tag-label');
        if (labelEl && labelEl.textContent !== expectedLabel) {
          labelEl.textContent = expectedLabel;
        }
      }
    });
  }, [nodes]);

  function checkTrigger() {
    const selObj = window.getSelection();
    if (!selObj || !selObj.isCollapsed || !selObj.anchorNode) {
      setQuery(null);
      return;
    }

    if (selObj.anchorNode.nodeType === 3 && editorRef.current?.contains(selObj.anchorNode)) {
      const textBefore = selObj.anchorNode.textContent.slice(0, selObj.anchorOffset);
      const trigger = getTriggerMatch(textBefore);
      if (trigger) {
        setQuery(trigger.query);
        setSel(0);
        savedRangeRef.current = selObj.getRangeAt(0).cloneRange();
        return;
      }
    }

    setQuery(null);
  }

  function onInput() {
    if (!editorRef.current) return;
    const text = serializeDomToText(editorRef.current);
    lastSyncedTextRef.current = text;
    onChange(text);
    checkTrigger();
  }

  const insertMention = useCallback((candidate) => {
    const el = editorRef.current;
    if (!el) return;

    const selObj = window.getSelection();
    let range = savedRangeRef.current;

    if (!range || !el.contains(range.startContainer)) {
      if (selObj && selObj.rangeCount > 0 && el.contains(selObj.anchorNode)) {
        range = selObj.getRangeAt(0);
      }
    }

    if (range && range.startContainer.nodeType === 3) {
      const textNode = range.startContainer;
      const offset = range.startOffset;
      const text = textNode.textContent;
      const textBefore = text.slice(0, offset);
      const trigger = getTriggerMatch(textBefore);

      if (trigger) {
        const startPos = offset - trigger.matchLength;
        const beforeText = text.slice(0, startPos);
        const afterText = text.slice(offset);

        const tag = buildTagElement({
          id: candidate.id,
          nodeType: candidate.type,
          label: candidate.hasName ? candidate.label : `@${candidate.id}`,
        });

        const parent = textNode.parentNode;
        const afterNode = document.createTextNode(afterText.startsWith(' ') ? afterText : ' ' + afterText);

        textNode.textContent = beforeText;

        if (textNode.nextSibling) {
          parent.insertBefore(tag, textNode.nextSibling);
          parent.insertBefore(afterNode, tag.nextSibling);
        } else {
          parent.appendChild(tag);
          parent.appendChild(afterNode);
        }

        const newRange = document.createRange();
        newRange.setStart(afterNode, 1);
        newRange.setEnd(afterNode, 1);
        selObj.removeAllRanges();
        selObj.addRange(newRange);
      }
    }

    setQuery(null);
    savedRangeRef.current = null;
    const newText = serializeDomToText(el);
    lastSyncedTextRef.current = newText;
    onChange(newText);
    el.focus();
  }, [onChange]);

  function onKeyDown(e) {
    if (query != null && candidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => (s + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => (s - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(candidates[sel]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }

    // Atomic Backspace removal when positioned right after a mention tag
    if (e.key === 'Backspace') {
      const selObj = window.getSelection();
      if (selObj && selObj.isCollapsed && selObj.anchorNode) {
        if (selObj.anchorNode.nodeType === 3 && selObj.anchorOffset === 0) {
          const prev = selObj.anchorNode.previousSibling;
          if (prev && prev.classList?.contains('mention-tag')) {
            e.preventDefault();
            prev.remove();
            onInput();
            return;
          }
        }
      }
    }
  }

  function onCopy(e) {
    const selObj = window.getSelection();
    if (!selObj || selObj.isCollapsed) return;

    const range = selObj.getRangeAt(0);
    const container = document.createElement('div');
    container.appendChild(range.cloneContents());
    const serialized = serializeDomToText(container);

    if (serialized) {
      e.clipboardData.setData('text/plain', serialized);
      e.preventDefault();
    }
  }

  function onCut(e) {
    onCopy(e);
    const selObj = window.getSelection();
    if (selObj && !selObj.isCollapsed) {
      selObj.getRangeAt(0).deleteContents();
      onInput();
    }
  }

  function onPaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;

    const selObj = window.getSelection();
    if (!selObj || selObj.rangeCount === 0) return;

    const range = selObj.getRangeAt(0);
    range.deleteContents();

    const segments = parsePromptSegments(text, nodes);
    const fragment = document.createDocumentFragment();

    let lastNode = null;
    segments.forEach((seg) => {
      if (seg.type === 'mention') {
        const tag = buildTagElement(seg);
        fragment.appendChild(tag);
        lastNode = tag;
      } else if (seg.type === 'text') {
        const tn = document.createTextNode(seg.value);
        fragment.appendChild(tn);
        lastNode = tn;
      }
    });

    range.insertNode(fragment);

    if (lastNode) {
      range.setStartAfter(lastNode);
      range.setEndAfter(lastNode);
      selObj.removeAllRanges();
      selObj.addRange(range);
    }

    onInput();
  }

  function onBlur(e) {
    const related = e.relatedTarget;
    if (containerRef.current && containerRef.current.contains(related)) {
      return;
    }
    // Delay closing slightly so direct clicks on external menu items can process
    setTimeout(() => {
      if (document.activeElement !== editorRef.current) {
        setQuery(null);
      }
    }, 150);
  }

  const menuJsx =
    query != null && candidates.length > 0 && portalTarget ? (
      createPortal(
        <ul
          className="mention-menu nodrag nowheel nopan"
          onMouseDown={(e) => {
            // Stops mousedown on dropdown or scrollbar from stealing focus / blurring editor
            e.preventDefault();
          }}
        >
          {candidates.map((c, i) => {
            const IconComp = NODE_ICONS[c.type] || NODE_ICONS.prompt;
            return (
              <li
                key={c.id}
                className={`mention-item ${i === sel ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  insertMention(c);
                }}
                onMouseEnter={() => setSel(i)}
              >
                <span className="mention-icon">
                  <IconComp size={14} />
                </span>
                <span className="mention-label">
                  {c.hasName ? c.label : `@${c.id}`}
                </span>
                <span className="mention-hint">
                  {c.hasName ? `@${c.id}` : c.hint}
                </span>
              </li>
            );
          })}
        </ul>,
        portalTarget,
      )
    ) : null;

  return (
    <div className="prompt-editor-container" ref={containerRef}>
      <div
        ref={editorRef}
        className="prompt-editor nodrag nowheel nopan"
        contentEditable="true"
        role="textbox"
        aria-multiline="true"
        spellCheck="false"
        data-placeholder={placeholder}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onKeyUp={checkTrigger}
        onClick={checkTrigger}
        onBlur={onBlur}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      />
      {menuJsx}
    </div>
  );
}
