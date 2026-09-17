use settings_appearance::{
    AppearanceDefaults, AppearanceError, AppearancePreferences, AppearanceSettingIds,
    ColorSchemePreference, ColorVisionAssistMode, ContrastPreference, ResolvedColorScheme,
    ResolvedContrast, SystemAppearance, install_appearance_settings, read_appearance_preferences,
    resolve_appearance, resolve_effective_appearance,
};
use settings_core::{
    ApplyMode, OverrideSource, RegistryError, SettingDefinition, SettingId, SettingKind,
    SettingScope, SettingValue, SettingsRegistry, SettingsState,
};

fn defaults() -> AppearanceDefaults {
    AppearanceDefaults {
        color_scheme: ColorSchemePreference::System,
        contrast: ContrastPreference::System,
        color_vision: ColorVisionAssistMode::Off,
        night_mode: false,
    }
}

#[test]
fn installation_registers_mutually_exclusive_dimensions_as_normal_settings() {
    let mut registry = SettingsRegistry::new();
    let ids = install_appearance_settings(&mut registry, defaults()).unwrap();

    assert_eq!(registry.len(), 4);
    for id in [
        &ids.color_scheme,
        &ids.contrast,
        &ids.color_vision,
        &ids.night_mode,
    ] {
        let definition = registry.get(id).unwrap();
        assert_eq!(definition.scope, SettingScope::User);
        assert_eq!(definition.apply_mode, ApplyMode::Immediate);
    }

    assert_eq!(
        registry.get(&ids.color_scheme).unwrap().kind,
        SettingKind::Choice {
            options: vec!["system".into(), "light".into(), "dark".into()]
        }
    );
    assert_eq!(
        registry.get(&ids.contrast).unwrap().kind,
        SettingKind::Choice {
            options: vec![
                "system".into(),
                "normal".into(),
                "high".into(),
                "low".into(),
            ]
        }
    );
    assert_eq!(
        registry.get(&ids.color_vision).unwrap().kind,
        SettingKind::Choice {
            options: vec![
                "off".into(),
                "protanopia".into(),
                "deuteranopia".into(),
                "tritanopia".into(),
                "achromatopsia".into(),
            ]
        }
    );
    assert_eq!(
        registry.get(&ids.night_mode).unwrap().kind,
        SettingKind::Bool
    );
}

#[test]
fn installation_is_atomic_when_a_canonical_id_already_exists() {
    let mut registry = SettingsRegistry::new();
    let ids = AppearanceSettingIds::canonical();
    registry
        .register(SettingDefinition {
            id: ids.contrast.clone(),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        })
        .unwrap();
    let before = registry.clone();

    let error = install_appearance_settings(&mut registry, defaults()).unwrap_err();

    assert_eq!(registry, before);
    assert!(matches!(error, RegistryError::Duplicate(id) if id == ids.contrast));
}

#[test]
fn effective_overlays_and_system_facts_resolve_independently() {
    let mut registry = SettingsRegistry::new();
    let ids = install_appearance_settings(&mut registry, defaults()).unwrap();
    let mut state = SettingsState::new();

    state
        .set(
            &registry,
            &ids.color_scheme,
            SettingValue::Choice("dark".into()),
        )
        .unwrap();
    state
        .set(
            &registry,
            &ids.contrast,
            SettingValue::Choice("high".into()),
        )
        .unwrap();
    state
        .set(
            &registry,
            &ids.color_vision,
            SettingValue::Choice("deuteranopia".into()),
        )
        .unwrap();
    state
        .set(&registry, &ids.night_mode, SettingValue::Bool(true))
        .unwrap();
    state
        .set_with_source(
            &registry,
            &ids.color_scheme,
            SettingValue::Choice("light".into()),
            OverrideSource::Policy,
        )
        .unwrap();

    let preferences = read_appearance_preferences(&registry, &state).unwrap();
    assert_eq!(
        preferences,
        AppearancePreferences {
            color_scheme: ColorSchemePreference::Light,
            contrast: ContrastPreference::High,
            color_vision: ColorVisionAssistMode::Deuteranopia,
            night_mode: true,
        }
    );

    let resolved = resolve_effective_appearance(
        &registry,
        &state,
        SystemAppearance::known(ResolvedColorScheme::Dark, ResolvedContrast::Low),
    )
    .unwrap();
    assert_eq!(resolved.color_scheme, ResolvedColorScheme::Light);
    assert_eq!(resolved.contrast, ResolvedContrast::High);
    assert_eq!(resolved.color_vision, ColorVisionAssistMode::Deuteranopia);
    assert!(resolved.night_mode);
}

#[test]
fn night_mode_does_not_force_dark_or_replace_explicit_contrast() {
    let resolved = resolve_appearance(
        AppearancePreferences {
            color_scheme: ColorSchemePreference::Light,
            contrast: ContrastPreference::High,
            color_vision: ColorVisionAssistMode::Off,
            night_mode: true,
        },
        SystemAppearance::known(ResolvedColorScheme::Dark, ResolvedContrast::Low),
    )
    .unwrap();

    assert_eq!(resolved.color_scheme, ResolvedColorScheme::Light);
    assert_eq!(resolved.contrast, ResolvedContrast::High);
    assert!(resolved.night_mode);
}

#[test]
fn system_following_fails_closed_when_required_platform_facts_are_unknown() {
    let preferences = AppearancePreferences {
        color_scheme: ColorSchemePreference::System,
        contrast: ContrastPreference::System,
        color_vision: ColorVisionAssistMode::Off,
        night_mode: false,
    };

    assert_eq!(
        resolve_appearance(
            preferences,
            SystemAppearance {
                color_scheme: None,
                contrast: Some(ResolvedContrast::Normal),
            },
        )
        .unwrap_err(),
        AppearanceError::MissingSystemColorScheme
    );
    assert_eq!(
        resolve_appearance(
            preferences,
            SystemAppearance {
                color_scheme: Some(ResolvedColorScheme::Light),
                contrast: None,
            },
        )
        .unwrap_err(),
        AppearanceError::MissingSystemContrast
    );
}

#[test]
fn appearance_types_have_stable_snake_case_serialization() {
    let preferences = AppearancePreferences {
        color_scheme: ColorSchemePreference::Dark,
        contrast: ContrastPreference::Low,
        color_vision: ColorVisionAssistMode::Tritanopia,
        night_mode: true,
    };

    assert_eq!(
        serde_json::to_value(preferences).unwrap(),
        serde_json::json!({
            "color_scheme": "dark",
            "contrast": "low",
            "color_vision": "tritanopia",
            "night_mode": true,
        })
    );
}

#[test]
fn missing_or_incompatible_settings_fail_closed() {
    let registry = SettingsRegistry::new();
    assert_eq!(
        read_appearance_preferences(&registry, &SettingsState::new()).unwrap_err(),
        AppearanceError::MissingSetting(SettingId::new("appearance.color_scheme").unwrap())
    );
}
