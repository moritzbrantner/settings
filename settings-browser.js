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
