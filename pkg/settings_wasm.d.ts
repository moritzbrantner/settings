/* tslint:disable */
/* eslint-disable */

export class SettingsSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Commit the staged state and return the committed value changes.
     */
    apply_staged_json(): string;
    /**
     * Commit the staged state, keeping a rollback until confirmed before `deadline_tick`.
     */
    apply_staged_with_confirmation_json(deadline_tick: number): string;
    /**
     * Discard the staged state and return the staged-to-committed value changes.
     */
    cancel_staged_json(): string;
    /**
     * Remove one overlay; returns whether it existed.
     */
    clear_overlay(raw_layer: string, raw_id: string): boolean;
    /**
     * Remove every overlay of one layer.
     */
    clear_overlays(raw_layer: string): void;
    /**
     * Keep the applied state; succeeds only while the confirmation is pending.
     */
    confirm_applied(now_tick: number): boolean;
    /**
     * `none`, `pending` or `expired` at the caller-supplied tick.
     */
    confirmation_status(now_tick: number): string;
    /**
     * Return every committed effective value keyed by stable setting id.
     *
     * Values retain the tagged `SettingValue` wire representation so browser
     * adapters cannot accidentally erase type information.
     */
    effective_values_json(): string;
    /**
     * Export one persistent scope as a canonical delta-only snapshot.
     */
    export_scope_json(raw_scope: string): string;
    /**
     * Whether any staged layered state differs from the committed state.
     */
    has_staged_changes(): boolean;
    /**
     * Replace one persistent scope from a canonical settings snapshot.
     *
     * Replacing rather than merging is important: an override that disappears
     * from a later snapshot must also disappear from the runtime state. Staged changes in that
     * scope are discarded.
     */
    import_scope_json(raw_scope: string, json: string): string;
    /**
     * Replace one persistent scope and return a structured load report (loaded, preserved
     * unknown and rejected entries with reasons, migrations). Overlays survive the import.
     */
    import_scope_report_json(raw_scope: string, json: string): string;
    /**
     * Validate and replace the presentation metadata associated with this session.
     */
    load_presentation_json(presentation_json: string): void;
    constructor(definitions_json: string);
    /**
     * Return presentation entries in the canonical Rust-defined order.
     */
    presentation_json(): string;
    /**
     * Remove the committed durable override of one setting.
     */
    reset(raw_id: string): void;
    /**
     * Remove every committed durable override in every scope.
     */
    reset_all(): void;
    /**
     * Remove the committed durable overrides of a caller-supplied list of settings atomically.
     */
    reset_many_json(ids_json: string): void;
    /**
     * Roll back to the pre-apply state now.
     */
    revert_applied_json(): string;
    /**
     * Roll back to the pre-apply state if the confirmation expired at `now_tick`.
     */
    roll_back_expired_json(now_tick: number): string;
    /**
     * Replace the caller-supplied capability facts used for availability evaluation.
     */
    set_capabilities_json(facts_json: string): void;
    /**
     * Set one committed user-facing value using the canonical tagged JSON value shape.
     */
    set_json(raw_id: string, value_json: string): void;
    /**
     * Set one `policy`, `command_line` or `session` overlay above the durable preference.
     */
    set_overlay_json(raw_layer: string, raw_id: string, value_json: string): void;
    /**
     * Apply a preset directly with `Preset` provenance; returns the committed value changes.
     */
    set_preset_json(preset_json: string): string;
    /**
     * Per-setting staged value, provenance, override, staging and availability status.
     */
    setting_states_json(): string;
    /**
     * Stage a preset with `Preset` provenance; returns the staged value changes.
     */
    stage_preset_json(preset_json: string): string;
    /**
     * Stage removal of every durable override in every scope.
     */
    stage_reset_all(): void;
    /**
     * Stage removal of the durable overrides of a caller-supplied list of settings atomically.
     */
    stage_reset_many_json(ids_json: string): void;
    /**
     * Stage one value without committing it.
     */
    stage_set_json(raw_id: string, value_json: string): void;
    /**
     * Deterministic committed-to-staged value changes.
     */
    staged_changes_json(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_settingssession_free: (a: number, b: number) => void;
    readonly settingssession_apply_staged_json: (a: number) => [number, number, number, number];
    readonly settingssession_apply_staged_with_confirmation_json: (a: number, b: number) => [number, number, number, number];
    readonly settingssession_cancel_staged_json: (a: number) => [number, number, number, number];
    readonly settingssession_clear_overlay: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly settingssession_clear_overlays: (a: number, b: number, c: number) => [number, number];
    readonly settingssession_confirm_applied: (a: number, b: number) => [number, number, number];
    readonly settingssession_confirmation_status: (a: number, b: number) => [number, number, number, number];
    readonly settingssession_effective_values_json: (a: number) => [number, number, number, number];
    readonly settingssession_export_scope_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly settingssession_has_staged_changes: (a: number) => number;
    readonly settingssession_import_scope_json: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly settingssession_import_scope_report_json: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly settingssession_load_presentation_json: (a: number, b: number, c: number) => [number, number];
    readonly settingssession_new: (a: number, b: number) => [number, number, number];
    readonly settingssession_presentation_json: (a: number) => [number, number, number, number];
    readonly settingssession_reset: (a: number, b: number, c: number) => [number, number];
    readonly settingssession_reset_all: (a: number) => void;
    readonly settingssession_reset_many_json: (a: number, b: number, c: number) => [number, number];
    readonly settingssession_revert_applied_json: (a: number) => [number, number, number, number];
    readonly settingssession_roll_back_expired_json: (a: number, b: number) => [number, number, number, number];
    readonly settingssession_set_capabilities_json: (a: number, b: number, c: number) => [number, number];
    readonly settingssession_set_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly settingssession_set_overlay_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly settingssession_set_preset_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly settingssession_setting_states_json: (a: number) => [number, number, number, number];
    readonly settingssession_stage_preset_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly settingssession_stage_reset_all: (a: number) => void;
    readonly settingssession_stage_reset_many_json: (a: number, b: number, c: number) => [number, number];
    readonly settingssession_stage_set_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly settingssession_staged_changes_json: (a: number) => [number, number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
