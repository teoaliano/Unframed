// The model picker's dialog. Viewport-centered, which is the point: Astryx's
// anchor-positioned popups can render at the viewport corner when the anchor
// fails to resolve (packaged app, Safari), and a centered Dialog is immune by
// construction. For the same reason NOTHING anchor-positioned goes inside it —
// search is a TextInput, and any future select in here is NativeSelect.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Table, proportional, pixel, useTableSortable, useTableSortableState } from '@astryxdesign/core/Table';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/Stack';

const TITLES = { image: 'Image models', video: 'Video models', text: 'Text models' };

// OpenRouter gives `created` as a Unix timestamp (seconds), on every model in
// all three catalogues. Rendered short because the column is for scanning
// "how new is this" rather than for exact dates.
const DATE = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const released = (m) => (m.created ? DATE.format(new Date(m.created * 1000)) : '');

// Slugs are "<provider>/<model>", sometimes with a leading ~ (OpenRouter's
// floating "-latest" aliases). The prefix is the provider's KEY; its pretty
// label comes from the display name, which is "Provider: Model" — but only for
// some models, so the label is looked up by key rather than parsed per row.
// Without that, ~anthropic/claude-haiku-latest (no colon in its name) would
// render "~anthropic" one row below "Anthropic".
const providerKey = (m) => m.id.split('/')[0].replace(/^~/, '');
const modelPart = (m) => (m.id.includes('/') ? m.id.slice(m.id.indexOf('/') + 1) : m.id);

export default function ModelDialog({ models, kind, value, onPick, onClose }) {
  const [query, setQuery] = useState('');

  // Escape is handled here, not by Dialog: Astryx's own Escape path does not
  // reach onOpenChange in this configuration, which let two dialogs sit open
  // at once. Capture phase so nothing in the canvas swallows it first.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Provider and model split onto the row itself, so Table's own comparators
  // sort the values it renders instead of the raw slug.
  const rows = useMemo(() => {
    const labels = {};
    for (const m of models) {
      const name = m.name || '';
      const key = providerKey(m);
      if (name.includes(':') && !labels[key]) labels[key] = name.split(':')[0].trim();
    }
    return models.map((m) => ({
      ...m,
      provider: labels[providerKey(m)] || providerKey(m),
      model: modelPart(m),
    }));
  }, [models]);

  // Matches the full slug and the display name: "openai/gpt-image-2" and
  // "OpenAI: GPT Image 2" are both plausible things to type, and neither is
  // shown whole now that the slug is split across two columns.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Newest first by default — the reason the column exists.
  const { sortedData, sortConfig } = useTableSortableState({
    data: shown,
    defaultSort: [{ sortKey: 'created', direction: 'descending' }],
    comparators: { created: (a, b) => (a.created || 0) - (b.created || 0) },
  });
  const sortPlugin = useTableSortable(sortConfig);

  const columns = [
    {
      key: 'model',
      header: 'Model',
      width: proportional(2),
      sortable: true,
      // The slug is the click target, not the row: LibraryDialog's rule is
      // that the action is a button, not the row. A Link with onClick and no
      // href renders a real <button> with link styling (useInteractiveRole),
      // so this needs no hand-written CSS and stays keyboard-reachable.
      renderCell: (m) => (
        <Link onClick={() => { onPick(m.id); onClose(); }} weight={m.id === value ? 'bold' : 'medium'}>
          {m.model}
        </Link>
      ),
    },
    { key: 'provider', header: 'Provider', width: proportional(1), sortable: true },
    { key: 'created', header: 'Released', width: pixel(130), align: 'end', sortable: true, renderCell: released },
  ];

  return (
    // nodrag/nowheel: the dialog's DOM lives inside the node's subtree, so
    // these keep a drag or scroll inside it off the canvas.
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} width={680} className="nodrag nowheel">
      <DialogHeader title={TITLES[kind] || 'Models'} />
      <VStack gap={3} padding={4}>
        <TextInput
          label="Search models"
          isLabelHidden
          size="sm"
          startIcon="search"
          placeholder="Search models…"
          value={query}
          onChange={setQuery}
        />

        {sortedData.length === 0 ? (
          <Text type="supporting" color="secondary">No model matches. Clear the search.</Text>
        ) : (
          <div className="model-dialog-list">
            <Table data={sortedData} columns={columns} idKey="id" hasHover plugins={{ sort: sortPlugin }} />
          </div>
        )}
      </VStack>
    </Dialog>
  );
}
