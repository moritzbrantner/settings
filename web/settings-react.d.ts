import type * as React from 'react';
import type { ToggleSettingProps } from '@moritzbrantner/ui/stable';
import type {
  PresentationEntry,
  SettingDefinition,
  SettingValue,
} from './settings-browser.js';

export type SettingsTranslate = (key: string) => React.ReactNode;

export interface SettingsBooleanFieldProps
  extends Omit<
    ToggleSettingProps,
    'title' | 'description' | 'checked' | 'defaultChecked' | 'onCheckedChange'
  > {
  definition: SettingDefinition & { kind: { type: 'bool' } };
  presentation: PresentationEntry;
  value: Extract<SettingValue, { type: 'bool' }>;
  translate: SettingsTranslate;
  onValueChange: (checked: boolean) => void;
}

export function SettingsBooleanField(
  props: SettingsBooleanFieldProps,
): React.ReactElement;

export function assertBooleanBinding(
  definition: SettingDefinition,
  presentation: PresentationEntry,
  value: SettingValue,
): asserts definition is SettingDefinition & { kind: { type: 'bool' } };
