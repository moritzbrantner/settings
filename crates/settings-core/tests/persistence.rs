use settings_core::{
    ApplyMode, LoadDiagnostic, MigrationRecord, OverrideSource, PersistenceError, PreservedEntries,
    SettingDefinition, SettingId, SettingKind, SettingScope, SettingValue, SettingsRegistry,
    SettingsState, ValueProvenance, export_scope_json, import_scope_json,
};

fn id(value: &str) -> SettingId {
    SettingId::new(value).unwrap()
}

fn registry() -> SettingsRegistry {
    let mut registry = SettingsRegistry::new();
    for definition in [
        SettingDefinition {
            id: id("audio.master_volume"),
            kind: SettingKind::Integer { min: 0, max: 100 },
            default: SettingValue::Integer(80),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        },
        SettingDefinition {
            id: id("accessibility.subtitle_scale"),
            kind: SettingKind::Integer { min: 50, max: 200 },
            default: SettingValue::Integer(100),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        },
        SettingDefinition {
            id: id("accessibility.reduce_motion"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        },
        SettingDefinition {
            id: id("video.fullscreen"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
            availability: None,
        },
        SettingDefinition {
            id: id("video.quality"),
            kind: SettingKind::Choice {
                options: vec!["low".into(), "medium".into(), "high".into()],
            },
            default: SettingValue::Choice("high".into()),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
            availability: None,
        },
        SettingDefinition {
            id: id("video.vsync"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        },
        SettingDefinition {
            id: id("save.difficulty"),
            kind: SettingKind::Choice {
                options: vec!["normal".into(), "hard".into()],
            },
            default: SettingValue::Choice("normal".into()),
            scope: SettingScope::Save,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        },
    ] {
        registry.register(definition).unwrap();
    }
    registry
}

#[test]
fn v1_migration_partitions_known_values_by_scope_and_marks_provenance() {
    let registry = registry();
    let legacy = include_str!("../../../fixtures/persistence/v1-mixed.json");

    let device = import_scope_json(&registry, SettingScope::Device, legacy).unwrap();
    assert_eq!(
        device.migrations,
        vec![MigrationRecord {
            from_version: 1,
            to_version: 2,
        }]
    );
    assert_eq!(
        device
            .state
            .effective_value(&registry, &id("video.fullscreen")),
        Some(&SettingValue::Bool(true))
    );
    assert_eq!(
        device
            .state
            .effective_provenance(&registry, &id("video.fullscreen")),
        Some(ValueProvenance::Migration { from_version: 1 })
    );
    assert_eq!(device.state.override_value(&id("audio.master_volume")), None);
    assert!(device.diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        LoadDiagnostic::LegacyUnknownEntryDropped { id }
            if id.as_str() == "future.unknown"
    )));

    let user = import_scope_json(&registry, SettingScope::User, legacy).unwrap();
    assert_eq!(
        user.state
            .effective_value(&registry, &id("audio.master_volume")),
        Some(&SettingValue::Integer(55))
    );
    assert_eq!(
        user.state
            .effective_provenance(&registry, &id("audio.master_volume")),
        Some(ValueProvenance::Migration { from_version: 1 })
    );
    assert_eq!(user.state.override_value(&id("video.fullscreen")), None);
}

#[test]
fn one_state_exports_independent_user_device_and_save_snapshots() {
    let registry = registry();
    let mut state = SettingsState::new();
    state
        .set(
            &registry,
            &id("audio.master_volume"),
            SettingValue::Integer(65),
        )
        .unwrap();
    state
        .set(&registry, &id("video.fullscreen"), SettingValue::Bool(true))
        .unwrap();
    state
        .set(
            &registry,
            &id("save.difficulty"),
            SettingValue::Choice("hard".into()),
        )
        .unwrap();

    let user = export_scope_json(
        &registry,
        &state,
        SettingScope::User,
        &PreservedEntries::new(),
    )
    .unwrap();
    let device = export_scope_json(
        &registry,
        &state,
        SettingScope::Device,
        &PreservedEntries::new(),
    )
    .unwrap();
    let save = export_scope_json(
        &registry,
        &state,
        SettingScope::Save,
        &PreservedEntries::new(),
    )
    .unwrap();

    assert!(user.contains("audio.master_volume"));
    assert!(!user.contains("video.fullscreen"));
    assert!(!user.contains("save.difficulty"));
    assert!(device.contains("video.fullscreen"));
    assert!(!device.contains("audio.master_volume"));
    assert!(!device.contains("save.difficulty"));
    assert!(save.contains("save.difficulty"));
    assert!(!save.contains("audio.master_volume"));
    assert!(!save.contains("video.fullscreen"));

    let mismatch = import_scope_json(&registry, SettingScope::User, &device).unwrap_err();
    assert!(matches!(
        mismatch,
        PersistenceError::ScopeMismatch {
            expected: SettingScope::User,
            found: SettingScope::Device,
        }
    ));
}

#[test]
fn policy_command_line_and_session_sources_do_not_leak_into_durable_user_state() {
    let registry = registry();
    let mut state = SettingsState::new();
    state
        .set_with_source(
            &registry,
            &id("audio.master_volume"),
            SettingValue::Integer(10),
            OverrideSource::Policy,
        )
        .unwrap();
    state
        .set_with_source(
            &registry,
            &id("accessibility.subtitle_scale"),
            SettingValue::Integer(125),
            OverrideSource::Preset,
        )
        .unwrap();
    state
        .set_with_source(
            &registry,
            &id("accessibility.reduce_motion"),
            SettingValue::Bool(true),
            OverrideSource::CommandLineOverride,
        )
        .unwrap();

    let exported = export_scope_json(
        &registry,
        &state,
        SettingScope::User,
        &PreservedEntries::new(),
    )
    .unwrap();
    assert!(!exported.contains("audio.master_volume"));
    assert!(exported.contains("accessibility.subtitle_scale"));
    assert!(!exported.contains("accessibility.reduce_motion"));
}

#[test]
fn unknown_v2_entries_survive_a_canonical_round_trip() {
    let registry = registry();
    let input = r#"{
  "schema_version": 2,
  "scope": "device",
  "overrides": {
    "future.renderer.option": { "type": "choice", "value": "future" },
    "video.fullscreen": { "type": "bool", "value": true }
  }
}"#;

    let first = import_scope_json(&registry, SettingScope::Device, input).unwrap();
    assert_eq!(first.preserved_entries.len(), 1);
    let canonical = export_scope_json(
        &registry,
        &first.state,
        SettingScope::Device,
        &first.preserved_entries,
    )
    .unwrap();
    assert!(canonical.contains("future.renderer.option"));

    let second = import_scope_json(&registry, SettingScope::Device, &canonical).unwrap();
    let canonical_again = export_scope_json(
        &registry,
        &second.state,
        SettingScope::Device,
        &second.preserved_entries,
    )
    .unwrap();
    assert_eq!(canonical_again, canonical);
}

#[test]
fn corrupt_v2_fixture_recovers_only_safe_values_and_preserves_safe_unknowns() {
    let registry = registry();
    let corrupt = include_str!("../../../fixtures/persistence/v2-corrupt-device.json");

    let loaded = import_scope_json(&registry, SettingScope::Device, corrupt).unwrap();
    assert!(loaded.diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        LoadDiagnostic::InvalidIdentifier { raw_id, .. } if raw_id == " bad "
    )));
    assert!(loaded.diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        LoadDiagnostic::UnknownSettingPreserved { id }
            if id.as_str() == "future.renderer.option"
    )));
    assert!(loaded.diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        LoadDiagnostic::CorruptValue { id, .. } if id.as_str() == "video.fullscreen"
    )));
    assert!(loaded.diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        LoadDiagnostic::InvalidValue { id, .. } if id.as_str() == "video.quality"
    )));
    assert_eq!(
        loaded
            .state
            .effective_value(&registry, &id("video.vsync")),
        Some(&SettingValue::Bool(true))
    );
    assert_eq!(loaded.preserved_entries.len(), 1);

    let recovered = export_scope_json(
        &registry,
        &loaded.state,
        SettingScope::Device,
        &loaded.preserved_entries,
    )
    .unwrap();
    assert!(recovered.contains("future.renderer.option"));
    assert!(recovered.contains("video.vsync"));
    assert!(!recovered.contains(" bad "));
    assert!(!recovered.contains("video.fullscreen"));
    assert!(!recovered.contains("video.quality"));
}

#[test]
fn independently_loaded_scopes_merge_without_losing_sources() {
    let registry = registry();
    let user = r#"{
  "schema_version": 2,
  "scope": "user",
  "overrides": {
    "audio.master_volume": { "type": "integer", "value": 60 }
  }
}"#;
    let device = r#"{
  "schema_version": 2,
  "scope": "device",
  "overrides": {
    "video.fullscreen": { "type": "bool", "value": true }
  }
}"#;

    let user = import_scope_json(&registry, SettingScope::User, user).unwrap();
    let device = import_scope_json(&registry, SettingScope::Device, device).unwrap();
    let mut merged = user.state;
    merged.merge_from(&registry, &device.state).unwrap();

    assert_eq!(
        merged.effective_value(&registry, &id("audio.master_volume")),
        Some(&SettingValue::Integer(60))
    );
    assert_eq!(
        merged.effective_value(&registry, &id("video.fullscreen")),
        Some(&SettingValue::Bool(true))
    );
    assert_eq!(
        merged.effective_provenance(&registry, &id("audio.master_volume")),
        Some(ValueProvenance::UserOverride)
    );
    assert_eq!(
        merged.effective_provenance(&registry, &id("video.fullscreen")),
        Some(ValueProvenance::UserOverride)
    );
}
