import { useState } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { BlockIcon, FlowIcon, ImageIcon, TextIcon, VideoIcon } from '../nodes/nodeIcons.jsx';
import { PRESETS, TYPES } from './index.js';

// A preset's two chips: what it IS (a wired flow, a single ready-made block) and
// what it MAKES (image, video, text). Same icon language as the nodes themselves.
const TYPE_ICONS = { flow: FlowIcon, block: BlockIcon };
const KIND_ICONS = { image: ImageIcon, video: VideoIcon, text: TextIcon };

function Chip({ icon: ChipIcon, label }) {
  return (
    <span className="lib-chip">
      <ChipIcon />
      {label}
    </span>
  );
}

// Browse-and-add over the preset catalogue: search, category chips, card grid.
// Search and filters are plain derived state over the bundled array — with the
// catalogue shipped inside the app there is nothing to fetch or debounce.
// No sort control yet: presets carry no date or popularity to sort by, and a
// picker with one meaningful order would just be furniture. The toolbar has room
// for it the day the data exists.
export default function LibraryDialog({ isOpen, onOpenChange, onAdd }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');

  const q = query.trim().toLowerCase();
  const shown = PRESETS.filter(
    (p) =>
      (type === 'all' || p.type === type) &&
      (!q || `${p.name} ${p.summary}`.toLowerCase().includes(q)),
  );

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={680}>
      <DialogHeader title="Library" />
      <VStack gap={3} padding={4}>
        <HStack gap={2} align="center">
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
          <SegmentedControl label="Type" size="sm" value={type} onChange={setType}>
            <SegmentedControlItem value="all" label="All" />
            {TYPES.map((t) => (
              <SegmentedControlItem key={t} value={t} label={t[0].toUpperCase() + t.slice(1) + 's'} />
            ))}
          </SegmentedControl>
        </HStack>

        {shown.length === 0 ? (
          <Text type="supporting" color="secondary">
            Nothing here yet. Try another category or clear the search.
          </Text>
        ) : (
          <div className="lib-grid">
            {shown.map((p) => {
              const KindIcon = KIND_ICONS[p.kind];
              return (
                <Card className="lib-card" padding={0} key={p.id}>
                  <VStack gap={1} padding={3}>
                    <Text type="body" weight="medium">{p.name}</Text>
                    <Text type="supporting">{p.summary}</Text>
                    <HStack gap={1} align="center">
                      {TYPE_ICONS[p.type] && <Chip icon={TYPE_ICONS[p.type]} label={p.type} />}
                      {KindIcon && <Chip icon={KindIcon} label={p.kind} />}
                      <span className="lib-card-add">
                        <Button label="Add" size="sm" variant="secondary" onClick={() => onAdd(p)} />
                      </span>
                    </HStack>
                  </VStack>
                </Card>
              );
            })}
          </div>
        )}
      </VStack>
    </Dialog>
  );
}
