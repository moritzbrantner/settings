use crate::{AccessibilityPresentationMetadata, AccessibilityRegistry};
use settings_core::{
    OverrideSource, SettingId, SettingValue, SettingsPreset, SettingsRegistry, SettingsState,
    ValidationError, ValueProvenance,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AccessibilityPresetError {
    #[error(transparent)]
    Validation(#[from] ValidationError),
    #[error("accessibility preset references untagged setting `{0}`")]
    UntaggedSetting(SettingId),
}

/// Machine-readable explanation of what an accessibility preset would do to one preference.
///
/// `current_preference` is the durable preference beneath transient policy/command-line/session
/// layers. `effective_value` and `effective_provenance` describe what is active right now, which
/// lets a UI explain that a saved preference may remain masked by runtime policy.
#[derive(Clone, Debug, PartialEq)]
pub struct AccessibilityPresetImpactEntry {
    pub id: SettingId,
    pub metadata: AccessibilityPresentationMetadata,
    pub current_preference: SettingValue,
    pub current_preference_source: Option<OverrideSource>,
    pub proposed: SettingValue,
    pub effective_value: SettingValue,
    pub effective_provenance: ValueProvenance,
    pub overwrites_explicit_user_choice: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct AccessibilityPresetImpact {
    pub entries: Vec<AccessibilityPresetImpactEntry>,
}

impl AccessibilityPresetImpact {
    pub fn has_explicit_choice_conflicts(&self) -> bool {
        self.entries
            .iter()
            .any(|entry| entry.overwrites_explicit_user_choice)
    }

    pub fn explicit_choice_conflicts(
        &self,
    ) -> impl Iterator<Item = &AccessibilityPresetImpactEntry> {
        self.entries
            .iter()
            .filter(|entry| entry.overwrites_explicit_user_choice)
    }
}

/// Validates and explains an accessibility preset without applying it.
///
/// The preset is an ordinary `SettingsPreset`; this crate deliberately introduces no parallel
/// preset type or value store. Every target must be accessibility-tagged so an accessibility
/// preset cannot silently change unrelated preferences.
pub fn analyze_accessibility_preset(
    settings: &SettingsRegistry,
    state: &SettingsState,
    accessibility: &AccessibilityRegistry,
    preset: &SettingsPreset,
) -> Result<AccessibilityPresetImpact, AccessibilityPresetError> {
    for (id, proposed) in &preset.values {
        let definition = settings
            .get(id)
            .ok_or_else(|| ValidationError::UnknownSetting(id.clone()))?;
        definition.validate_value(proposed)?;
        if accessibility.get(id).is_none() {
            return Err(AccessibilityPresetError::UntaggedSetting(id.clone()));
        }
    }

    let mut entries = Vec::with_capacity(preset.values.len());
    for (id, proposed) in &preset.values {
        let definition = settings
            .get(id)
            .expect("preset targets were validated in the first pass");
        let metadata = accessibility
            .get(id)
            .expect("preset accessibility metadata was validated in the first pass")
            .clone();
        let current_preference = state
            .override_value(id)
            .cloned()
            .unwrap_or_else(|| definition.default.clone());
        let current_preference_source = state.override_source(id).cloned();
        let effective_value = state
            .effective_value(settings, id)
            .expect("registered settings always have an effective value")
            .clone();
        let effective_provenance = state
            .effective_provenance(settings, id)
            .expect("registered settings always have effective provenance");
        let overwrites_explicit_user_choice = matches!(
            current_preference_source.as_ref(),
            Some(OverrideSource::UserOverride)
        ) && &current_preference != proposed;

        entries.push(AccessibilityPresetImpactEntry {
            id: id.clone(),
            metadata,
            current_preference,
            current_preference_source,
            proposed: proposed.clone(),
            effective_value,
            effective_provenance,
            overwrites_explicit_user_choice,
        });
    }

    Ok(AccessibilityPresetImpact { entries })
}
