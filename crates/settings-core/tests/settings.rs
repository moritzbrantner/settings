use settings_core::{
    ApplyMode, CURRENT_SCHEMA_VERSION, LoadDiagnostic, OverrideSource, PersistenceError,
    PreservedEntries, SettingDefinition, SettingId, SettingKind, SettingScope, SettingValue,
    SettingsRegistry, SettingsState, ValidationError, ValueProvenance, diff, export_scope_json,
    import_scope_json,
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
            availability: None,
        })
        .unwrap();
    registry
        .register(SettingDefinition {
            id: id("video.fullscreen"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
            availability: None,
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
            availability: None,
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
fn scoped_persistence_round_trip_is_canonical_and_delta_only() {
    let registry = registry();
    let mut state = SettingsState::new();
    state
        .set(&registry, &id("video.fullscreen"), SettingValue::Bool(true))
        .unwrap();

    let encoded = export_scope_json(
        &registry,
        &state,
        SettingScope::Device,
        &PreservedEntries::new(SettingScope::Device).unwrap(),
    )
    .unwrap();
    assert!(encoded.contains(&format!("\"schema_version\": {CURRENT_SCHEMA_VERSION}")));
    assert!(encoded.contains("\"scope\": \"device\""));
    assert!(encoded.contains("video.fullscreen"));
    assert!(!encoded.contains("audio.master_volume"));

    let loaded = import_scope_json(&registry, SettingScope::Device, &encoded).unwrap();
    assert!(loaded.diagnostics.is_empty());
    assert!(loaded.migrations.is_empty());
    assert_eq!(loaded.state, state);
    assert_eq!(
        export_scope_json(
            &registry,
            &loaded.state,
            SettingScope::Device,
            &loaded.preserved_entries,
        )
        .unwrap(),
        encoded
    );
}

#[test]
fn compatible_scope_files_recover_valid_entries_and_preserve_unknown_ones() {
    let registry = registry();
    let json = r#"{
  "schema_version": 2,
  "scope": "device",
  "overrides": {
    "removed.setting": { "type": "bool", "value": true },
    "video.fullscreen": { "type": "bool", "value": true },
    "video.quality": { "type": "choice", "value": "cinematic" }
  }
}"#;

    let loaded = import_scope_json(&registry, SettingScope::Device, json).unwrap();
    assert_eq!(loaded.diagnostics.len(), 2);
    assert!(
        loaded
            .diagnostics
            .iter()
            .any(|diagnostic| matches!(diagnostic, LoadDiagnostic::UnknownSettingPreserved { .. }))
    );
    assert!(
        loaded
            .diagnostics
            .iter()
            .any(|diagnostic| matches!(diagnostic, LoadDiagnostic::InvalidValue { .. }))
    );
    assert_eq!(loaded.preserved_entries.scope(), SettingScope::Device);
    assert_eq!(loaded.preserved_entries.len(), 1);
    assert_eq!(
        loaded
            .state
            .effective_value(&registry, &id("video.fullscreen")),
        Some(&SettingValue::Bool(true))
    );
    assert_eq!(
        loaded
            .state
            .effective_value(&registry, &id("video.quality")),
        Some(&SettingValue::Choice("high".into()))
    );
}

#[test]
fn unsupported_schema_versions_are_rejected_until_migrated() {
    let registry = registry();
    let json = r#"{"schema_version":3}"#;
    let error = import_scope_json(&registry, SettingScope::Device, json).unwrap_err();
    assert!(matches!(
        error,
        PersistenceError::UnsupportedSchemaVersion {
            found: 3,
            supported: CURRENT_SCHEMA_VERSION
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
            availability: None,
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
            availability: None,
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
fn provenance_tracks_layered_override_sources_without_destroying_durable_state() {
    let registry = registry();
    let setting = id("audio.master_volume");
    let mut state = SettingsState::new();
    assert_eq!(
        state.effective_provenance(&registry, &setting),
        Some(ValueProvenance::Default)
    );

    state
        .set(&registry, &setting, SettingValue::Integer(65))
        .unwrap();
    assert_eq!(
        state.effective_provenance(&registry, &setting),
        Some(ValueProvenance::UserOverride)
    );

    state
        .set_with_source(
            &registry,
            &setting,
            SettingValue::Integer(70),
            OverrideSource::Policy,
        )
        .unwrap();
    assert_eq!(
        state.effective_provenance(&registry, &setting),
        Some(ValueProvenance::Policy)
    );
    assert_eq!(
        state.override_value(&setting),
        Some(&SettingValue::Integer(65))
    );
    assert_eq!(state.transient_override_count(), 1);

    state
        .set(&registry, &setting, SettingValue::Integer(80))
        .unwrap();
    assert_eq!(state.override_value(&setting), None);
    assert_eq!(
        state.effective_provenance(&registry, &setting),
        Some(ValueProvenance::Policy)
    );

    assert!(state.clear_transient_override(&setting, OverrideSource::Policy));
    assert_eq!(
        state.effective_provenance(&registry, &setting),
        Some(ValueProvenance::Default)
    );
}

#[test]
fn session_scope_cannot_construct_preserved_entries() {
    let error = PreservedEntries::new(SettingScope::Session).unwrap_err();
    assert!(matches!(
        error,
        PersistenceError::NonPersistentScope(SettingScope::Session)
    ));
}
