import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Icon } from '@astryxdesign/core/Icon';
import { Check, Copy } from 'lucide-react';

// The agent writes markdown, so the panel renders markdown. The renderer and its typography
// follow t3code's chat (`apps/web/src/components/ChatMarkdown.tsx` and the `.chat-markdown`
// rules in `apps/web/src/index.css`, MIT) -- the same library and plugins, and the same
// prose decisions: one block rhythm, headings that step down without shouting, inline code
// smaller than its sentence, a bordered scrollable code block, tables with row separators
// only. Their colours are their theme's; ours are Astryx tokens, so the values are
// translated and nothing here carries a hex.
//
// ONE DELIBERATE DIVERGENCE, and it is the important one: t3code pairs `rehype-raw` with
// `rehype-sanitize` and so renders raw HTML inside a message. We do not load either, which
// means HTML in a reply is shown as the text it is. This is the same rule that gives page
// assets their own origin (server/preview.js): HTML the model wrote must never execute
// where it would BE Unframed to the browser, and the agent panel is as same-origin as it
// gets. A sanitiser is a filter with a history of bypasses; not parsing the HTML at all has
// none. Without `rehype-raw` there are no raw nodes to sanitise, and react-markdown's own
// `urlTransform` already drops `javascript:` and friends from hrefs and image sources.
//
// Not adopted either: shiki syntax highlighting. It is most of t3code's markdown weight and
// the agent's replies here are prose about the canvas, not code listings. The copy button is
// theirs and is kept -- it is the one thing a code block in a chat is always wanted for.
const PLUGINS = [remarkGfm, remarkBreaks];

function CodeBlock({ children, ...props }) {
  const [copied, setCopied] = useState(false);
  // The fence's text, for the clipboard. react-markdown hands `pre` a `code` element whose
  // own children are the source, so this reads it off the element rather than re-serialising.
  const source = (() => {
    const code = Array.isArray(children) ? children[0] : children;
    const inner = code?.props?.children;
    return typeof inner === 'string' ? inner : Array.isArray(inner) ? inner.filter((c) => typeof c === 'string').join('') : '';
  })();
  return (
    <div className="chat-md-code">
      {source && (
        <button
          type="button"
          className="chat-md-copy"
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          onClick={() => {
            // A clipboard write can be refused (no permission, no secure context); the
            // button simply does not flip, which is the whole of the failure handling a
            // copy button needs.
            navigator.clipboard?.writeText(source).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              },
              () => {},
            );
          }}
        >
          <Icon icon={copied ? Check : Copy} size="sm" />
        </button>
      )}
      <pre {...props}>{children}</pre>
    </div>
  );
}

const COMPONENTS = {
  pre: CodeBlock,
  // Every link leaves the app, so every link says so. `noreferrer` as well as `noopener`
  // because a reply's links come from a model and may point anywhere.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // A table can be wider than a 380px panel, so it scrolls in its own box rather than
  // stretching the transcript -- the rule the rest of the app follows for wide content.
  table: ({ node: _node, ...props }) => (
    <div className="chat-md-table">
      <table {...props} />
    </div>
  ),
};

// `text` is the message. Rendered the same way whether it is a finished message or the
// draft still streaming, so formatting appears as it arrives instead of snapping in at
// the end.
export default function ChatMarkdown({ text }) {
  return (
    <div className="chat-md">
      <Markdown remarkPlugins={PLUGINS} components={COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}
