use serde::{Deserialize, Serialize};
use settings_core::{SettingId, SettingsRegistry};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

/// Cross-cutting accessibility concerns a setting can affect.
///
/// A setting may carry several tags; these are semantic facets rather than mutually exclusive UI
/// categories.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum AccessibilityTag {
    Motion,
    Captions,
    Contrast,
    AudioCues,
    Timing,
    Haptics,
    Input,
    TextPresentation,
}

/// Importance when an application chooses to present accessibility options before normal
/// navigation. Whether the application is actually in a first-launch/bootstrap flow remains a
/// caller-owned decision.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum AccessibilityBootstrapPriority {
    Critical,
    Recommended,
}

/// Machine-readable accessibility metadata for a normal settings-core setting.
///
/// Localization keys, category layout, search keywords, and general ordering remain part of the
/// later presentation-model slice. This type only carries accessibility-specific semantics.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessibilityPresentationMetadata {
    pub tags: BTreeSet<AccessibilityTag>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bootstrap_priority: Option<AccessibilityBootstrapPriority>,
}

impl AccessibilityPresentationMetadata {
    pub fn new(tags: impl IntoIterator<Item = AccessibilityTag>) -> Self {
        Self {
            tags: tags.into_iter().collect(),
            bootstrap_priority: None,
        }
    }

    pub fn with_bootstrap_priority(mut self, priority: AccessibilityBootstrapPriority) -> Self {
        self.bootstrap_priority = Some(priority);
        self
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum AccessibilityMetadataError {
    #[error("cannot attach accessibility metadata to unknown setting `{0}`")]
    UnknownSetting(SettingId),
    #[error("accessibility metadata for `{0}` requires at least one semantic tag")]
    EmptyTags(SettingId),
    #[error("accessibility metadata is already registered for `{0}`")]
    Duplicate(SettingId),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AccessibilityRegistry {
    metadata: BTreeMap<SettingId, AccessibilityPresentationMetadata>,
}

impl AccessibilityRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &mut self,
        settings: &SettingsRegistry,
        id: SettingId,
        metadata: AccessibilityPresentationMetadata,
    ) -> Result<(), AccessibilityMetadataError> {
        if settings.get(&id).is_none() {
            return Err(AccessibilityMetadataError::UnknownSetting(id));
        }
        if metadata.tags.is_empty() {
            return Err(AccessibilityMetadataError::EmptyTags(id));
        }
        if self.metadata.contains_key(&id) {
            return Err(AccessibilityMetadataError::Duplicate(id));
        }
        self.metadata.insert(id, metadata);
        Ok(())
    }

    pub fn get(&self, id: &SettingId) -> Option<&AccessibilityPresentationMetadata> {
        self.metadata.get(id)
    }

    pub fn iter(
        &self,
    ) -> impl Iterator<Item = (&SettingId, &AccessibilityPresentationMetadata)> {
        self.metadata.iter()
    }

    pub fn bootstrap_candidates(&self) -> Vec<AccessibilityBootstrapCandidate> {
        let mut candidates: Vec<_> = self
            .metadata
            .iter()
            .filter_map(|(id, metadata)| {
                Some(AccessibilityBootstrapCandidate {
                    id: id.clone(),
                    priority: metadata.bootstrap_priority?,
                    tags: metadata.tags.clone(),
                })
            })
            .collect();
        candidates.sort_by(|left, right| {
            left.priority
                .cmp(&right.priority)
                .then_with(|| left.id.cmp(&right.id))
        });
        candidates
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessibilityBootstrapCandidate {
    pub id: SettingId,
    pub priority: AccessibilityBootstrapPriority,
    pub tags: BTreeSet<AccessibilityTag>,
}
