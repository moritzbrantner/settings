use crate::{
    OverrideSource, SettingChange, SettingId, SettingValue, SettingsRegistry, SettingsState,
    ValidationError, diff,
};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum PresetIdError {
    #[error("preset id cannot be empty")]
    Empty,
    #[error("preset id `{0}` contains leading or trailing whitespace")]
    SurroundingWhitespace(String),
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct PresetId(String);

impl PresetId {
    pub fn new(value: impl Into<String>) -> Result<Self, PresetIdError> {
        let value = value.into();
        if value.is_empty() {
            return Err(PresetIdError::Empty);
        }
        if value.trim() != value {
            return Err(PresetIdError::SurroundingWhitespace(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for PresetId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(D::Error::custom)
    }
}

impl Display for PresetId {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SettingsPreset {
    pub id: PresetId,
    pub values: BTreeMap<SettingId, SettingValue>,
}

impl SettingsPreset {
    pub fn new(id: PresetId) -> Self {
        Self {
            id,
            values: BTreeMap::new(),
        }
    }

    pub fn insert(&mut self, id: SettingId, value: SettingValue) -> Option<SettingValue> {
        self.values.insert(id, value)
    }
}

pub fn apply_preset(
    registry: &SettingsRegistry,
    state: &mut SettingsState,
    preset: &SettingsPreset,
) -> Result<Vec<SettingChange>, ValidationError> {
    let before = state.clone();
    let mut candidate = state.clone();

    for (id, value) in &preset.values {
        candidate.set_with_source(registry, id, value.clone(), OverrideSource::Preset)?;
    }

    let changes = diff(registry, &before, &candidate);
    *state = candidate;
    Ok(changes)
}
