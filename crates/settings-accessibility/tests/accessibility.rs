use settings_accessibility::{
    AccessibilityBootstrapPriority, AccessibilityMetadataError, AccessibilityPresentationMetadata,
    AccessibilityPresetError, AccessibilityRegistry, AccessibilityTag,
    analyze_accessibility_preset,
};
use settings_core::{
    ApplyMode, OverrideSource, PresetId, SettingDefinition, SettingId, SettingKind, SettingScope,
    SettingValue, SettingsPreset, SettingsRegistry, SettingsState, ValueProvenance, apply_preset,
};
use std::collections::BTreeSet;

fn id(value: &str) -> SettingId {
    SettingId::new(value).unwrap()
}

fn settings_registry() -> SettingsRegistry {
    let mut registry = SettingsRegistry::new();
    for definition in [
        SettingDefinition {
            id: id("accessibility.reduce_motion"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        },
        SettingDefinition {
            id: id("accessibility.captions"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        },
        SettingDefinition {
            id: id("accessibility.high_contrast"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        },
        SettingDefinition {
            id: id("gameplay.difficulty"),
            kind: SettingKind::Choice {
                options: vec!["easy".into(), "normal".into(), "hard".into()],
            },
            default: SettingValue::Choice("normal".into()),
            scope: SettingScope::Save,
            apply_mode: ApplyMode::Apply,
            availability: None,
        },
    ] {
        registry.register(definition).unwrap();
    }
    registry
}

fn accessibility_registry(settings: &SettingsRegistry) -> AccessibilityRegistry {
    let mut accessibility = AccessibilityRegistry::new();
    accessibility
        .register(
            settings,
            id("accessibility.reduce_motion"),
            AccessibilityPresentationMetadata::new([
                AccessibilityTag::Motion,
                AccessibilityTag::Input,
            ])
            .with_bootstrap_priority(AccessibilityBootstrapPriority::Critical),
        )
        .unwrap();
    accessibility
        .register(
            settings,
            id("accessibility.captions"),
            AccessibilityPresentationMetadata::new([
                AccessibilityTag::Captions,
                AccessibilityTag::AudioCues,
            ])
            .with_bootstrap_priority(AccessibilityBootstrapPriority::Recommended),
        )
        .unwrap();
    accessibility
        .register(
            settings,
            id("accessibility.high_contrast"),
            AccessibilityPresentationMetadata::new([AccessibilityTag::Contrast])
                .with_bootstrap_priority(AccessibilityBootstrapPriority::Critical),
        )
        .unwrap();
    accessibility
}

#[test]
fn metadata_is_cross_cutting_machine_readable_and_bootstrap_order_is_deterministic() {
    let settings = settings_registry();
    let accessibility = accessibility_registry(&settings);
    let metadata = accessibility
        .get(&id("accessibility.reduce_motion"))
        .unwrap();

    assert_eq!(
        metadata.tags,
        BTreeSet::from([AccessibilityTag::Motion, AccessibilityTag::Input])
    );
    let json = serde_json::to_value(metadata).unwrap();
    assert_eq!(json["bootstrap_priority"], "critical");
    assert_eq!(json["tags"], serde_json::json!(["motion", "input"]));

    let candidates = accessibility.bootstrap_candidates();
    assert_eq!(
        candidates
            .iter()
            .map(|candidate| candidate.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "accessibility.high_contrast",
            "accessibility.reduce_motion",
            "accessibility.captions",
        ]
    );
    assert_eq!(
        candidates[0].priority,
        AccessibilityBootstrapPriority::Critical
    );
    assert_eq!(
        candidates[2].priority,
        AccessibilityBootstrapPriority::Recommended
    );
}

#[test]
fn metadata_registration_fails_closed_for_unknown_empty_or_duplicate_entries() {
    let settings = settings_registry();
    let mut accessibility = AccessibilityRegistry::new();

    assert_eq!(
        accessibility
            .register(
                &settings,
                id("missing.setting"),
                AccessibilityPresentationMetadata::new([AccessibilityTag::Motion]),
            )
            .unwrap_err(),
        AccessibilityMetadataError::UnknownSetting(id("missing.setting"))
    );
    assert_eq!(
        accessibility
            .register(
                &settings,
                id("accessibility.captions"),
                AccessibilityPresentationMetadata::new([]),
            )
            .unwrap_err(),
        AccessibilityMetadataError::EmptyTags(id("accessibility.captions"))
    );

    accessibility
        .register(
            &settings,
            id("accessibility.captions"),
            AccessibilityPresentationMetadata::new([AccessibilityTag::Captions]),
        )
        .unwrap();
    assert_eq!(
        accessibility
            .register(
                &settings,
                id("accessibility.captions"),
                AccessibilityPresentationMetadata::new([AccessibilityTag::AudioCues]),
            )
            .unwrap_err(),
        AccessibilityMetadataError::Duplicate(id("accessibility.captions"))
    );
}

#[test]
fn accessibility_presets_are_normal_settings_presets_with_explicit_choice_explanations() {
    let settings = settings_registry();
    let accessibility = accessibility_registry(&settings);
    let reduce_motion = id("accessibility.reduce_motion");
    let captions = id("accessibility.captions");
    let mut state = SettingsState::new();
    state
        .set(&settings, &reduce_motion, SettingValue::Bool(true))
        .unwrap();
    state
        .set_with_source(
            &settings,
            &reduce_motion,
            SettingValue::Bool(false),
            OverrideSource::Policy,
        )
        .unwrap();

    let mut preset = SettingsPreset::new(PresetId::new("accessible-comfort").unwrap());
    preset.insert(reduce_motion.clone(), SettingValue::Bool(false));
    preset.insert(captions.clone(), SettingValue::Bool(true));

    let impact = analyze_accessibility_preset(&settings, &state, &accessibility, &preset).unwrap();
    assert!(impact.has_explicit_choice_conflicts());
    assert_eq!(impact.explicit_choice_conflicts().count(), 1);

    let reduce_impact = impact
        .entries
        .iter()
        .find(|entry| entry.id == reduce_motion)
        .unwrap();
    assert_eq!(reduce_impact.current_preference, SettingValue::Bool(true));
    assert_eq!(
        reduce_impact.current_preference_source,
        Some(OverrideSource::UserOverride)
    );
    assert_eq!(reduce_impact.proposed, SettingValue::Bool(false));
    assert_eq!(reduce_impact.effective_value, SettingValue::Bool(false));
    assert_eq!(reduce_impact.effective_provenance, ValueProvenance::Policy);
    assert!(reduce_impact.overwrites_explicit_user_choice);

    let changes = apply_preset(&settings, &mut state, &preset).unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].id, captions);
    assert_eq!(
        state.effective_provenance(&settings, &id("accessibility.captions")),
        Some(ValueProvenance::Preset)
    );
    assert_eq!(state.override_source(&reduce_motion), None);
    assert_eq!(
        state.effective_provenance(&settings, &reduce_motion),
        Some(ValueProvenance::Policy)
    );
}

#[test]
fn accessibility_preset_analysis_rejects_untagged_targets_before_returning_impact() {
    let settings = settings_registry();
    let accessibility = accessibility_registry(&settings);
    let mut preset = SettingsPreset::new(PresetId::new("invalid-accessibility-preset").unwrap());
    preset.insert(id("accessibility.captions"), SettingValue::Bool(true));
    preset.insert(
        id("gameplay.difficulty"),
        SettingValue::Choice("easy".into()),
    );

    let error =
        analyze_accessibility_preset(&settings, &SettingsState::new(), &accessibility, &preset)
            .unwrap_err();

    assert!(matches!(
        error,
        AccessibilityPresetError::UntaggedSetting(ref setting)
            if setting == &id("gameplay.difficulty")
    ));
}
