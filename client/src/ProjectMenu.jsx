import { DropdownMenu, DropdownMenuItem } from '@astryxdesign/core/DropdownMenu';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Stack';
// Astryx's semantic set has no pencil/trash/plus, so these come straight from
// lucide-react — the pack the theme registers for the semantic names, so they
// match the rest of the UI rather than approximating it.
import { SquarePen as PencilIcon, Trash2 as TrashIcon, Plus as PlusIcon, Check as CheckIcon } from 'lucide-react';

export default function ProjectMenu({ projects, current, onSwitch, onRename, onDelete, onAdd }) {
  return (
    <DropdownMenu button={{ label: current, size: 'sm', variant: 'secondary' }}>
      {projects.map((p) => (
        <DropdownMenuItem
          key={p}
          label={p}
          // The open menu always focuses its first item, which read as "this is the
          // one you are in" even when it was not. The check marks the project you
          // are actually in, and the class tints it, so the two states are told
          // apart rather than competing. Check AND tint on purpose: the tint alone
          // would be one more thing distinguished only by colour.
          //
          // The check goes in the component's own leading-icon slot rather than
          // beside the row's buttons: that slot centres it against the label for us,
          // and putting it first indents the current project's name, which is a
          // second, non-colour way to spot it at a glance.
          icon={p === current ? CheckIcon : undefined}
          className={p === current ? 'project-current' : undefined}
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
