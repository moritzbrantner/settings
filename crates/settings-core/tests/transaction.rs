use settings_core::{
    ApplyMode, OverrideSource, PresetId, SafetyRollbackStatus, SettingDefinition, SettingId,
    SettingKind, SettingScope, SettingValue, SettingsPreset, SettingsRegistry, SettingsState,
    SettingsTransaction, TimedSafetyRollback, ValidationError, ValueProvenance, apply_preset,
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
            id: id("video.resolution"),
            kind: SettingKind::Choice {
                options: vec!["1920x1080".into(), "2560x1440".into()],
            },
            default: SettingValue::Choice("1920x1080".into()),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
            availability: None,
        },
    ] {
        registry.register(definition).unwrap();
    }
    registry
}

#[test]
fn presets_apply_atomically_as_ordinary_values_with_preset_provenance() {
    let registry = registry();
    let mut state = SettingsState::new();
    let mut preset = SettingsPreset::new(PresetId::new("quiet-accessible").unwrap());
    preset.insert(id("audio.master_volume"), SettingValue::Integer(50));
    preset.insert(id("accessibility.reduce_motion"), SettingValue::Bool(true));

    let changes = apply_preset(&registry, &mut state, &preset).unwrap();
    assert_eq!(changes.len(), 2);
    assert_eq!(
        state.effective_provenance(&registry, &id("audio.master_volume")),
        Some(ValueProvenance::Preset)
    );
    assert_eq!(
        state.effective_provenance(&registry, &id("accessibility.reduce_motion")),
        Some(ValueProvenance::Preset)
    );

    let before_invalid = state.clone();
    let mut invalid = SettingsPreset::new(PresetId::new("invalid").unwrap());
    invalid.insert(id("audio.master_volume"), SettingValue::Integer(20));
    invalid.insert(id("zzz.unknown"), SettingValue::Bool(true));
    let error = apply_preset(&registry, &mut state, &invalid).unwrap_err();
    assert!(matches!(error, ValidationError::UnknownSetting(_)));
    assert_eq!(state, before_invalid);
}

#[test]
fn preset_changes_can_update_durable_preferences_beneath_a_policy_without_faking_effects() {
    let registry = registry();
    let setting = id("audio.master_volume");
    let mut state = SettingsState::new();
    state
        .set(&registry, &setting, SettingValue::Integer(65))
        .unwrap();
    state
        .set_with_source(
            &registry,
            &setting,
            SettingValue::Integer(10),
            OverrideSource::Policy,
        )
        .unwrap();

    let mut preset = SettingsPreset::new(PresetId::new("quiet").unwrap());
    preset.insert(setting.clone(), SettingValue::Integer(40));
    let changes = apply_preset(&registry, &mut state, &preset).unwrap();

    assert!(changes.is_empty());
    assert_eq!(
        state.effective_value(&registry, &setting),
        Some(&SettingValue::Integer(10))
    );
    assert_eq!(
        state.override_value(&setting),
        Some(&SettingValue::Integer(40))
    );
    assert_eq!(
        state.override_source(&setting),
        Some(&OverrideSource::Preset)
    );
}

#[test]
fn cancel_returns_only_immediate_reverts_and_restores_the_baseline() {
    let registry = registry();
    let baseline = SettingsState::new();
    let mut transaction = SettingsTransaction::new(baseline.clone());
    transaction
        .stage_set(
            &registry,
            &id("audio.master_volume"),
            SettingValue::Integer(25),
        )
        .unwrap();
    transaction
        .stage_set(&registry, &id("video.fullscreen"), SettingValue::Bool(true))
        .unwrap();

    let preview = transaction.take_immediate_preview_changes(&registry);
    assert_eq!(preview.len(), 1);
    assert_eq!(preview[0].id, id("audio.master_volume"));
    assert_eq!(preview[0].before, SettingValue::Integer(80));
    assert_eq!(preview[0].after, SettingValue::Integer(25));

    let cancelled = transaction.cancel(&registry);
    assert_eq!(cancelled.state, baseline);
    assert_eq!(cancelled.immediate_revert.len(), 1);
    assert_eq!(cancelled.immediate_revert[0].id, id("audio.master_volume"));
    assert_eq!(
        cancelled.immediate_revert[0].before,
        SettingValue::Integer(25)
    );
    assert_eq!(
        cancelled.immediate_revert[0].after,
        SettingValue::Integer(80)
    );
}

#[test]
fn commit_returns_apply_modes_and_before_after_provenance() {
    let registry = registry();
    let mut baseline = SettingsState::new();
    baseline
        .set(
            &registry,
            &id("audio.master_volume"),
            SettingValue::Integer(60),
        )
        .unwrap();

    let mut transaction = SettingsTransaction::new(baseline);
    transaction
        .stage_set_with_source(
            &registry,
            &id("audio.master_volume"),
            SettingValue::Integer(40),
            OverrideSource::Preset,
        )
        .unwrap();
    transaction
        .stage_set(&registry, &id("video.fullscreen"), SettingValue::Bool(true))
        .unwrap();

    let committed = transaction.commit(&registry);
    assert_eq!(committed.changes.len(), 2);
    assert_eq!(committed.changes[0].apply_mode, ApplyMode::Immediate);
    assert_eq!(
        committed.changes[0].before_provenance,
        ValueProvenance::UserOverride
    );
    assert_eq!(
        committed.changes[0].after_provenance,
        ValueProvenance::Preset
    );
    assert_eq!(committed.changes[1].apply_mode, ApplyMode::Apply);
}

#[test]
fn reset_many_and_global_reset_change_durable_preferences_but_not_runtime_policy() {
    let registry = registry();
    let volume = id("audio.master_volume");
    let mut baseline = SettingsState::new();
    for (setting, value) in [
        ("audio.master_volume", SettingValue::Integer(30)),
        ("accessibility.reduce_motion", SettingValue::Bool(true)),
        ("video.fullscreen", SettingValue::Bool(true)),
    ] {
        baseline.set(&registry, &id(setting), value).unwrap();
    }
    baseline
        .set_with_source(
            &registry,
            &volume,
            SettingValue::Integer(10),
            OverrideSource::Policy,
        )
        .unwrap();

    let mut transaction = SettingsTransaction::new(baseline);
    transaction
        .stage_reset_many(
            &registry,
            &[id("audio.master_volume"), id("accessibility.reduce_motion")],
        )
        .unwrap();
    assert_eq!(transaction.dirty_setting_ids(&registry).len(), 2);
    assert_eq!(
        transaction.staged().effective_value(&registry, &volume),
        Some(&SettingValue::Integer(10))
    );
    assert_eq!(transaction.staged().override_value(&volume), None);
    assert_eq!(
        transaction
            .staged()
            .effective_value(&registry, &id("video.fullscreen")),
        Some(&SettingValue::Bool(true))
    );

    transaction.stage_reset_all();
    assert_eq!(transaction.dirty_setting_ids(&registry).len(), 3);
    assert_eq!(transaction.staged().override_count(), 0);
    assert_eq!(
        transaction.staged().effective_value(&registry, &volume),
        Some(&SettingValue::Integer(10))
    );
}

#[test]
fn provenance_only_edits_are_dirty_without_faking_a_domain_value_change() {
    let registry = registry();
    let setting = id("audio.master_volume");
    let mut baseline = SettingsState::new();
    baseline
        .set(&registry, &setting, SettingValue::Integer(50))
        .unwrap();

    let mut transaction = SettingsTransaction::new(baseline);
    transaction
        .stage_set_with_source(
            &registry,
            &setting,
            SettingValue::Integer(50),
            OverrideSource::Preset,
        )
        .unwrap();

    assert!(transaction.is_dirty());
    assert!(transaction.is_setting_dirty(&setting));
    assert_eq!(transaction.dirty_setting_ids(&registry), vec![setting]);
    assert!(transaction.pending_changes(&registry).is_empty());
}

#[test]
fn per_setting_dirty_state_tracks_transient_layer_edits_too() {
    let registry = registry();
    let setting = id("audio.master_volume");
    let baseline = SettingsState::new();
    let mut transaction = SettingsTransaction::new(baseline);
    transaction
        .stage_set_with_source(
            &registry,
            &setting,
            SettingValue::Integer(15),
            OverrideSource::SessionOverride,
        )
        .unwrap();

    assert!(transaction.is_setting_dirty(&setting));
    assert_eq!(transaction.dirty_setting_ids(&registry), vec![setting]);
    assert_eq!(transaction.pending_changes(&registry).len(), 1);
}

#[test]
fn timed_safety_rollback_uses_caller_ticks_and_cannot_resolve_while_pending() {
    let registry = registry();
    let baseline = SettingsState::new();
    let mut candidate = baseline.clone();
    candidate
        .set(
            &registry,
            &id("video.resolution"),
            SettingValue::Choice("2560x1440".into()),
        )
        .unwrap();

    let rollback = TimedSafetyRollback::new(baseline.clone(), candidate.clone(), 1_000);
    assert_eq!(rollback.status(999), SafetyRollbackStatus::Pending);
    assert!(rollback.rollback_plan(&registry, 999).is_empty());
    assert!(rollback.resolved_state(999).is_none());
    assert_eq!(rollback.status(1_000), SafetyRollbackStatus::Expired);
    let plan = rollback.rollback_plan(&registry, 1_000);
    assert_eq!(plan.len(), 1);
    assert_eq!(plan[0].before, SettingValue::Choice("2560x1440".into()));
    assert_eq!(plan[0].after, SettingValue::Choice("1920x1080".into()));
    assert_eq!(rollback.resolved_state(1_000), Some(&baseline));

    let mut confirmed = TimedSafetyRollback::new(SettingsState::new(), candidate.clone(), 2_000);
    assert!(confirmed.confirm(1_999));
    assert_eq!(confirmed.status(2_000), SafetyRollbackStatus::Confirmed);
    assert!(confirmed.rollback_plan(&registry, 5_000).is_empty());
    assert_eq!(confirmed.resolved_state(5_000), Some(&candidate));
}

#[test]
fn preset_ids_preserve_validation_through_deserialization() {
    assert!(serde_json::from_str::<PresetId>(r#"""#).is_err());
    assert!(serde_json::from_str::<PresetId>(r#"" high ""#).is_err());
    assert_eq!(
        serde_json::from_str::<PresetId>(r#""high""#).unwrap(),
        PresetId::new("high").unwrap()
    );
}
