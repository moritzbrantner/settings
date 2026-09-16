use settings_core::{
    ApplyMode, SettingDefinition, SettingId, SettingKind, SettingScope, SettingValue,
    SettingsRegistry, export_scope_json, import_scope_json,
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
            id: id("video.fullscreen"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
            availability: None,
        },
    ] {
        registry.register(definition).unwrap();
    }
    registry
}

fn canonical_export(scope: SettingScope, input: &str) -> String {
    let registry = registry();
    let loaded = import_scope_json(&registry, scope, input).unwrap();
    export_scope_json(
        &registry,
        &loaded.state,
        scope,
        &loaded.preserved_entries,
    )
    .unwrap()
}

#[test]
fn retained_v1_fixture_migrates_to_stable_user_golden() {
    let legacy = include_str!("../../../fixtures/persistence/v1-mixed.json");
    let expected = include_str!("../../../fixtures/persistence/v1-user-migrated-v2.json");

    assert_eq!(
        canonical_export(SettingScope::User, legacy),
        expected.trim_end()
    );
}

#[test]
fn retained_v1_fixture_migrates_to_stable_device_golden() {
    let legacy = include_str!("../../../fixtures/persistence/v1-mixed.json");
    let expected = include_str!("../../../fixtures/persistence/v1-device-migrated-v2.json");

    assert_eq!(
        canonical_export(SettingScope::Device, legacy),
        expected.trim_end()
    );
}

#[test]
fn retained_v2_fixture_round_trips_unknown_entries_without_schema_drift() {
    let input = include_str!("../../../fixtures/persistence/v2-user-forward-compatible.json");
    let registry = registry();
    let loaded = import_scope_json(&registry, SettingScope::User, input).unwrap();

    assert!(loaded.migrations.is_empty());
    assert_eq!(loaded.preserved_entries.len(), 1);
    assert_eq!(
        export_scope_json(
            &registry,
            &loaded.state,
            SettingScope::User,
            &loaded.preserved_entries,
        )
        .unwrap(),
        input.trim_end()
    );
}
