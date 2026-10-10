//! Narrow WebAssembly transport for `settings-core` and presentation metadata.
//!
//! The browser boundary intentionally transports JSON strings. Validation,
//! defaulting, scope ownership, persistence, migration, staging, availability, provenance and
//! presentation ordering remain implemented in Rust; web consumers do not get a second settings
//! engine.
//!
//! The session keeps two layered states per scope: the committed state and a staged state used by
//! explicit Apply/Cancel flows. Direct writes (`set_json`, `reset`, `reset_many_json`,
//! `reset_all`) change the committed state and mirror into the staged state, so consumers that
//! never stage observe exactly the previous single-state behavior. Staged writes change only the
//! staged state until `apply_staged_json` commits it or `cancel_staged_json` discards it.

mod session;

pub use session::SessionCore;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SettingsSession {
    core: SessionCore,
}

#[wasm_bindgen]
impl SettingsSession {
    #[wasm_bindgen(constructor)]
    pub fn new(definitions_json: &str) -> Result<Self, JsValue> {
        Ok(Self {
            core: SessionCore::new(definitions_json).map_err(js_error)?,
        })
    }

    /// Validate and replace the presentation metadata associated with this session.
    pub fn load_presentation_json(&mut self, presentation_json: &str) -> Result<(), JsValue> {
        self.core
            .load_presentation_json(presentation_json)
            .map_err(js_error)
    }

    /// Return presentation entries in the canonical Rust-defined order.
    pub fn presentation_json(&self) -> Result<String, JsValue> {
        self.core.presentation_json().map_err(js_error)
    }

    /// Return every committed effective value keyed by stable setting id.
    ///
    /// Values retain the tagged `SettingValue` wire representation so browser
    /// adapters cannot accidentally erase type information.
    pub fn effective_values_json(&self) -> Result<String, JsValue> {
        self.core.effective_values_json().map_err(js_error)
    }

    /// Set one committed user-facing value using the canonical tagged JSON value shape.
    pub fn set_json(&mut self, raw_id: &str, value_json: &str) -> Result<(), JsValue> {
        self.core.set_json(raw_id, value_json).map_err(js_error)
    }

    /// Remove the committed durable override of one setting.
    pub fn reset(&mut self, raw_id: &str) -> Result<(), JsValue> {
        self.core.reset(raw_id).map_err(js_error)
    }

    /// Remove the committed durable overrides of a caller-supplied list of settings atomically.
    pub fn reset_many_json(&mut self, ids_json: &str) -> Result<(), JsValue> {
        self.core.reset_many_json(ids_json).map_err(js_error)
    }

    /// Remove every committed durable override in every scope.
    pub fn reset_all(&mut self) {
        self.core.reset_all();
    }

    /// Stage one value without committing it.
    pub fn stage_set_json(&mut self, raw_id: &str, value_json: &str) -> Result<(), JsValue> {
        self.core
            .stage_set_json(raw_id, value_json)
            .map_err(js_error)
    }

    /// Stage removal of the durable overrides of a caller-supplied list of settings atomically.
    pub fn stage_reset_many_json(&mut self, ids_json: &str) -> Result<(), JsValue> {
        self.core.stage_reset_many_json(ids_json).map_err(js_error)
    }

    /// Stage removal of every durable override in every scope.
    pub fn stage_reset_all(&mut self) {
        self.core.stage_reset_all();
    }

    /// Whether any staged layered state differs from the committed state.
    pub fn has_staged_changes(&self) -> bool {
        self.core.has_staged_changes()
    }

    /// Deterministic committed-to-staged value changes.
    pub fn staged_changes_json(&self) -> Result<String, JsValue> {
        self.core.staged_changes_json().map_err(js_error)
    }

    /// Commit the staged state and return the committed value changes.
    pub fn apply_staged_json(&mut self) -> Result<String, JsValue> {
        self.core.apply_staged_json().map_err(js_error)
    }

    /// Discard the staged state and return the staged-to-committed value changes.
    pub fn cancel_staged_json(&mut self) -> Result<String, JsValue> {
        self.core.cancel_staged_json().map_err(js_error)
    }

    /// Replace the caller-supplied capability facts used for availability evaluation.
    pub fn set_capabilities_json(&mut self, facts_json: &str) -> Result<(), JsValue> {
        self.core
            .set_capabilities_json(facts_json)
            .map_err(js_error)
    }

    /// Per-setting staged value, provenance, override, staging and availability status.
    pub fn setting_states_json(&self) -> Result<String, JsValue> {
        self.core.setting_states_json().map_err(js_error)
    }

    /// Replace one persistent scope from a canonical settings snapshot.
    ///
    /// Replacing rather than merging is important: an override that disappears
    /// from a later snapshot must also disappear from the runtime state. Staged changes in that
    /// scope are discarded.
    pub fn import_scope_json(&mut self, raw_scope: &str, json: &str) -> Result<String, JsValue> {
        self.core
            .import_scope_json(raw_scope, json)
            .map_err(js_error)
    }

    pub fn export_scope_json(&self, raw_scope: &str) -> Result<String, JsValue> {
        self.core.export_scope_json(raw_scope).map_err(js_error)
    }
}

fn js_error(error: String) -> JsValue {
    JsValue::from_str(&error)
}
