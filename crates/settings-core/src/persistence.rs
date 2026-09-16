use crate::error::PersistenceError;
use crate::model::{SettingId, SettingScope, SettingValue};
use crate::registry::SettingsRegistry;
use crate::state::{OverrideSource, SettingsState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const CURRENT_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Deserialize)]
struct VersionProbe {
    schema_version: u32,
}

#[derive(Debug, Deserialize)]
struct StoredSettingsV1 {
    schema_version: u32,
    overrides: BTreeMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredSettingsV2 {
    schema_version: u32,
    scope: SettingScope,
    overrides: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PreservedEntries {
    entries: BTreeMap<String, Value>,
}

impl PreservedEntries {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.entries.iter().map(|(id, value)| (id.as_str(), value))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MigrationRecord {
    pub from_version: u32,
    pub to_version: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LoadDiagnostic {
    UnknownSettingPreserved {
        id: SettingId,
    },
    InvalidValue {
        id: SettingId,
        reason: String,
    },
    CorruptValue {
        id: SettingId,
        reason: String,
    },
    InvalidIdentifier {
        raw_id: String,
        reason: String,
    },
    ScopeMismatch {
        id: SettingId,
        expected: SettingScope,
        actual: SettingScope,
    },
    LegacyUnknownEntryDropped {
        id: SettingId,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct LoadReport {
    pub scope: SettingScope,
    pub state: SettingsState,
    pub diagnostics: Vec<LoadDiagnostic>,
    pub preserved_entries: PreservedEntries,
    pub migrations: Vec<MigrationRecord>,
}

pub fn export_scope_json(
    registry: &SettingsRegistry,
    state: &SettingsState,
    scope: SettingScope,
    preserved_entries: &PreservedEntries,
) -> Result<String, PersistenceError> {
    ensure_persistent_scope(scope)?;

    let mut overrides = BTreeMap::new();
    for (raw_id, value) in &preserved_entries.entries {
        let Ok(id) = SettingId::new(raw_id.clone()) else {
            continue;
        };
        if registry.get(&id).is_none() {
            overrides.insert(raw_id.clone(), value.clone());
        }
    }

    for (id, setting_override) in state.overrides_with_sources() {
        let Some(definition) = registry.get(id) else {
            continue;
        };
        if definition.scope != scope
            || definition.validate_value(&setting_override.value).is_err()
            || !setting_override.source.is_persistable()
        {
            continue;
        }
        overrides.insert(
            id.to_string(),
            serde_json::to_value(&setting_override.value)?,
        );
    }

    let stored = StoredSettingsV2 {
        schema_version: CURRENT_SCHEMA_VERSION,
        scope,
        overrides,
    };
    Ok(serde_json::to_string_pretty(&stored)?)
}

pub fn import_scope_json(
    registry: &SettingsRegistry,
    expected_scope: SettingScope,
    json: &str,
) -> Result<LoadReport, PersistenceError> {
    ensure_persistent_scope(expected_scope)?;

    let document: Value = serde_json::from_str(json)?;
    let probe: VersionProbe = serde_json::from_value(document.clone())?;
    let mut diagnostics = Vec::new();
    let mut migrations = Vec::new();
    let document = migrate_to_current(
        registry,
        expected_scope,
        document,
        probe.schema_version,
        &mut diagnostics,
        &mut migrations,
    )?;

    let stored: StoredSettingsV2 = serde_json::from_value(document)?;
    if stored.scope != expected_scope {
        return Err(PersistenceError::ScopeMismatch {
            expected: expected_scope,
            found: stored.scope,
        });
    }

    let source = migrations
        .first()
        .map(|migration| OverrideSource::Migration {
            from_version: migration.from_version,
        })
        .unwrap_or(OverrideSource::UserOverride);
    let mut state = SettingsState::new();
    let mut preserved_entries = PreservedEntries::new();

    for (raw_id, raw_value) in stored.overrides {
        let id = match SettingId::new(raw_id.clone()) {
            Ok(id) => id,
            Err(error) => {
                diagnostics.push(LoadDiagnostic::InvalidIdentifier {
                    raw_id,
                    reason: error.to_string(),
                });
                continue;
            }
        };

        let Some(definition) = registry.get(&id) else {
            preserved_entries.entries.insert(raw_id, raw_value);
            diagnostics.push(LoadDiagnostic::UnknownSettingPreserved { id });
            continue;
        };

        if definition.scope != expected_scope {
            diagnostics.push(LoadDiagnostic::ScopeMismatch {
                id,
                expected: expected_scope,
                actual: definition.scope,
            });
            continue;
        }

        let value: SettingValue = match serde_json::from_value(raw_value) {
            Ok(value) => value,
            Err(error) => {
                diagnostics.push(LoadDiagnostic::CorruptValue {
                    id,
                    reason: error.to_string(),
                });
                continue;
            }
        };

        if let Err(error) = state.set_with_source(registry, &id, value, source.clone()) {
            diagnostics.push(LoadDiagnostic::InvalidValue {
                id,
                reason: error.to_string(),
            });
        }
    }

    Ok(LoadReport {
        scope: expected_scope,
        state,
        diagnostics,
        preserved_entries,
        migrations,
    })
}

fn migrate_to_current(
    registry: &SettingsRegistry,
    expected_scope: SettingScope,
    mut document: Value,
    mut version: u32,
    diagnostics: &mut Vec<LoadDiagnostic>,
    migrations: &mut Vec<MigrationRecord>,
) -> Result<Value, PersistenceError> {
    if version > CURRENT_SCHEMA_VERSION {
        return Err(PersistenceError::UnsupportedSchemaVersion {
            found: version,
            supported: CURRENT_SCHEMA_VERSION,
        });
    }

    while version < CURRENT_SCHEMA_VERSION {
        match version {
            1 => {
                document = migrate_v1_to_v2(registry, expected_scope, document, diagnostics)?;
                migrations.push(MigrationRecord {
                    from_version: 1,
                    to_version: 2,
                });
                version = 2;
            }
            _ => {
                return Err(PersistenceError::UnsupportedSchemaVersion {
                    found: version,
                    supported: CURRENT_SCHEMA_VERSION,
                });
            }
        }
    }

    Ok(document)
}

fn migrate_v1_to_v2(
    registry: &SettingsRegistry,
    expected_scope: SettingScope,
    document: Value,
    diagnostics: &mut Vec<LoadDiagnostic>,
) -> Result<Value, PersistenceError> {
    let legacy: StoredSettingsV1 = serde_json::from_value(document)?;
    debug_assert_eq!(legacy.schema_version, 1);

    let mut overrides = BTreeMap::new();
    for (raw_id, raw_value) in legacy.overrides {
        let id = match SettingId::new(raw_id.clone()) {
            Ok(id) => id,
            Err(error) => {
                diagnostics.push(LoadDiagnostic::InvalidIdentifier {
                    raw_id,
                    reason: error.to_string(),
                });
                continue;
            }
        };

        let Some(definition) = registry.get(&id) else {
            diagnostics.push(LoadDiagnostic::LegacyUnknownEntryDropped { id });
            continue;
        };

        if definition.scope == expected_scope {
            overrides.insert(raw_id, raw_value);
        }
    }

    Ok(serde_json::to_value(StoredSettingsV2 {
        schema_version: 2,
        scope: expected_scope,
        overrides,
    })?)
}

fn ensure_persistent_scope(scope: SettingScope) -> Result<(), PersistenceError> {
    if scope == SettingScope::Session {
        Err(PersistenceError::NonPersistentScope(scope))
    } else {
        Ok(())
    }
}
