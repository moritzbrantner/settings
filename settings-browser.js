import initSettingsWasm, { SettingsSession } from './pkg/settings_wasm.js';

export const SETTINGS_BROWSER_API_VERSION = 2;

const OVERLAY_LAYERS = ['policy', 'command_line', 'session'];

let initialization;

// Only the canonical preset shape crosses the boundary; fixture labels stay with the consumer.
function presetJson({ id, values }) {
  return JSON.stringify({ id, values });
}

export async function createSettingsSession(definitions, presentation = []) {
  initialization ??= initSettingsWasm();
  await initialization;
  const inner = new SettingsSession(JSON.stringify(definitions));
  inner.load_presentation_json(JSON.stringify(presentation));
  return new BrowserSettingsSession(inner);
}

class BrowserSettingsSession {
  #inner;

  constructor(inner) {
    this.#inner = inner;
  }

  presentation() {
    return JSON.parse(this.#inner.presentation_json());
  }

  effectiveValues() {
    return JSON.parse(this.#inner.effective_values_json());
  }

  set(id, value) {
    this.#inner.set_json(id, JSON.stringify(value));
  }

  reset(id) {
    this.#inner.reset(id);
  }

  resetMany(ids) {
    this.#inner.reset_many_json(JSON.stringify([...ids]));
  }

  resetAll() {
    this.#inner.reset_all();
  }

  stageSet(id, value) {
    this.#inner.stage_set_json(id, JSON.stringify(value));
  }

  stageResetMany(ids) {
    this.#inner.stage_reset_many_json(JSON.stringify([...ids]));
  }

  stageResetAll() {
    this.#inner.stage_reset_all();
  }

  hasStagedChanges() {
    return this.#inner.has_staged_changes();
  }

  stagedChanges() {
    return JSON.parse(this.#inner.staged_changes_json());
  }

  applyStaged() {
    return JSON.parse(this.#inner.apply_staged_json());
  }

  cancelStaged() {
    return JSON.parse(this.#inner.cancel_staged_json());
  }

  setCapabilities(facts) {
    this.#inner.set_capabilities_json(JSON.stringify(facts));
  }

  settingStates() {
    return JSON.parse(this.#inner.setting_states_json());
  }

  importScope(scope, snapshot) {
    return JSON.parse(this.#inner.import_scope_json(scope, snapshot));
  }

  importScopeReport(scope, snapshot) {
    return JSON.parse(this.#inner.import_scope_report_json(scope, snapshot));
  }

  exportScope(scope) {
    return this.#inner.export_scope_json(scope);
  }

  setPreset(preset) {
    return JSON.parse(this.#inner.set_preset_json(presetJson(preset)));
  }

  stagePreset(preset) {
    return JSON.parse(this.#inner.stage_preset_json(presetJson(preset)));
  }

  setOverlay(layer, id, value) {
    this.#inner.set_overlay_json(layer, id, JSON.stringify(value));
  }

  clearOverlay(layer, id) {
    return this.#inner.clear_overlay(layer, id);
  }

  clearOverlays(layer) {
    for (const each of layer === undefined ? OVERLAY_LAYERS : [layer]) {
      this.#inner.clear_overlays(each);
    }
  }

  applyStagedWithConfirmation(deadlineTick) {
    return JSON.parse(this.#inner.apply_staged_with_confirmation_json(deadlineTick));
  }

  confirmationStatus(nowTick) {
    return this.#inner.confirmation_status(nowTick);
  }

  confirmApplied(nowTick) {
    return this.#inner.confirm_applied(nowTick);
  }

  rollBackExpired(nowTick) {
    return JSON.parse(this.#inner.roll_back_expired_json(nowTick));
  }

  revertApplied() {
    return JSON.parse(this.#inner.revert_applied_json());
  }

  dispose() {
    this.#inner.free();
  }
}
