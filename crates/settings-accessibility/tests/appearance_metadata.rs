use settings_accessibility::{
    AccessibilityBootstrapPriority, AccessibilityMetadataError, AccessibilityRegistry,
    AccessibilityTag, register_appearance_accessibility_metadata,
};
use settings_appearance::{
    AppearanceDefaults, ColorSchemePreference, ColorVisionAssistMode, ContrastPreference,
    install_appearance_settings,
};
use settings_core::SettingsRegistry;
use std::collections::BTreeSet;

fn defaults() -> AppearanceDefaults {
    AppearanceDefaults {
        color_scheme: ColorSchemePreference::System,
        contrast: ContrastPreference::System,
        color_vision: ColorVisionAssistMode::Off,
        night_mode: false,
    }
}

#[test]
fn canonical_appearance_settings_get_cross_cutting_accessibility_metadata() {
    let mut settings = SettingsRegistry::new();
    let ids = install_appearance_settings(&mut settings, defaults()).unwrap();
    let mut accessibility = AccessibilityRegistry::new();

    register_appearance_accessibility_metadata(&settings, &mut accessibility, &ids).unwrap();

    assert_eq!(
        accessibility.get(&ids.color_scheme).unwrap().tags,
        BTreeSet::from([AccessibilityTag::LightSensitivity])
    );
    assert_eq!(
        accessibility.get(&ids.contrast).unwrap().tags,
        BTreeSet::from([AccessibilityTag::Contrast])
    );
    assert_eq!(
        accessibility.get(&ids.color_vision).unwrap().tags,
        BTreeSet::from([AccessibilityTag::ColorVision])
    );
    assert_eq!(
        accessibility.get(&ids.night_mode).unwrap().tags,
        BTreeSet::from([AccessibilityTag::LightSensitivity])
    );

    assert_eq!(
        accessibility.get(&ids.contrast).unwrap().bootstrap_priority,
        Some(AccessibilityBootstrapPriority::Critical)
    );
    assert_eq!(
        accessibility
            .get(&ids.color_vision)
            .unwrap()
            .bootstrap_priority,
        Some(AccessibilityBootstrapPriority::Critical)
    );
}

#[test]
fn appearance_metadata_registration_is_atomic_when_settings_are_incomplete() {
    let settings = SettingsRegistry::new();
    let ids = settings_appearance::AppearanceSettingIds::canonical();
    let mut accessibility = AccessibilityRegistry::new();
    let before = accessibility.clone();

    let error = register_appearance_accessibility_metadata(&settings, &mut accessibility, &ids)
        .unwrap_err();

    assert_eq!(accessibility, before);
    assert_eq!(
        error,
        AccessibilityMetadataError::UnknownSetting(ids.color_scheme)
    );
}

#[test]
fn new_visual_accessibility_tags_serialize_stably() {
    assert_eq!(
        serde_json::to_value(AccessibilityTag::ColorVision).unwrap(),
        serde_json::json!("color_vision")
    );
    assert_eq!(
        serde_json::to_value(AccessibilityTag::LightSensitivity).unwrap(),
        serde_json::json!("light_sensitivity")
    );
}
