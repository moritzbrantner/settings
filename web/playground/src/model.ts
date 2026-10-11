// Consumer-owned presentation helpers: localization lookup, labels for scopes, apply modes,
// provenance and availability reasons, and exact-entry parsing. Value validation stays in the
// settings session; parsing only turns text into a typed candidate value.
import type {
  ApplyMode,
  AvailabilityReason,
  PresentationEntry,
  SettingDefinition,
  SettingScope,
  SettingValue,
  ValueProvenance,
} from '@moritzbrantner/settings-browser';

export interface PlaygroundFixture {
  definitions: SettingDefinition[];
  presentation: PresentationEntry[];
  localizations: Record<string, string>;
}

export type Localize = (key: string) => string;

export function createLocalize(localizations: Readonly<Record<string, string>>): Localize {
  return (key) => localizations[key] ?? key;
}

export const SCOPE_LABEL: Record<SettingScope, string> = {
  user: 'User',
  device: 'Device',
  save: 'Save',
  session: 'Session',
};

export const MODE_LABEL: Record<ApplyMode, string> = {
  immediate: 'Immediate',
  apply: 'Staged until Apply',
  restart: 'After restart',
  reconnect: 'After reconnect',
};

export const PROVENANCE_LABEL: Record<ValueProvenance['type'], string> = {
  default: 'Default',
  user_override: 'User override',
  preset: 'Preset',
  migration: 'Migrated',
  policy: 'Policy',
  command_line_override: 'Command line',
  session_override: 'Session override',
};

export function optionLabel(localize: Localize, id: string, option: string): string {
  const key = `settings.option.${id}.${option}`;
  const text = localize(key);
  return text === key ? option : text;
}

export function valueLabel(localize: Localize, id: string, value: SettingValue): string {
  if (value.type === 'choice') return optionLabel(localize, id, value.value);
  if (value.type === 'bool') return value.value ? 'on' : 'off';
  return String(value.value);
}

function capabilityLabel(localize: Localize, id: string): string {
  const key = `settings.capability.${id}`;
  const text = localize(key);
  return text === key ? id : text;
}

/** Localized, user-facing explanation of why a setting is unavailable. */
export function reasonText(
  reason: AvailabilityReason,
  localize: Localize,
  labels: ReadonlyMap<string, string>,
): string {
  const settingLabel = (id: string) => labels.get(id) ?? id;
  const describe = (id: string, value: SettingValue) => valueLabel(localize, id, value);
  switch (reason.type) {
    case 'missing_capability':
      return reason.expected
        ? `Requires ${capabilityLabel(localize, reason.id)}; this device has not reported one.`
        : `Unavailable until this device reports whether it has ${capabilityLabel(localize, reason.id)}.`;
    case 'capability_mismatch':
      return reason.expected
        ? `Requires ${capabilityLabel(localize, reason.id)}, which this device does not have.`
        : `Unavailable with ${capabilityLabel(localize, reason.id)}.`;
    case 'setting_value_mismatch':
      return `Requires ${settingLabel(reason.id)} to be ${describe(reason.id, reason.expected)}.`;
    case 'negated_condition_matched': {
      const condition = reason.condition as
        | { op: 'setting_equals'; id: string; value: SettingValue }
        | { op: 'capability'; id: string; expected: boolean }
        | { op: string };
      if (condition.op === 'setting_equals' && 'value' in condition) {
        return `Unavailable while ${settingLabel(condition.id)} is ${describe(condition.id, condition.value)}.`;
      }
      if (condition.op === 'capability' && 'expected' in condition) {
        return `Unavailable with ${capabilityLabel(localize, condition.id)}.`;
      }
      return 'Unavailable in the current configuration.';
    }
    case 'missing_setting':
    case 'invalid_setting_predicate':
      return `Unavailable: depends on ${settingLabel(reason.id)}, which cannot be evaluated.`;
  }
}

export type ParseResult = { ok: true; value: SettingValue } | { ok: false; message: string };

const INTEGER_TEXT = /^[+-]?\d+$/;
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Turn exact-entry text into a typed candidate. Range checks belong to the session. */
export function parseExact(definition: SettingDefinition, text: string): ParseResult {
  const trimmed = text.trim();
  const kind = definition.kind;
  if (kind.type === 'integer') {
    const number = Number(trimmed);
    if (!INTEGER_TEXT.test(trimmed) || !Number.isSafeInteger(number)) {
      return { ok: false, message: rangeMessage(definition) };
    }
    return { ok: true, value: { type: 'integer', value: number } };
  }
  if (kind.type === 'number') {
    const number = Number(trimmed);
    if (!DECIMAL_TEXT.test(trimmed) || !Number.isFinite(number)) {
      return { ok: false, message: rangeMessage(definition) };
    }
    return { ok: true, value: { type: 'number', value: number } };
  }
  if (kind.type === 'text') return { ok: true, value: { type: 'text', value: text } };
  throw new Error(`exact entry is not supported for ${kind.type} settings`);
}

/** Message shown when the session (or parsing) rejects a candidate value. */
export function rangeMessage(definition: SettingDefinition): string {
  const kind = definition.kind;
  switch (kind.type) {
    case 'integer':
      return `Enter a whole number from ${kind.min} to ${kind.max}.`;
    case 'number':
      return `Enter a finite number from ${kind.min} to ${kind.max}.`;
    case 'text':
      return `Enter ${kind.min_chars} to ${kind.max_chars} characters.`;
    case 'choice':
      return 'Choose one of the listed options.';
    case 'bool':
      return 'Choose on or off.';
  }
}

/** Slider step for numeric settings where a slider helps; `undefined` means exact entry only. */
export function sliderStep(definition: SettingDefinition): number | undefined {
  const kind = definition.kind;
  if (kind.type === 'integer') {
    return kind.max - kind.min <= 1000 ? 1 : undefined;
  }
  if (kind.type === 'number') {
    const span = kind.max - kind.min;
    if (!(span > 0)) return undefined;
    return 10 ** Math.floor(Math.log10(span / 100));
  }
  return undefined;
}

export function sameValue(left: SettingValue | undefined, right: SettingValue | undefined): boolean {
  return left?.type === right?.type && left?.value === right?.value;
}
