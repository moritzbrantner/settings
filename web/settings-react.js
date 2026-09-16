import { createElement } from 'react';
import { ToggleSetting } from '@moritzbrantner/ui/stable';

export function SettingsBooleanField({
  definition,
  presentation,
  value,
  localize,
  onValueChange,
  disabled = false,
  detail,
  id,
  className,
  switchProps,
  ...props
}) {
  assertBooleanBinding(definition, presentation, value);

  const metadata = presentation.metadata;
  return createElement(ToggleSetting, {
    id: id ?? `setting-${definition.id.replaceAll('.', '-')}`,
    title: localize(metadata.label_key),
    description: metadata.description_key
      ? localize(metadata.description_key)
      : undefined,
    detail,
    checked: value.value,
    disabled,
    onCheckedChange: onValueChange,
    className,
    switchProps,
    'data-setting-id': definition.id,
    'data-setting-kind': 'bool',
    ...props,
  });
}

export function assertBooleanBinding(definition, presentation, value) {
  if (!definition || definition.kind?.type !== 'bool') {
    throw new TypeError('SettingsBooleanField requires a bool setting definition');
  }
  if (!presentation || presentation.id !== definition.id) {
    throw new TypeError('settings presentation metadata must match the setting definition id');
  }
  if (!value || value.type !== 'bool') {
    throw new TypeError('SettingsBooleanField requires a bool setting value');
  }
}
