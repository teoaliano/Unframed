import { DropdownMenu, DropdownMenuItem } from '@astryxdesign/core/DropdownMenu';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Stack';

// Minimal Lucide-style glyphs; Astryx's semantic set has no pencil/trash/plus.
const PencilIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const TrashIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const PlusIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default function ProjectMenu({ projects, current, onSwitch, onRename, onDelete, onAdd }) {
  return (
    <DropdownMenu button={{ label: current, size: 'sm', variant: 'secondary' }}>
      {projects.map((p) => (
        <DropdownMenuItem
          key={p}
          label={p}
          onClick={() => onSwitch(p)}
          endContent={
            <HStack gap={1}>
              <IconButton
                size="sm"
                variant="ghost"
                label={`Rename ${p}`}
                tooltip="Rename"
                icon={<Icon icon={PencilIcon} size="sm" />}
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(p);
                }}
              />
              <IconButton
                size="sm"
                variant="ghost"
                label={`Delete ${p}`}
                tooltip="Delete"
                icon={<Icon icon={TrashIcon} size="sm" />}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(p);
                }}
              />
            </HStack>
          }
        />
      ))}
      <DropdownMenuItem icon={PlusIcon} label="Add project" onClick={onAdd} />
    </DropdownMenu>
  );
}
