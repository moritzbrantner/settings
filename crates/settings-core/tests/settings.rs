use settings_core::{
    ApplyMode, CURRENT_SCHEMA_VERSION, LoadDiagnostic, PersistenceError, SettingDefinition,
    SettingId, SettingKind, SettingScope, SettingValue, SettingsRegistry, SettingsState,
    ValidationError, decode_json, diff, encode_json,
};

fn id(value: &str) -> SettingId {
    SettingId::new(value).unwrap()
}

fn registry() -> SettingsRegistry {
    let mut registry = SettingsRegistry::new();
    registry
        .register(SettingDefinition {
            id: id("audio.master_volume"),
            kind: SettingKind::Integer { min: 0, max: 100 },
            default: SettingValue::Integer(80),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
        })
        .unwrap();
    registry
        .register(SettingDefinition {
            id: id("video.fullscreen"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
        })
        .unwrap();
    registry
        .register(SettingDefinition {
            id: id("video.quality"),
            kind: SettingKind::Choice {
                options: vec!["low".into(), "medium".into(), "high".into()],
            },
            default: SettingValue::Choice("high".into()),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Restart,
        })
        .unwrap();
    registry
}

#[test]
fn stores_only_values_that_differ_from_consumer_defaults() {
    let registry = registry();
    let setting = id("audio.master_volume");
    let mut state = SettingsState::new();

    state
        .set(&registry, &setting, SettingValue::Integer(65))
        .unwrap();
    assert_eq!(state.override_count(), 1);
    assert_eq!(
        state.effective_value(&registry, &setting),
        Some(&SettingValue::Integer(65))
    );

    state
        .set(&registry, &setting, SettingValue::Integer(80))
        .unwrap();
    assert_eq!(state.override_count(), 0);
    assert_eq!(
        state.effective_value(&registry, &setting),
        Some(&SettingValue::Integer(80))
    );
}

#[test]
fn registry_iteration_is_deterministic_and_not_registration_order() {
    let registry = registry();
    let ids: Vec<_> = registry.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["audio.master_volume", "video.fullscreen", "video.quality"]
    );
}

#[test]
fn validates_type_range_and_choice_before_mutation() {
    let registry = registry();
    let mut state = SettingsState::new();

    let range_error = state
        .set(
            &registry,
            &id("audio.master_volume"),
            SettingValue::Integer(101),
        )
        .unwrap_err();
    assert!(matches!(
        range_error,
        ValidationError::IntegerOutOfRange { .. }
    ));

    let type_error = state
        .set(
            &registry,
            &id("video.fullscreen"),
            SettingValue::Text("yes".into()),
        )
        .unwrap_err();
    assert!(matches!(type_error, ValidationError::TypeMismatch { .. }));

    let choice_error = state
        .set(
            &registry,
            &id("video.quality"),
            SettingValue::Choice("cinematic".into()),
        )
        .unwrap_err();
    assert!(matches!(
        choice_error,
        ValidationError::InvalidChoice { .. }
    ));
    assert_eq!(state.override_count(), 0);
}

#[test]
fn diffs_are_deterministic_and_keep_apply_semantics() {
    let registry = registry();
    let before = SettingsState::new();
    let mut after = SettingsState::new();
    after
        .set(&registry, &id("video.fullscreen"), SettingValue::Bool(true))
        .unwrap();
    after
        .set(
            &registry,
            &id("audio.master_volume"),
            SettingValue::Integer(50),
        )
        .unwrap();

    let changes = diff(&registry, &before, &after);
    assert_eq!(changes.len(), 2);
    assert_eq!(changes[0].id.as_str(), "audio.master_volume");
    assert_eq!(changes[0].apply_mode, ApplyMode::Immediate);
    assert_eq!(changes[1].id.as_str(), "video.fullscreen");
    assert_eq!(changes[1].apply_mode, ApplyMode::Apply);
}

#[test]
fn persistence_round_trip_is_canonical_and_delta_only() {
    let registry = registry();
    let mut state = SettingsState::new();
    state
        .set(&registry, &id("video.fullscreen"), SettingValue::Bool(true))
        .unwrap();

    let encoded = encode_json(&registry, &state).unwrap();
    assert!(encoded.contains(&format!("\"schema_version\": {CURRENT_SCHEMA_VERSION}")));
    assert!(encoded.contains("video.fullscreen"));
    assert!(!encoded.contains("audio.master_volume"));

    let loaded = decode_json(&registry, &encoded).unwrap();
    assert!(loaded.diagnostics.is_empty());
    assert_eq!(loaded.state, state);
    assert_eq!(encode_json(&registry, &loaded.state).unwrap(), encoded);
}

#[test]
fn compatible_files_skip_unknown_and_invalid_entries_without_applying_them() {
    let registry = registry();
    let json = r#"{
  "schema_version": 1,
  "overrides": {
    "audio.master_volume": { "type": "integer", "value": 120 },
    "removed.setting": { "type": "bool", "value": true },
    "video.fullscreen": { "type": "bool", "value": true }
  }
}"#;

    let loaded = decode_json(&registry, json).unwrap();
    assert_eq!(loaded.diagnostics.len(), 2);
    assert!(matches!(
        loaded.diagnostics[0],
        LoadDiagnostic::InvalidValue { .. }
    ));
    assert!(matches!(
        loaded.diagnostics[1],
        LoadDiagnostic::UnknownSetting { .. }
    ));
    assert_eq!(
        loaded
            .state
            .effective_value(&registry, &id("audio.master_volume")),
        Some(&SettingValue::Integer(80))
    );
    assert_eq!(
        loaded
            .state
            .effective_value(&registry, &id("video.fullscreen")),
        Some(&SettingValue::Bool(true))
    );
}

#[test]
fn unsupported_schema_versions_are_rejected_until_migrated() {
    let registry = registry();
    let json = r#"{"schema_version":2,"overrides":{}}"#;
    let error = decode_json(&registry, json).unwrap_err();
    assert!(matches!(
        error,
        PersistenceError::UnsupportedSchemaVersion {
            found: 2,
            supported: 1
        }
    ));
}

#[test]
fn non_finite_numbers_are_rejected() {
    let mut registry = SettingsRegistry::new();
    registry
        .register(SettingDefinition {
            id: id("camera.sensitivity"),
            kind: SettingKind::Number { min: 0.1, max: 4.0 },
            default: SettingValue::Number(1.0),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
        })
        .unwrap();

    let mut state = SettingsState::new();
    assert!(
        state
            .set(
                &registry,
                &id("camera.sensitivity"),
                SettingValue::Number(f64::NAN),
            )
            .is_err()
    );
}

#[test]
fn deserialization_preserves_setting_id_invariants() {
    assert!(serde_json::from_str::<SettingId>(r#"""#).is_err());
    assert!(serde_json::from_str::<SettingId>(r#"" video.fullscreen ""#).is_err());
    assert_eq!(
        serde_json::from_str::<SettingId>(r#""video.fullscreen""#).unwrap(),
        id("video.fullscreen")
    );
}

#[test]
fn effective_values_fail_closed_against_a_changed_registry() {
    let original = registry();
    let setting = id("video.fullscreen");
    let mut state = SettingsState::new();
    state
        .set(&original, &setting, SettingValue::Bool(true))
        .unwrap();

    let mut changed = SettingsRegistry::new();
    changed
        .register(SettingDefinition {
            id: setting.clone(),
            kind: SettingKind::Integer { min: 0, max: 10 },
            default: SettingValue::Integer(3),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
        })
        .unwrap();

    assert_eq!(
        state.effective_value(&changed, &setting),
        Some(&SettingValue::Integer(3))
    );
    assert_eq!(
        state.effective_value(&SettingsRegistry::new(), &setting),
        None
    );
}

#[test]
fn session_overrides_are_never_persisted_or_restored() {
    let mut registry = SettingsRegistry::new();
    registry
        .register(SettingDefinition {
            id: id("session.debug_overlay"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::Session,
            apply_mode: ApplyMode::Immediate,
        })
        .unwrap();

    let mut state = SettingsState::new();
    state
        .set(
            &registry,
            &id("session.debug_overlay"),
            SettingValue::Bool(true),
        )
        .unwrap();

    let encoded = encode_json(&registry, &state).unwrap();
    assert!(!encoded.contains("session.debug_overlay"));

    let json = r#"{
  "schema_version": 1,
  "overrides": {
    "session.debug_overlay": { "type": "bool", "value": true }
  }
}"#;
    let loaded = decode_json(&registry, json).unwrap();
    assert_eq!(loaded.diagnostics.len(), 1);
    assert!(matches!(
        loaded.diagnostics[0],
        LoadDiagnostic::NonPersistentScope {
            scope: SettingScope::Session,
            ..
        }
    ));
    assert_eq!(
        loaded
            .state
            .effective_value(&registry, &id("session.debug_overlay")),
        Some(&SettingValue::Bool(false))
    );
}
