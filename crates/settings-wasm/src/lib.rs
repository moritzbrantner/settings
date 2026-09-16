//! Narrow WebAssembly transport for `settings-core`.
//!
//! The browser boundary intentionally transports JSON strings. Validation,
//! defaulting, scope ownership, persistence, and migration remain implemented
//! by `settings-core`; web consumers do not get a second settings engine.

use settings_core::{
    PreservedEntries, SettingDefinition, SettingId, SettingScope, SettingValue, SettingsRegistry,
    SettingsState, export_scope_json, import_scope_json,
};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SettingsSession {
    registry: SettingsRegistry,
    scope_states: BTreeMap<SettingScope, SettingsState>,
    preserved_entries: BTreeMap<SettingScope, PreservedEntries>,
}

#[wasm_bindgen]
impl SettingsSession {
    #[wasm_bindgen(constructor)]
    pub fn new(definitions_json: &str) -> Result<Self, JsValue> {
        let definitions: Vec<SettingDefinition> =
            serde_json::from_str(definitions_json).map_err(js_error)?;
        let mut registry = SettingsRegistry::new();
        for definition in definitions {
            registry.register(definition).map_err(js_error)?;
        }

        Ok(Self {
            registry,
            scope_states: BTreeMap::new(),
            preserved_entries: BTreeMap::new(),
        })
    }

    /// Return every effective value keyed by stable setting id.
    ///
    /// Values retain the tagged `SettingValue` wire representation so browser
    /// adapters cannot accidentally erase type information.
    pub fn effective_values_json(&self) -> Result<String, JsValue> {
        let values = self
            .registry
            .iter()
            .map(|(id, definition)| {
                let value = self
                    .scope_states
                    .get(&definition.scope)
                    .and_then(|state| state.effective_value(&self.registry, id))
                    .unwrap_or(&definition.default)
                    .clone();
                (id.to_string(), value)
            })
            .collect::<BTreeMap<_, _>>();

        serde_json::to_string(&values).map_err(js_error)
    }

    /// Set one user-facing value using the canonical tagged JSON value shape.
    pub fn set_json(&mut self, raw_id: &str, value_json: &str) -> Result<(), JsValue> {
        let id = SettingId::new(raw_id).map_err(js_error)?;
        let value: SettingValue = serde_json::from_str(value_json).map_err(js_error)?;
        let scope = self
            .registry
            .get(&id)
            .ok_or_else(|| JsValue::from_str(&format!("unknown setting `{id}`")))?
            .scope;

        self.scope_states
            .entry(scope)
            .or_default()
            .set(&self.registry, &id, value)
            .map_err(js_error)
    }

    pub fn reset(&mut self, raw_id: &str) -> Result<(), JsValue> {
        let id = SettingId::new(raw_id).map_err(js_error)?;
        let scope = self
            .registry
            .get(&id)
            .ok_or_else(|| JsValue::from_str(&format!("unknown setting `{id}`")))?
            .scope;

        self.scope_states
            .entry(scope)
            .or_default()
            .reset(&self.registry, &id)
            .map_err(js_error)
    }

    /// Replace one persistent scope from a canonical settings snapshot.
    ///
    /// Replacing rather than merging is important: an override that disappears
    /// from a later snapshot must also disappear from the runtime state.
    pub fn import_scope_json(&mut self, raw_scope: &str, json: &str) -> Result<String, JsValue> {
        let scope = parse_scope(raw_scope).map_err(js_error)?;
        let report = import_scope_json(&self.registry, scope, json).map_err(js_error)?;
        let diagnostics = report
            .diagnostics
            .iter()
            .map(|diagnostic| format!("{diagnostic:?}"))
            .collect::<Vec<_>>();

        self.scope_states.insert(scope, report.state);
        self.preserved_entries
            .insert(scope, report.preserved_entries);

        serde_json::to_string(&diagnostics).map_err(js_error)
    }

    pub fn export_scope_json(&self, raw_scope: &str) -> Result<String, JsValue> {
        let scope = parse_scope(raw_scope).map_err(js_error)?;
        let empty_state = SettingsState::new();
        let state = self.scope_states.get(&scope).unwrap_or(&empty_state);

        if let Some(preserved_entries) = self.preserved_entries.get(&scope) {
            return export_scope_json(&self.registry, state, scope, preserved_entries)
                .map_err(js_error);
        }

        let preserved_entries = PreservedEntries::new(scope).map_err(js_error)?;
        export_scope_json(&self.registry, state, scope, &preserved_entries).map_err(js_error)
    }
}

fn parse_scope(value: &str) -> Result<SettingScope, String> {
    match value {
        "session" => Ok(SettingScope::Session),
        "save" => Ok(SettingScope::Save),
        "device" => Ok(SettingScope::Device),
        "user" => Ok(SettingScope::User),
        _ => Err(format!("unknown settings scope `{value}`")),
    }
}

fn js_error(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}
