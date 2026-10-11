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

/** Why a value is effective; `default` means no applicable override exists. */
export type ValueProvenance =
  | { type: 'default' }
  | { type: 'user_override' }
  | { type: 'preset' }
  | { type: 'migration'; from_version: number }
  | { type: 'policy' }
  | { type: 'command_line_override' }
  | { type: 'session_override' };

export type AvailabilityStatus = 'available' | 'disabled' | 'hidden';

/** Structured reason a declarative availability condition is not satisfied. */
export type AvailabilityReason =
  | { type: 'missing_capability'; id: string; expected: boolean }
  | { type: 'capability_mismatch'; id: string; expected: boolean; actual: boolean }
  | { type: 'missing_setting'; id: string; expected: SettingValue }
  | { type: 'invalid_setting_predicate'; id: string; expected: SettingValue }
  | { type: 'setting_value_mismatch'; id: string; expected: SettingValue; actual: SettingValue }
  | { type: 'negated_condition_matched'; condition: unknown };

export interface SettingAvailability {
  status: AvailabilityStatus;
  reasons: AvailabilityReason[];
}

/** Per-setting view of the staged state, in canonical setting-id order. */
export interface SettingState {
  id: string;
  /** Effective staged value (equals the committed value when nothing is staged). */
  value: SettingValue;
  committed_value: SettingValue;
  provenance: ValueProvenance;
  /** Whether a durable override exists in the staged state. */
  overridden: boolean;
  /** Whether the staged durable layer differs from the committed one. */
  staged: boolean;
  /** Evaluated against the staged values and the facts passed to `setCapabilities`. */
  availability: SettingAvailability;
}

/** Deterministic value change record, sorted by setting id. */
export interface SettingChange {
  id: string;
  before: SettingValue;
  after: SettingValue;
  before_provenance: ValueProvenance;
  after_provenance: ValueProvenance;
  apply_mode: ApplyMode;
}

export interface BrowserSettingsSession {
  presentation(): PresentationEntry[];
  /** Committed effective values. */
  effectiveValues(): Record<string, SettingValue>;
  /** Commit one value directly; also replaces any staged value for that setting. */
  set(id: string, value: SettingValue): void;
  /** Remove one committed durable override (and its staged value). */
  reset(id: string): void;
  /** Remove the committed durable overrides of the listed settings atomically. */
  resetMany(ids: readonly string[]): void;
  /** Remove every committed durable override. */
  resetAll(): void;
  /** Stage one value until `applyStaged` or `cancelStaged`. */
  stageSet(id: string, value: SettingValue): void;
  /** Stage removal of the listed settings' durable overrides atomically (section reset). */
  stageResetMany(ids: readonly string[]): void;
  /** Stage removal of every durable override (global reset). */
  stageResetAll(): void;
  hasStagedChanges(): boolean;
  stagedChanges(): SettingChange[];
  /** Commit the staged state; returns the committed value changes. */
  applyStaged(): SettingChange[];
  /** Discard the staged state; returns the staged-to-committed value changes. */
  cancelStaged(): SettingChange[];
  /** Replace the opaque capability facts used for availability evaluation. */
  setCapabilities(facts: Readonly<Record<string, boolean>>): void;
  settingStates(): SettingState[];
  importScope(scope: SettingScope, snapshot: string): string[];
  exportScope(scope: SettingScope): string;
  dispose(): void;
}

export function createSettingsSession(
  definitions: readonly SettingDefinition[],
  presentation?: readonly PresentationEntry[],
): Promise<BrowserSettingsSession>;
