import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { TextArea } from '@astryxdesign/core/TextArea';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack, HStack } from '@astryxdesign/core/Stack';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import { sourceRoles } from '../graph/resolve.js';

export default function CharacterNode({ id, data }) {
  const { updateNodeData } = useReactFlow();
  const roles = sourceRoles(useNodes(), useEdges(), id);
  const images = data.images || [];

  function addImages(files) {
    if (!files) return;
    const list = Array.isArray(files) ? files : [files];
    if (!list.length) return;
    Promise.all(
      list.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result;
              const img = new Image();
              img.onload = () =>
                resolve({
                  dataUrl,
                  fileName: file.name,
                  aspect: img.naturalWidth / img.naturalHeight,
                });
              img.src = dataUrl;
            };
            reader.readAsDataURL(file);
          }),
      ),
    ).then((newImages) => {
      updateNodeData(id, { images: [...images, ...newImages] });
    });
  }

  function removeImage(index) {
    updateNodeData(id, {
      images: images.filter((_, i) => i !== index),
    });
  }

  function updateName(name) {
    updateNodeData(id, { name });
  }

  function updateText(text) {
    updateNodeData(id, { text });
  }

  // Show the character name when the node is not wired; show the connection role
  // when its images are wired. No "not connected" label and no fallback @id — both
  // made a named character node feel like an orphan.
  const name = data.name?.trim();
  const role = roles.length ? `image ${roles.join(' / ')}` : null;
  const line = role ? (name ? `${name} · ${role}` : role) : name || null;

  return (
    <>
      <NodeHeader kind="character" family="input" />
      <Card width="100%" padding={0} elevation="low" className="xnode-character">
        <Handle type="source" position={Position.Right} />
        <div className="xnode-body">
          <VStack gap={3} padding={3}>
            <TextArea
              className="nodrag nowheel xnode-character-name"
              label="Character name"
              isLabelHidden
              rows={1}
              hasSpellCheck={false}
              placeholder="Character name"
              value={data.name || ''}
              onChange={updateName}
            />
            <TextArea
              className="nodrag nowheel"
              label="Character description"
              isLabelHidden
              rows={3}
              hasSpellCheck={false}
              placeholder="Appearance, outfit, distinguishing features…"
              value={data.text || ''}
              onChange={updateText}
            />

            <VStack gap={1} width="100%">
              <FileInput
                className="nodrag"
                label="Add reference images"
                isLabelHidden
                accept="image/*"
                isMultiple
                value={null}
                onChange={addImages}
              />

              {images.length > 0 && (
                <HStack gap={1} wrap="wrap">
                  {images.map((img, i) => (
                    <span key={`${img.fileName || ''}-${i}`} className="xnode-character-thumb">
                      <Thumbnail
                        className="xnode-thumb"
                        style={{ aspectRatio: img.aspect || 1 }}
                        src={img.dataUrl}
                        alt={img.fileName || `reference ${i + 1}`}
                      />
                      <span className="xnode-character-remove nodrag">
                        <Button
                          label={`Remove ${img.fileName || `reference ${i + 1}`}`}
                          isIconOnly
                          icon={<Icon icon="close" size="xsm" />}
                          size="sm"
                          onClick={() => removeImage(i)}
                        />
                      </span>
                    </span>
                  ))}
                </HStack>
              )}
            </VStack>
          </VStack>
        </div>
      </Card>
      <NodeLine live={roles.length > 0}>{line}</NodeLine>
      <MediaResize free />
    </>
  );
}
