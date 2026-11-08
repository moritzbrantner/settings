export const SETTINGS_BROWSER_API_VERSION: 2;

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
  /** Current consumer default. */
  default: SettingValue;
  /** Whether the effective staged `value` differs from `default`. */
  differs_from_default: boolean;
  /** Durable preference beneath any overlay (the default when no valid override exists). */
  durable_value: SettingValue;
  /** `user_override`, `preset`, `migration` or `default`. */
  durable_provenance: ValueProvenance;
  /** Transient overlays present for this setting, including ones masked by a higher layer. */
  overlays: Partial<Record<OverlayLayer, SettingValue>>;
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

/**
 * Transient runtime layers above the durable preference, in precedence order
 * policy > command_line > session. They are never exported and survive resets and imports.
 */
export type OverlayLayer = 'policy' | 'command_line' | 'session';

/** Canonical preset: ordinary values applied atomically with `preset` provenance. */
export interface SettingsPreset {
  id: string;
  values: Record<string, SettingValue>;
}

/** Why one snapshot entry was preserved, rejected or dropped while importing. */
export type LoadDiagnostic =
  | { type: 'unknown_setting_preserved'; id: string }
  | { type: 'invalid_value'; id: string; reason: string }
  | { type: 'corrupt_value'; id: string; reason: string }
  | { type: 'invalid_identifier'; raw_id: string; reason: string }
  | { type: 'scope_mismatch'; id: string; expected: SettingScope; actual: SettingScope }
  | { type: 'legacy_unknown_entry_dropped'; id: string };

export interface ImportReport {
  scope: Exclude<SettingScope, 'session'>;
  /** Known settings whose durable override was loaded, in canonical id order. */
  loaded: string[];
  /** Unknown ids kept verbatim and written back by `exportScope`. */
  preserved_unknown: string[];
  migrations: { from_version: number; to_version: number }[];
  diagnostics: LoadDiagnostic[];
}

/** `none` when no apply-with-confirmation is open. */
export type ConfirmationStatus = 'none' | 'pending' | 'expired';

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
  /**
   * Replace one persistent scope from a snapshot; staged changes in that scope are discarded.
   * @deprecated Returns diagnostics as debug strings; use `importScopeReport`.
   */
  importScope(scope: SettingScope, snapshot: string): string[];
  /**
   * Replace one persistent scope from a snapshot (v1 snapshots are migrated) and report loaded,
   * preserved and rejected entries. Throws for a malformed envelope, unsupported schema,
   * mismatched scope or `session`. Overlays are kept.
   */
  importScopeReport(scope: SettingScope, snapshot: string): ImportReport;
  /** Canonical delta-only snapshot of one persistent scope; throws for `session`. */
  exportScope(scope: SettingScope): string;
  /** Apply a preset directly and atomically; returns the committed value changes. */
  setPreset(preset: SettingsPreset): SettingChange[];
  /** Stage a preset atomically; returns the staged value changes. */
  stagePreset(preset: SettingsPreset): SettingChange[];
  /** Set one transient overlay in the committed and staged state. */
  setOverlay(layer: OverlayLayer, id: string, value: SettingValue): void;
  /** Remove one overlay; returns whether it existed. */
  clearOverlay(layer: OverlayLayer, id: string): boolean;
  /** Remove every overlay of one layer, or of every layer when omitted. */
  clearOverlays(layer?: OverlayLayer): void;
  /**
   * Commit the staged state like `applyStaged`, keeping the previous state until
   * `confirmApplied` is called before `deadlineTick`. Ticks are caller-defined monotonic
   * non-negative integers; the session never reads a clock. Throws if one is already open.
   */
  applyStagedWithConfirmation(deadlineTick: number): SettingChange[];
  confirmationStatus(nowTick: number): ConfirmationStatus;
  /** Keep the applied state; `false` when nothing is pending or it already expired. */
  confirmApplied(nowTick: number): boolean;
  /**
   * When expired at `nowTick`, restore the pre-apply durable state (overlays are kept, staged
   * edits discarded) and return the changes to undo; otherwise return `[]`.
   */
  rollBackExpired(nowTick: number): SettingChange[];
  /** Restore the pre-apply durable state now; `[]` when nothing is open. */
  revertApplied(): SettingChange[];
  dispose(): void;
}

export function createSettingsSession(
  definitions: readonly SettingDefinition[],
  presentation?: readonly PresentationEntry[],
): Promise<BrowserSettingsSession>;
