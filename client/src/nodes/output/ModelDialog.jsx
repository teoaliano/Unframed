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
import { Token } from '@astryxdesign/core/Token';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Check } from 'lucide-react';

const TITLES = { image: 'Image models', video: 'Video models', text: 'Text models' };

// OpenRouter's own catalogue, filtered to the medium this dialog is showing.
// `output_modalities` is the site's real filter param — the same one
// .env.example already points at for image. Text also pins
// `input_modalities=image`, because the text catalogue here is vision-capable
// models only (see /api/models' filter); without it the link lands on 791
// models against the 245 listed here.
const BROWSE = {
  image: 'https://openrouter.ai/models?output_modalities=image',
  video: 'https://openrouter.ai/models?output_modalities=video',
  text: 'https://openrouter.ai/models?output_modalities=text&input_modalities=image',
};

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

// A hue per provider, assigned by position in this catalogue's own sorted
// provider list rather than hashed. Hashing clustered — cyan and orange landed
// six times each while blue and pink landed once — and gave two providers the
// same colour while others went unused. By index, the palette is spent evenly
// and every provider is unique as long as there are enough colours: image has
// 10 providers and video 9, so both are fully distinct. Text has 26 against a
// palette of 11, so colours do repeat there; nothing is lost when they do,
// because the colour groups rows for scanning and the label carries the fact.
// Red and yellow are in play here, unlike LibraryDialog's chip table, because
// this dialog shows no status colours for them to be confused with.
const PROVIDER_HUES = [
  'blue', 'orange', 'purple', 'green', 'pink', 'teal',
  'red', 'cyan', 'yellow', 'gray', 'default',
];

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
    // Sorted so a provider keeps its colour between renders and reloads; the
    // order only shifts if the catalogue itself gains or loses a provider.
    const hues = {};
    [...new Set(models.map(providerKey))].sort().forEach((key, i) => {
      hues[key] = PROVIDER_HUES[i % PROVIDER_HUES.length];
    });
    return models.map((m) => {
      const key = providerKey(m);
      return { ...m, provider: labels[key] || key, providerHue: hues[key], model: modelPart(m) };
    });
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
        <HStack gap={1} align="center">
          <Link onClick={() => { onPick(m.id); onClose(); }} weight={m.id === value ? 'bold' : 'medium'}>
            {m.model}
          </Link>
          {/* The bold weight alone did not read as "this is the one you are on"
              — a tick is the part people actually see. */}
          {m.id === value && <Icon icon={Check} size="sm" color="accent" label="Current model" />}
        </HStack>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      width: proportional(1),
      sortable: true,
      renderCell: (m) => <Token size="sm" color={m.providerHue} label={m.provider} />,
    },
    { key: 'created', header: 'Released', width: pixel(130), align: 'end', sortable: true, renderCell: released },
  ];

  return (
    // nodrag/nowheel: the dialog's DOM lives inside the node's subtree, so
    // these keep a drag or scroll inside it off the canvas.
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} width={680} className="nodrag nowheel">
      <DialogHeader
        title={TITLES[kind] || 'Models'}
        endContent={
          <Link href={BROWSE[kind]} isExternalLink size="sm" color="secondary">
            Browse on OpenRouter
          </Link>
        }
      />
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
