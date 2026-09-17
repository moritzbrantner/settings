use crate::{
    AccessibilityBootstrapPriority, AccessibilityMetadataError, AccessibilityPresentationMetadata,
    AccessibilityRegistry, AccessibilityTag,
};
use settings_appearance::AppearanceSettingIds;
use settings_core::SettingsRegistry;

/// Atomically attaches accessibility semantics to the canonical appearance settings.
///
/// General light/dark preference remains an appearance concern, while contrast, color-vision
/// assistance, and low-light presentation are discoverable through the cross-cutting
/// accessibility registry. The helper does not apply palettes or visual transforms.
pub fn register_appearance_accessibility_metadata(
    settings: &SettingsRegistry,
    accessibility: &mut AccessibilityRegistry,
    ids: &AppearanceSettingIds,
) -> Result<(), AccessibilityMetadataError> {
    let mut candidate = accessibility.clone();

    candidate.register(
        settings,
        ids.color_scheme.clone(),
        AccessibilityPresentationMetadata::new([AccessibilityTag::LightSensitivity])
            .with_bootstrap_priority(AccessibilityBootstrapPriority::Recommended),
    )?;
    candidate.register(
        settings,
        ids.contrast.clone(),
        AccessibilityPresentationMetadata::new([AccessibilityTag::Contrast])
            .with_bootstrap_priority(AccessibilityBootstrapPriority::Critical),
    )?;
    candidate.register(
        settings,
        ids.color_vision.clone(),
        AccessibilityPresentationMetadata::new([AccessibilityTag::ColorVision])
            .with_bootstrap_priority(AccessibilityBootstrapPriority::Critical),
    )?;
    candidate.register(
        settings,
        ids.night_mode.clone(),
        AccessibilityPresentationMetadata::new([AccessibilityTag::LightSensitivity])
            .with_bootstrap_priority(AccessibilityBootstrapPriority::Recommended),
    )?;

    *accessibility = candidate;
    Ok(())
}
