// The markup the output nodes share. Split from core.js on logic-vs-JSX, which is the
// only boundary that pays for itself at this size — six small files would cost more to
// navigate than the duplication they removed.

import { Text } from '@astryxdesign/core/Text';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack } from '@astryxdesign/core/Stack';
import { capabilityTags, ratioLabel } from './core.js';

// Labelled by slug, not OpenRouter's display name: the slug is what you put in
// OPENROUTER_IMAGE_MODEL, and it keeps every row in one format. Capabilities sit on
// the row so a model is chosen by what it can do rather than by its name — without
// them the differences only surfaced after the fact, as a control that quietly did
// nothing. `kind` is the catalogue name, which decides which tags are worth showing.
export function ModelPicker({ models, value, onChange, kind }) {
  return (
    <Selector
      label="Model"
      size="sm"
      hasSearch
      options={models.map((m) => ({ value: m.id, label: m.id }))}
      value={value}
      placeholder="Loading models…"
      renderOption={(opt) => {
        const tags = capabilityTags(models.find((m) => m.id === opt.value), kind);
        return (
          <span className="model-option">
            <span className="model-option-id">{opt.label ?? opt.value}</span>
            {tags.length > 0 && (
              <span className="model-option-tags">
                {tags.map((t) => (
                  <span className="model-tag" key={t}>{t}</span>
                ))}
              </span>
            )}
          </span>
        );
      }}
      onChange={onChange}
    />
  );
}

// One control per parameter the selected model declares, and none for the rest.
// `params` is the object from useModelParams; `data` is the node's data; `onChange`
// takes the same partial update object updateNodeData does.
export function ParamControls({ params, data, onChange }) {
  const { exactSizes, resolutionTiers, qualities, backgrounds, ratios } = params;
  return (
    <HStack gap={2}>
      {exactSizes && (
        <Selector
          label="Size"
          size="sm"
          // Long for some models (seedance-2.0 declares 25), so searchable.
          hasSearch={exactSizes.length > 8}
          options={exactSizes.map((s) => {
            const r = ratioLabel(s);
            return { value: s, label: r ? `${s} · ${r}` : s };
          })}
          value={exactSizes.includes(data.size) ? data.size : undefined}
          placeholder="—"
          onChange={(v) => onChange({ size: v })}
        />
      )}
      {resolutionTiers && (
        <Selector
          label="Size"
          size="sm"
          options={resolutionTiers}
          value={resolutionTiers.includes(data.resolution) ? data.resolution : undefined}
          placeholder="—"
          onChange={(v) => onChange({ resolution: v })}
        />
      )}
      {qualities && (
        <Selector
          label="Quality"
          size="sm"
          options={qualities}
          value={qualities.includes(data.quality) ? data.quality : undefined}
          placeholder="—"
          onChange={(v) => onChange({ quality: v })}
        />
      )}
      {backgrounds && (
        <Selector
          label="Background"
          size="sm"
          options={backgrounds}
          value={backgrounds.includes(data.background) ? data.background : undefined}
          placeholder="—"
          onChange={(v) => onChange({ background: v })}
        />
      )}
      {ratios && (
        <Selector
          label="Ratio"
          size="sm"
          options={ratios}
          value={ratios.includes(data.aspect_ratio) ? data.aspect_ratio : undefined}
          placeholder="—"
          onChange={(v) => onChange({ aspect_ratio: v })}
        />
      )}
    </HStack>
  );
}

// What the run cost sits in a footer rather than in the body's flow: it reports on the
// node as a whole, so it reads better banded off against the same rule as the title
// than stacked under the last result. `cost` is null when there is nothing to bill
// yet; `before` and `after` are the caller's own extras (an estimate, a Clear button),
// which stay caller-specific because they differ per medium.
export function CostFoot({ cost, before, after }) {
  if (cost == null && !before && !after) return null;
  return (
    <div className="xnode-foot">
      {before}
      {cost != null && (
        <Text type="supporting" color="accent" hasTabularNumbers>
          ${Number(cost).toFixed(4)}
        </Text>
      )}
      {after}
    </div>
  );
}
