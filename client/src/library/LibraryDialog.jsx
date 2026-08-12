import { useEffect, useState } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Token } from '@astryxdesign/core/Token';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Selector } from '@astryxdesign/core/Selector';
import { Pagination } from '@astryxdesign/core/Pagination';
import { List } from '@astryxdesign/core/List';
import { Item } from '@astryxdesign/core/Item';
import { Trash2, UserRound, Package, LayoutGrid, List as ListIcon } from 'lucide-react';
import { BlockIcon, FlowIcon, ImageIcon, TextIcon, VideoIcon } from '../nodes/nodeIcons.jsx';
import { PRESETS, TYPES } from './index.js';

// Every chip a card can carry, in one table: an icon and a colour per value. Three
// axes — what a preset IS (flow / block), what it MAKES (image / video / text) and
// whose it is (custom / system) — each own a hue, so a card is scannable before it
// is read. Token is the design system's own chip, which is why there is no CSS here.
const CHIPS = {
  flow: { icon: FlowIcon, color: 'purple' },
  block: { icon: BlockIcon, color: 'blue' },
  image: { icon: ImageIcon, color: 'teal' },
  video: { icon: VideoIcon, color: 'orange' },
  text: { icon: TextIcon, color: 'cyan' },
  custom: { icon: UserRound, color: 'green' },
  // Pink, not gray: gray sat at the same weight as the Add button beside it, and it
  // is the one hue left that carries no status meaning — yellow would read as a
  // warning next to the app's real ones.
  system: { icon: Package, color: 'pink' },
};

// Saved presets carry source: 'user' — the ownership fact, which is what lives on
// disk. "custom" is only what it is called on screen.
const sourceOf = (p) => (p.source === 'user' ? 'custom' : 'system');

// Everything you saved is newer than anything that shipped, so a preset of yours
// from before savedAt existed still outranks the catalogue — and the bundled ones,
// which have no date at all, sort last rather than claiming to be old. Array.sort is
// stable, so equal ranks keep the order they came in.
const savedRank = (p) => p.savedAt || (p.source === 'user' ? '0' : '');

// Two orders, each with its inverse. Both directions are their own option rather
// than a separate asc/desc toggle: "Oldest" says what it does, where an arrow next
// to "Newest" would need decoding — and one control is one thing to click.
const byDate = (a, b) => savedRank(b).localeCompare(savedRank(a));
const byName = (a, b) => a.name.localeCompare(b.name);
const flip = (cmp) => (a, b) => cmp(b, a);

const SORTS = {
  newest: { label: 'Newest', cmp: byDate },
  // Oldest puts the bundled catalogue first, which follows from savedRank: it
  // shipped before anything you saved.
  oldest: { label: 'Oldest', cmp: flip(byDate) },
  name: { label: 'A–Z', cmp: byName },
  nameDesc: { label: 'Z–A', cmp: flip(byName) },
};

// Card or list is a preference, not a per-visit decision — remember it, the way the
// active project is remembered.
const VIEW_KEY = 'unframed:library-view';

const PAGE_SIZE = 10;

// Only on presets of yours — the bundled catalogue is not yours to delete. Shared by
// both views, which is the only reason it is a component.
function DeleteButton({ preset, onDelete }) {
  if (preset.source !== 'user') return null;
  return (
    <IconButton
      label={`Delete ${preset.name}`}
      tooltip="Delete from your library"
      size="sm"
      variant="ghost"
      icon={<Icon icon={Trash2} />}
      onClick={() => onDelete(preset)}
    />
  );
}

function Chip({ value }) {
  const chip = CHIPS[value];
  if (!chip) return null;
  return (
    <Token
      size="sm"
      color={chip.color}
      label={value[0].toUpperCase() + value.slice(1)}
      icon={<Icon icon={chip.icon} size="sm" />}
    />
  );
}

// Browse-and-add over the preset catalogue: search, two filters, card grid.
// Everything is plain derived state over two arrays — the bundled catalogue ships
// inside the app and yours arrives with the dialog, so there is nothing to debounce.
// No sort control yet: presets carry no date or popularity to sort by, and a picker
// with one meaningful order would just be furniture.
//
// Yours come first — you went looking for them — and carry a delete button. They are
// otherwise the same shape as the bundled ones, so search, the filters and insertion
// need no special case.
export default function LibraryDialog({ isOpen, onOpenChange, userPresets = [], onAdd, onDelete }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [source, setSource] = useState('any');
  const [sort, setSort] = useState('newest');
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'card');
  const [page, setPage] = useState(1);

  function changeView(next) {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  }

  const q = query.trim().toLowerCase();
  const shown = [...userPresets, ...PRESETS].filter(
    (p) =>
      (type === 'all' || p.type === type) &&
      (source === 'any' || sourceOf(p) === source) &&
      (!q || `${p.name} ${p.summary}`.toLowerCase().includes(q)),
  );
  shown.sort(SORTS[sort].cmp);

  // Filter and sort run over everything, and only then does the page get cut — so
  // "Newest" means the newest of all your presets, not the newest of this page.
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  // Clamped rather than stored: deleting the last preset on the last page would
  // otherwise leave you looking at an empty one.
  const current = Math.min(page, pageCount);
  const paged = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // A new search or filter is a new result set; page 3 of the old one means nothing.
  useEffect(() => setPage(1), [q, type, source, sort]);

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={680}>
      <DialogHeader title="Library" />
      <VStack gap={3} padding={4}>
        {/* Two rows, split by what they do to the grid: what you are looking at
            (search, order, shape) above, what is in it (the filters) below. */}
        <HStack gap={2} align="center" wrap="wrap">
          <span className="lib-search">
            <TextInput
              label="Search presets"
              isLabelHidden
              size="sm"
              startIcon="search"
              placeholder="Search presets…"
              value={query}
              onChange={setQuery}
            />
          </span>
          <span className="lib-sort">
            <Selector
              label="Sort"
              isLabelHidden
              size="sm"
              value={sort}
              onChange={setSort}
              options={Object.entries(SORTS).map(([value, s]) => ({ value, label: s.label }))}
            />
          </span>
          <SegmentedControl label="View" size="sm" value={view} onChange={changeView}>
            <SegmentedControlItem value="card" label="Cards" isLabelHidden icon={<Icon icon={LayoutGrid} />} />
            <SegmentedControlItem value="list" label="List" isLabelHidden icon={<Icon icon={ListIcon} />} />
          </SegmentedControl>
        </HStack>
        <HStack gap={2} align="center" wrap="wrap">
          <SegmentedControl label="Type" size="sm" value={type} onChange={setType}>
            <SegmentedControlItem value="all" label="All" />
            {TYPES.map((t) => (
              <SegmentedControlItem key={t} value={t} label={t[0].toUpperCase() + t.slice(1) + 's'} />
            ))}
          </SegmentedControl>
          {/* "Any", not a second "All": two identical pills side by side read as one
              control with a duplicated option. */}
          <SegmentedControl label="Source" size="sm" value={source} onChange={setSource}>
            <SegmentedControlItem value="any" label="Any" />
            <SegmentedControlItem value="custom" label="Custom" />
            <SegmentedControlItem value="system" label="System" />
          </SegmentedControl>
        </HStack>

        {shown.length === 0 ? (
          <Text type="supporting" color="secondary">
            Nothing here yet. Try another category or clear the search.
          </Text>
        ) : view === 'list' ? (
          // A real list, not cards in a column: dense divided rows. `Item` rather
          // than `ListItem` because its label takes a ReactNode — the chips belong on
          // the name's line, which leaves the whole row width to the description.
          // The rows are not clickable (Add is), so buttons in the end slot are not
          // nested click targets.
          <div className="lib-scroll">
            {/* No hasDividers: it only styles ListItem, and these rows are Items.
                The divider is one rule in styles.css instead of an inert prop. */}
            <List density="compact">
              {paged.map((p) => (
                <Item
                  as="li"
                  key={p.id}
                  density="compact"
                  label={
                    <HStack gap={1} align="center" wrap="wrap">
                      <Text type="body" weight="medium" className="lib-row-name">{p.name}</Text>
                      <Chip value={p.type} />
                      <Chip value={p.kind} />
                      <Chip value={sourceOf(p)} />
                    </HStack>
                  }
                  // A ReactNode description owns its own clamping, which is what buys
                  // the tooltip: three lines then an ellipsis, full text on hover
                  // through the native title attribute.
                  description={
                    <span className="lib-row-desc" title={p.summary}>{p.summary}</span>
                  }
                  endContent={
                    <HStack gap={1} align="center">
                      <DeleteButton preset={p} onDelete={onDelete} />
                      <Button label="Add" size="sm" variant="secondary" onClick={() => onAdd(p)} />
                    </HStack>
                  }
                />
              ))}
            </List>
          </div>
        ) : (
          <div className="lib-grid lib-scroll">
            {paged.map((p) => (
              <Card className="lib-card" padding={0} key={p.id}>
                <span className="lib-card-del">
                  <DeleteButton preset={p} onDelete={onDelete} />
                </span>
                <VStack gap={1} padding={3}>
                  <Text type="body" weight="medium" className="lib-card-title">{p.name}</Text>
                  <Text type="supporting">{p.summary}</Text>
                  {/* wrap: three chips will not always fit one card's width. */}
                  <HStack gap={1} align="center" wrap="wrap">
                    <Chip value={p.type} />
                    <Chip value={p.kind} />
                    <Chip value={sourceOf(p)} />
                  </HStack>
                </VStack>
                {/* Add gets its own strip under a divider: a chip and a button are
                    different heights, so sharing a row read as a mistake. */}
                <div className="lib-card-foot">
                  <Button label="Add" size="sm" variant="secondary" onClick={() => onAdd(p)} />
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Nothing to page through until there is a second page. */}
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
