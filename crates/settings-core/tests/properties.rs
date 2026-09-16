use proptest::prelude::*;
use settings_core::{
    ApplyMode, OverrideSource, PreservedEntries, SettingDefinition, SettingId, SettingKind,
    SettingScope, SettingValue, SettingsRegistry, SettingsState, ValueProvenance, diff,
    export_scope_json, import_scope_json,
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
            default: SettingValue::Integer(50),
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
    ] {
        registry.register(definition).unwrap();
    }
    registry
}

fn apply_transient(
    state: &mut SettingsState,
    registry: &SettingsRegistry,
    setting: &SettingId,
    source: OverrideSource,
    value: Option<i64>,
) {
    if let Some(value) = value {
        state
            .set_with_source(registry, setting, SettingValue::Integer(value), source)
            .unwrap();
    }
}

proptest! {
    #[test]
    fn transient_precedence_is_independent_of_write_order(
        durable in 0i64..=100,
        session in prop::option::of(0i64..=100),
        command_line in prop::option::of(0i64..=100),
        policy in prop::option::of(0i64..=100),
        reverse_order in any::<bool>(),
    ) {
        let registry = registry();
        let setting = id("audio.master_volume");
        let mut state = SettingsState::new();
        state
            .set(&registry, &setting, SettingValue::Integer(durable))
            .unwrap();

        if reverse_order {
            apply_transient(
                &mut state,
                &registry,
                &setting,
                OverrideSource::Policy,
                policy,
            );
            apply_transient(
                &mut state,
                &registry,
                &setting,
                OverrideSource::CommandLineOverride,
                command_line,
            );
            apply_transient(
                &mut state,
                &registry,
                &setting,
                OverrideSource::SessionOverride,
                session,
            );
        } else {
            apply_transient(
                &mut state,
                &registry,
                &setting,
                OverrideSource::SessionOverride,
                session,
            );
            apply_transient(
                &mut state,
                &registry,
                &setting,
                OverrideSource::CommandLineOverride,
                command_line,
            );
            apply_transient(
                &mut state,
                &registry,
                &setting,
                OverrideSource::Policy,
                policy,
            );
        }

        let expected_value = policy.or(command_line).or(session).unwrap_or(durable);
        let expected_provenance = if policy.is_some() {
            ValueProvenance::Policy
        } else if command_line.is_some() {
            ValueProvenance::CommandLineOverride
        } else if session.is_some() {
            ValueProvenance::SessionOverride
        } else if durable == 50 {
            ValueProvenance::Default
        } else {
            ValueProvenance::UserOverride
        };

        prop_assert_eq!(
            state.effective_value(&registry, &setting),
            Some(&SettingValue::Integer(expected_value))
        );
        prop_assert_eq!(
            state.effective_provenance(&registry, &setting),
            Some(expected_provenance)
        );
    }

    #[test]
    fn setting_a_default_value_always_canonicalizes_the_durable_layer(value in 0i64..=100) {
        let registry = registry();
        let setting = id("audio.master_volume");
        let mut state = SettingsState::new();
        state
            .set(&registry, &setting, SettingValue::Integer(value))
            .unwrap();
        state
            .set(&registry, &setting, SettingValue::Integer(50))
            .unwrap();

        prop_assert_eq!(state.override_value(&setting), None);
        prop_assert_eq!(state.override_source(&setting), None);
        prop_assert_eq!(
            state.effective_value(&registry, &setting),
            Some(&SettingValue::Integer(50))
        );
        prop_assert_eq!(
            state.effective_provenance(&registry, &setting),
            Some(ValueProvenance::Default)
        );
    }

    #[test]
    fn canonical_user_snapshot_round_trips_for_valid_values(
        volume in 0i64..=100,
        reduce_motion in any::<bool>(),
    ) {
        let registry = registry();
        let mut state = SettingsState::new();
        state
            .set(
                &registry,
                &id("audio.master_volume"),
                SettingValue::Integer(volume),
            )
            .unwrap();
        state
            .set(
                &registry,
                &id("accessibility.reduce_motion"),
                SettingValue::Bool(reduce_motion),
            )
            .unwrap();

        let first = export_scope_json(
            &registry,
            &state,
            SettingScope::User,
            &PreservedEntries::new(SettingScope::User).unwrap(),
        )
        .unwrap();
        let loaded = import_scope_json(&registry, SettingScope::User, &first).unwrap();
        let second = export_scope_json(
            &registry,
            &loaded.state,
            SettingScope::User,
            &loaded.preserved_entries,
        )
        .unwrap();

        prop_assert_eq!(second, first);
        prop_assert_eq!(
            loaded
                .state
                .effective_value(&registry, &id("audio.master_volume")),
            Some(&SettingValue::Integer(volume))
        );
        prop_assert_eq!(
            loaded
                .state
                .effective_value(&registry, &id("accessibility.reduce_motion")),
            Some(&SettingValue::Bool(reduce_motion))
        );
    }

    #[test]
    fn diff_is_directionally_symmetric(before in 0i64..=100, after in 0i64..=100) {
        let registry = registry();
        let setting = id("audio.master_volume");
        let mut before_state = SettingsState::new();
        let mut after_state = SettingsState::new();
        before_state
            .set(&registry, &setting, SettingValue::Integer(before))
            .unwrap();
        after_state
            .set(&registry, &setting, SettingValue::Integer(after))
            .unwrap();

        let forward = diff(&registry, &before_state, &after_state);
        let reverse = diff(&registry, &after_state, &before_state);
        prop_assert_eq!(forward.len(), reverse.len());

        if before == after {
            prop_assert!(forward.is_empty());
        } else {
            prop_assert_eq!(&forward[0].id, &reverse[0].id);
            prop_assert_eq!(&forward[0].before, &reverse[0].after);
            prop_assert_eq!(&forward[0].after, &reverse[0].before);
            prop_assert_eq!(&forward[0].before_provenance, &reverse[0].after_provenance);
            prop_assert_eq!(&forward[0].after_provenance, &reverse[0].before_provenance);
        }
    }
}
