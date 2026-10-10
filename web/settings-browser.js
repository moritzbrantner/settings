import initSettingsWasm, { SettingsSession } from './pkg/settings_wasm.js';

export const SETTINGS_BROWSER_API_VERSION = 1;

let initialization;

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

  exportScope(scope) {
    return this.#inner.export_scope_json(scope);
  }

  dispose() {
    this.#inner.free();
  }
}
