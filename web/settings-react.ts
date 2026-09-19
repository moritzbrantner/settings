import { createElement, useId, type ReactElement, type ReactNode } from 'react';
import { ToggleSetting, type ToggleSettingProps } from '@moritzbrantner/ui/stable';
import type {
  PresentationEntry,
  SettingDefinition,
  SettingValue,
} from './settings-browser.js';

export type SettingsLocalize = (key: string) => ReactNode;

type BooleanDefinition = SettingDefinition & { kind: { type: 'bool' } };
type BooleanValue = Extract<SettingValue, { type: 'bool' }>;

export interface SettingsBooleanFieldProps
  extends Omit<
    ToggleSettingProps,
    'title' | 'description' | 'checked' | 'defaultChecked' | 'onCheckedChange'
  > {
  definition: BooleanDefinition;
  presentation: PresentationEntry;
  value: BooleanValue;
  localize: SettingsLocalize;
  onValueChange: (checked: boolean) => void;
}

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
}: SettingsBooleanFieldProps): ReactElement {
  assertBooleanBinding(definition, presentation, value);

  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  const {
    id: _switchId,
    checked: _switchChecked,
    defaultChecked: _switchDefaultChecked,
    disabled: _switchDisabled,
    onCheckedChange: _switchOnCheckedChange,
    ...safeSwitchProps
  } = switchProps ?? {};
  const metadata = presentation.metadata;

  return createElement(ToggleSetting, {
    ...props,
    id: resolvedId,
    title: localize(metadata.label_key),
    description: metadata.description_key
      ? localize(metadata.description_key)
      : undefined,
    detail,
    checked: value.value,
    disabled,
    onCheckedChange: onValueChange,
    className,
    switchProps: safeSwitchProps,
    'data-setting-id': definition.id,
    'data-setting-kind': 'bool',
  });
}

export function assertBooleanBinding(
  definition: SettingDefinition,
  presentation: PresentationEntry,
  value: SettingValue,
): asserts definition is BooleanDefinition {
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
