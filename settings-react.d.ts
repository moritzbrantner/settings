import { type ReactElement, type ReactNode } from 'react';
import { type ToggleSettingProps } from '@moritzbrantner/ui/stable';
import type { PresentationEntry, SettingDefinition, SettingValue } from './settings-browser.js';
export type SettingsLocalize = (key: string) => ReactNode;
type BooleanDefinition = SettingDefinition & {
    kind: {
        type: 'bool';
    };
};
type BooleanValue = Extract<SettingValue, {
    type: 'bool';
}>;
export interface SettingsBooleanFieldProps extends Omit<ToggleSettingProps, 'title' | 'description' | 'checked' | 'defaultChecked' | 'onCheckedChange'> {
    definition: BooleanDefinition;
    presentation: PresentationEntry;
    value: BooleanValue;
    localize: SettingsLocalize;
    onValueChange: (checked: boolean) => void;
}
export declare function SettingsBooleanField({ definition, presentation, value, localize, onValueChange, disabled, detail, id, className, switchProps, ...props }: SettingsBooleanFieldProps): ReactElement;
export declare function assertBooleanBinding(definition: SettingDefinition, presentation: PresentationEntry, value: SettingValue): asserts definition is BooleanDefinition;
export {};
