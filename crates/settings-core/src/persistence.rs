use crate::{PersistenceError, SettingId, SettingValue, SettingsRegistry, SettingsState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct StoredSettings {
    schema_version: u32,
    overrides: BTreeMap<SettingId, SettingValue>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LoadDiagnostic {
    UnknownSetting { id: SettingId },
    InvalidValue { id: SettingId, reason: String },
}

#[derive(Clone, Debug, PartialEq)]
pub struct LoadReport {
    pub state: SettingsState,
    pub diagnostics: Vec<LoadDiagnostic>,
}

pub fn encode_json(state: &SettingsState) -> Result<String, PersistenceError> {
    let stored = StoredSettings {
        schema_version: CURRENT_SCHEMA_VERSION,
        overrides: state
            .overrides()
            .map(|(id, value)| (id.clone(), value.clone()))
            .collect(),
    };
    Ok(serde_json::to_string_pretty(&stored)?)
}

pub fn decode_json(
    registry: &SettingsRegistry,
    json: &str,
) -> Result<LoadReport, PersistenceError> {
    let stored: StoredSettings = serde_json::from_str(json)?;
    if stored.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(PersistenceError::UnsupportedSchemaVersion {
            found: stored.schema_version,
            supported: CURRENT_SCHEMA_VERSION,
        });
    }

    let mut state = SettingsState::new();
    let mut diagnostics = Vec::new();

    for (id, value) in stored.overrides {
        if registry.get(&id).is_none() {
            diagnostics.push(LoadDiagnostic::UnknownSetting { id });
            continue;
        }

        if let Err(error) = state.set(registry, &id, value) {
            diagnostics.push(LoadDiagnostic::InvalidValue {
                id,
                reason: error.to_string(),
            });
        }
    }

    Ok(LoadReport { state, diagnostics })
}
