export const SETTINGS_BROWSER_API_VERSION: 1;

export type SettingScope = 'session' | 'save' | 'device' | 'user';
export type ApplyMode = 'immediate' | 'apply' | 'restart' | 'reconnect';

export type SettingValue =
  | { type: 'bool'; value: boolean }
  | { type: 'integer'; value: number }
  | { type: 'number'; value: number }
  | { type: 'text'; value: string }
  | { type: 'choice'; value: string };

export type SettingKind =
  | { type: 'bool' }
  | { type: 'integer'; min: number; max: number }
  | { type: 'number'; min: number; max: number }
  | { type: 'text'; min_chars: number; max_chars: number }
  | { type: 'choice'; options: string[] };

export interface SettingDefinition {
  id: string;
  kind: SettingKind;
  default: SettingValue;
  scope: SettingScope;
  apply_mode: ApplyMode;
  availability?: unknown;
}

export type Discoverability = 'primary' | 'advanced' | 'search_only';

export interface PresentationMetadata {
  label_key: string;
  description_key?: string;
  category_key: string;
  group_key?: string;
  order?: number;
  discoverability?: Discoverability;
  search_keys?: string[];
}

export interface PresentationEntry {
  id: string;
  metadata: PresentationMetadata;
}

export interface BrowserSettingsSession {
  presentation(): PresentationEntry[];
  effectiveValues(): Record<string, SettingValue>;
  set(id: string, value: SettingValue): void;
  reset(id: string): void;
  importScope(scope: SettingScope, snapshot: string): string[];
  exportScope(scope: SettingScope): string;
  dispose(): void;
}

export function createSettingsSession(
  definitions: readonly SettingDefinition[],
  presentation?: readonly PresentationEntry[],
): Promise<BrowserSettingsSession>;
