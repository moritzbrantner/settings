use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use settings_core::{SettingId, SettingsRegistry};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum LocalizationKeyError {
    #[error("localization key cannot be empty")]
    Empty,
    #[error("localization key `{0}` contains leading or trailing whitespace")]
    SurroundingWhitespace(String),
}

/// Stable key resolved by the consuming application's localization system.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct LocalizationKey(String);

impl LocalizationKey {
    pub fn new(value: impl Into<String>) -> Result<Self, LocalizationKeyError> {
        let value = value.into();
        if value.is_empty() {
            return Err(LocalizationKeyError::Empty);
        }
        if value.trim() != value {
            return Err(LocalizationKeyError::SurroundingWhitespace(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for LocalizationKey {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(D::Error::custom)
    }
}

impl Display for LocalizationKey {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Controls where a setting is surfaced without changing its core availability semantics.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Discoverability {
    #[default]
    Primary,
    Advanced,
    SearchOnly,
}

/// Presentation-only metadata for one ordinary `settings-core` setting.
///
/// All user-facing text is represented by localization keys. The consuming UI resolves those keys
/// to localized strings and remains free to choose platform-native controls and layout.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationMetadata {
    pub label_key: LocalizationKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_key: Option<LocalizationKey>,
    pub category_key: LocalizationKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_key: Option<LocalizationKey>,
    #[serde(default)]
    pub order: i32,
    #[serde(default)]
    pub discoverability: Discoverability,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub search_keys: BTreeSet<LocalizationKey>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationEntry {
    pub id: SettingId,
    pub metadata: PresentationMetadata,
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum PresentationRegistryError {
    #[error("cannot attach presentation metadata to unknown setting `{0}`")]
    UnknownSetting(SettingId),
    #[error("presentation metadata is already registered for `{0}`")]
    Duplicate(SettingId),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PresentationRegistry {
    metadata: BTreeMap<SettingId, PresentationMetadata>,
}

impl PresentationRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_entries(
        settings: &SettingsRegistry,
        entries: impl IntoIterator<Item = PresentationEntry>,
    ) -> Result<Self, PresentationRegistryError> {
        let mut registry = Self::new();
        for entry in entries {
            registry.register(settings, entry.id, entry.metadata)?;
        }
        Ok(registry)
    }

    pub fn register(
        &mut self,
        settings: &SettingsRegistry,
        id: SettingId,
        metadata: PresentationMetadata,
    ) -> Result<(), PresentationRegistryError> {
        if settings.get(&id).is_none() {
            return Err(PresentationRegistryError::UnknownSetting(id));
        }
        if self.metadata.contains_key(&id) {
            return Err(PresentationRegistryError::Duplicate(id));
        }
        self.metadata.insert(id, metadata);
        Ok(())
    }

    pub fn get(&self, id: &SettingId) -> Option<&PresentationMetadata> {
        self.metadata.get(id)
    }

    pub fn ordered_entries(&self) -> Vec<PresentationEntry> {
        let mut entries = self
            .metadata
            .iter()
            .map(|(id, metadata)| PresentationEntry {
                id: id.clone(),
                metadata: metadata.clone(),
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            left.metadata
                .category_key
                .cmp(&right.metadata.category_key)
                .then_with(|| left.metadata.group_key.cmp(&right.metadata.group_key))
                .then_with(|| left.metadata.order.cmp(&right.metadata.order))
                .then_with(|| left.id.cmp(&right.id))
        });
        entries
    }
}
