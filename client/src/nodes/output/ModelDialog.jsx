// The model picker's dialog. Viewport-centered, which is the point: Astryx's
// anchor-positioned popups can render at the viewport corner when the anchor
// fails to resolve (packaged app, Safari), and a centered Dialog is immune by
// construction. For the same reason NOTHING anchor-positioned goes inside it —
// pills are ToggleButtons, and any future select in here is NativeSelect. Same
// rule for Table's own plugins: only useTableSortable and Pagination, neither
// of which renders a popup.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { Pagination } from '@astryxdesign/core/Pagination';
import { Table, proportional, pixel, useTableSortable, useTableSortableState } from '@astryxdesign/core/Table';
import { Button } from '@astryxdesign/core/Button';
import { Token } from '@astryxdesign/core/Token';
import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { capabilityTags } from './core.js';
import { buildFacets, applyFacets, priceLabel, priceRate } from './facets.js';

const PAGE_SIZE = 10;
const TITLES = { image: 'Image models', video: 'Video models', text: 'Text models' };

// Cheapest-first, with "no listed price" sorted last in ascending order rather
// than first — a null reading as $0 would put every unpriced model at the top
// of "cheapest first", which is backwards.
//
// Video still mixes units after the facets.js fix — priceRate is the RAW
// per-second or per-token dollar figure (facets.js), and the token family's
// raw numbers (~0.000001) are orders of magnitude smaller than any per-second
// model's, so a token-priced model always sorts as "cheapest" here regardless
// of the "$X per M" figure actually printed on its row. Acceptable for a
// picker, where every row states its own unit, but this is not a cost
// comparison across the two families.
function priceComparator(kind) {
  return (a, b) => {
    const ra = priceRate(a, kind);
    const rb = priceRate(b, kind);
    if (ra == null && rb == null) return 0;
    if (ra == null) return 1;
    if (rb == null) return -1;
    return ra - rb;
  };
}

export default function ModelDialog({ models, kind, value, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);

  // Astryx's Dialog has its own Escape handling (purpose defaults to 'info',
  // which permits it), but that path never reaches onOpenChange here — reason
  // not isolated (see the 2026-08-18 fix report). Handling it directly, on
  // window with capture, means this fires regardless of whatever guard is
  // swallowing it inside Astryx.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const facets = useMemo(() => buildFacets(models, kind), [models, kind]);
  const shown = useMemo(
    () => applyFacets(models, kind, query, selected),
    [models, kind, query, selected],
  );

  // Sorting runs over the whole filtered set before paging — same rule the
  // Library documents for its own sort — so "cheapest" means cheapest of every
  // match, not cheapest of the current page.
  const { sortedData, sortConfig } = useTableSortableState({
    data: shown,
    defaultSort: [{ sortKey: 'id', direction: 'ascending' }],
    comparators: { price: priceComparator(kind) },
  });
  const sortPlugin = useTableSortable(sortConfig);

  // A new search or filter is a new result set; page 3 of the old one means
  // nothing. Same rule as the Library.
  useEffect(() => setPage(1), [query, selected]);
  const pageCount = Math.max(1, Math.ceil(sortedData.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = sortedData.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const toggle = (key, v) =>
    setSelected((s) => {
      const cur = s[key] || [];
      return { ...s, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });

  const columns = [
    {
      key: 'id',
      header: 'Model',
      width: proportional(2),
      sortable: true,
      // The slug Button is the only click target in this row — rows are not
      // clickable <tr>s, same rule as the Library's list view ("the rows are
      // not clickable, so buttons in the end slot are not nested click
      // targets"), which is also why this is a plugin-free Table: a custom
      // plugin to inject row onClick would just be a second way to do this.
      renderCell: (m) => (
        <VStack gap={0}>
          <HStack gap={1} align="center" wrap="wrap">
            {/* Slug, not display name: the slug is what goes in
                OPENROUTER_*_MODEL, same rule as the old picker. */}
            <Button
              label={m.id}
              variant="ghost"
              size="sm"
              onClick={() => { onPick(m.id); onClose(); }}
            />
            {m.id === value && <Token size="sm" color="blue" label="current" />}
          </HStack>
          {m.name !== m.id && (
            <Text type="supporting" color="secondary">{m.name}</Text>
          )}
        </VStack>
      ),
    },
    {
      key: 'caps',
      header: 'Capabilities',
      width: proportional(1),
      renderCell: (m) => (
        <HStack gap={1} align="center" wrap="wrap">
          {capabilityTags(m, kind).map((t) => (
            <span className="model-tag" key={t}>{t}</span>
          ))}
        </HStack>
      ),
    },
    // Image carries no pricing data at all (see facets.js) — an always-empty
    // column would just be noise, so it is omitted rather than rendered blank.
    ...(kind === 'image'
      ? []
      : [
          {
            key: 'price',
            header: 'Price',
            width: pixel(140),
            align: 'end',
            sortable: true,
            renderCell: (m) => {
              const price = priceLabel(m, kind);
              return price ? <Text hasTabularNumbers>{price}</Text> : null;
            },
          },
        ]),
  ];

  return (
    // nodrag/nowheel: the dialog's DOM lives inside the node's subtree, so
    // without them a drag inside the dialog moves the node under it and a
    // scroll pans the canvas.
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

        {facets.length > 0 && (
          <HStack gap={1} align="center" wrap="wrap">
            {facets.flatMap((f) =>
              f.values.map((v) => (
                <ToggleButton
                  key={`${f.key}:${v.value}`}
                  label={`${v.label} (${v.count})`}
                  size="sm"
                  isPressed={Boolean(selected[f.key]?.includes(v.value))}
                  onPressedChange={() => toggle(f.key, v.value)}
                />
              )),
            )}
          </HStack>
        )}

        {shown.length === 0 ? (
          <Text type="supporting" color="secondary">
            No model matches. Clear the search or a filter.
          </Text>
        ) : (
          <div className="model-dialog-list">
            <Table
              data={paged}
              columns={columns}
              idKey="id"
              density="compact"
              dividers="rows"
              hasHover
              textOverflow="truncate"
              plugins={{ sort: sortPlugin }}
            />
          </div>
        )}

        {shown.length > PAGE_SIZE && (
          <HStack justify="end">
            <Pagination
              page={current}
              onChange={setPage}
              totalItems={shown.length}
              pageSize={PAGE_SIZE}
              variant="count"
              size="sm"
            />
          </HStack>
        )}
      </VStack>
    </Dialog>
  );
}
