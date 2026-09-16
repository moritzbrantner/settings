use settings_core::{
    ApplyMode, AvailabilityCondition, AvailabilityPolicy, AvailabilityReason, AvailabilityStatus,
    CapabilityFacts, CapabilityId, ConditionOutcome, RegistryError, SettingDefinition, SettingId,
    SettingKind, SettingScope, SettingValue, SettingsRegistry, SettingsState, UnavailableBehavior,
    evaluate_availability,
};

fn id(value: &str) -> SettingId {
    SettingId::new(value).unwrap()
}

fn capability(value: &str) -> CapabilityId {
    CapabilityId::new(value).unwrap()
}

fn bool_setting(
    id_value: &str,
    default: bool,
    availability: Option<AvailabilityPolicy>,
) -> SettingDefinition {
    SettingDefinition {
        id: id(id_value),
        kind: SettingKind::Bool,
        default: SettingValue::Bool(default),
        scope: SettingScope::User,
        apply_mode: ApplyMode::Immediate,
        availability,
    }
}

#[test]
fn hdr_requires_an_explicit_positive_renderer_capability() {
    let hdr_capability = capability("renderer.hdr");
    let hdr_setting = id("video.hdr");
    let mut registry = SettingsRegistry::new();
    registry
        .register(bool_setting(
            "video.hdr",
            false,
            Some(AvailabilityPolicy {
                condition: AvailabilityCondition::Capability {
                    id: hdr_capability.clone(),
                    expected: true,
                },
                when_unavailable: UnavailableBehavior::Hide,
            }),
        ))
        .unwrap();

    let state = SettingsState::new();
    let mut capabilities = CapabilityFacts::new();

    let missing = evaluate_availability(&registry, &state, &capabilities, &hdr_setting).unwrap();
    assert_eq!(missing.status, AvailabilityStatus::Hidden);
    assert_eq!(missing.outcome, ConditionOutcome::Unknown);
    assert!(matches!(
        &missing.reasons[..],
        [AvailabilityReason::MissingCapability { id, expected: true }]
            if id == &hdr_capability
    ));

    capabilities.set(hdr_capability.clone(), false);
    let unsupported =
        evaluate_availability(&registry, &state, &capabilities, &hdr_setting).unwrap();
    assert_eq!(unsupported.status, AvailabilityStatus::Hidden);
    assert_eq!(unsupported.outcome, ConditionOutcome::Unsatisfied);
    assert!(matches!(
        &unsupported.reasons[..],
        [AvailabilityReason::CapabilityMismatch {
            id,
            expected: true,
            actual: false,
        }] if id == &hdr_capability
    ));

    capabilities.set(hdr_capability, true);
    let supported = evaluate_availability(&registry, &state, &capabilities, &hdr_setting).unwrap();
    assert_eq!(supported.status, AvailabilityStatus::Available);
    assert_eq!(supported.outcome, ConditionOutcome::Satisfied);
    assert!(supported.reasons.is_empty());
}

#[test]
fn setting_values_can_disable_mutually_exclusive_controls() {
    let upscaler = id("video.upscaler");
    let render_scale = id("video.render_scale");
    let mut registry = SettingsRegistry::new();
    registry
        .register(SettingDefinition {
            id: upscaler.clone(),
            kind: SettingKind::Choice {
                options: vec!["off".into(), "fsr".into()],
            },
            default: SettingValue::Choice("fsr".into()),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
            availability: None,
        })
        .unwrap();
    registry
        .register(SettingDefinition {
            id: render_scale.clone(),
            kind: SettingKind::Number { min: 0.5, max: 2.0 },
            default: SettingValue::Number(1.0),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
            availability: Some(AvailabilityPolicy {
                condition: AvailabilityCondition::SettingEquals {
                    id: upscaler.clone(),
                    value: SettingValue::Choice("off".into()),
                },
                when_unavailable: UnavailableBehavior::Disable,
            }),
        })
        .unwrap();

    let mut state = SettingsState::new();
    let capabilities = CapabilityFacts::new();
    let blocked = evaluate_availability(&registry, &state, &capabilities, &render_scale).unwrap();
    assert_eq!(blocked.status, AvailabilityStatus::Disabled);
    assert!(matches!(
        &blocked.reasons[..],
        [AvailabilityReason::SettingValueMismatch {
            id,
            expected: SettingValue::Choice(expected),
            actual: SettingValue::Choice(actual),
        }] if id == &upscaler && expected == "off" && actual == "fsr"
    ));

    state
        .set(&registry, &upscaler, SettingValue::Choice("off".into()))
        .unwrap();
    let available = evaluate_availability(&registry, &state, &capabilities, &render_scale).unwrap();
    assert_eq!(available.status, AvailabilityStatus::Available);
}

#[test]
fn compound_conditions_preserve_unknown_instead_of_guessing() {
    let cap_a = capability("feature.a");
    let cap_b = capability("feature.b");
    let blocked = capability("feature.blocked");
    let setting = id("feature.advanced");
    let mut registry = SettingsRegistry::new();
    registry
        .register(bool_setting(
            "feature.advanced",
            false,
            Some(AvailabilityPolicy {
                condition: AvailabilityCondition::All {
                    conditions: vec![
                        AvailabilityCondition::Any {
                            conditions: vec![
                                AvailabilityCondition::Capability {
                                    id: cap_a.clone(),
                                    expected: true,
                                },
                                AvailabilityCondition::Capability {
                                    id: cap_b.clone(),
                                    expected: true,
                                },
                            ],
                        },
                        AvailabilityCondition::Not {
                            condition: Box::new(AvailabilityCondition::Capability {
                                id: blocked.clone(),
                                expected: true,
                            }),
                        },
                    ],
                },
                when_unavailable: UnavailableBehavior::Disable,
            }),
        ))
        .unwrap();

    let state = SettingsState::new();
    let mut capabilities = CapabilityFacts::new();
    capabilities.set(cap_b, false);
    capabilities.set(blocked.clone(), false);

    let unknown = evaluate_availability(&registry, &state, &capabilities, &setting).unwrap();
    assert_eq!(unknown.status, AvailabilityStatus::Disabled);
    assert_eq!(unknown.outcome, ConditionOutcome::Unknown);
    assert!(matches!(
        &unknown.reasons[..],
        [AvailabilityReason::MissingCapability { id, expected: true }] if id == &cap_a
    ));

    capabilities.set(cap_a, true);
    let available = evaluate_availability(&registry, &state, &capabilities, &setting).unwrap();
    assert_eq!(available.status, AvailabilityStatus::Available);

    capabilities.set(blocked, true);
    let negated = evaluate_availability(&registry, &state, &capabilities, &setting).unwrap();
    assert_eq!(negated.status, AvailabilityStatus::Disabled);
    assert_eq!(negated.outcome, ConditionOutcome::Unsatisfied);
    assert!(matches!(
        &negated.reasons[..],
        [AvailabilityReason::NegatedConditionMatched { .. }]
    ));
}

#[test]
fn missing_or_invalid_setting_predicates_are_conservatively_unknown() {
    let target = id("feature.target");
    let missing = id("missing.setting");
    let mut registry = SettingsRegistry::new();
    registry
        .register(bool_setting(
            "feature.target",
            false,
            Some(AvailabilityPolicy {
                condition: AvailabilityCondition::SettingEquals {
                    id: missing.clone(),
                    value: SettingValue::Bool(true),
                },
                when_unavailable: UnavailableBehavior::Disable,
            }),
        ))
        .unwrap();

    let result = evaluate_availability(
        &registry,
        &SettingsState::new(),
        &CapabilityFacts::new(),
        &target,
    )
    .unwrap();
    assert_eq!(result.outcome, ConditionOutcome::Unknown);
    assert!(matches!(
        &result.reasons[..],
        [AvailabilityReason::MissingSetting { id, .. }] if id == &missing
    ));

    let referenced = id("feature.mode");
    registry
        .register(bool_setting("feature.mode", false, None))
        .unwrap();
    registry
        .register(bool_setting(
            "feature.invalid_predicate",
            false,
            Some(AvailabilityPolicy {
                condition: AvailabilityCondition::SettingEquals {
                    id: referenced.clone(),
                    value: SettingValue::Choice("invalid".into()),
                },
                when_unavailable: UnavailableBehavior::Disable,
            }),
        ))
        .unwrap();

    let invalid = evaluate_availability(
        &registry,
        &SettingsState::new(),
        &CapabilityFacts::new(),
        &id("feature.invalid_predicate"),
    )
    .unwrap();
    assert_eq!(invalid.outcome, ConditionOutcome::Unknown);
    assert!(matches!(
        &invalid.reasons[..],
        [AvailabilityReason::InvalidSettingPredicate { id, .. }] if id == &referenced
    ));
}

#[test]
fn dependency_cycles_are_deterministic_and_registration_order_independent() {
    fn build(reverse: bool) -> SettingsRegistry {
        let a = bool_setting(
            "feature.a",
            false,
            Some(AvailabilityPolicy {
                condition: AvailabilityCondition::SettingEquals {
                    id: id("feature.b"),
                    value: SettingValue::Bool(true),
                },
                when_unavailable: UnavailableBehavior::Disable,
            }),
        );
        let b = bool_setting(
            "feature.b",
            false,
            Some(AvailabilityPolicy {
                condition: AvailabilityCondition::SettingEquals {
                    id: id("feature.a"),
                    value: SettingValue::Bool(true),
                },
                when_unavailable: UnavailableBehavior::Disable,
            }),
        );
        let self_cycle = bool_setting(
            "feature.self",
            false,
            Some(AvailabilityPolicy {
                condition: AvailabilityCondition::SettingEquals {
                    id: id("feature.self"),
                    value: SettingValue::Bool(true),
                },
                when_unavailable: UnavailableBehavior::Disable,
            }),
        );

        let mut registry = SettingsRegistry::new();
        let definitions = if reverse {
            vec![self_cycle, b, a]
        } else {
            vec![a, b, self_cycle]
        };
        for definition in definitions {
            registry.register(definition).unwrap();
        }
        registry
    }

    let forward = build(false).dependency_cycles();
    let reverse = build(true).dependency_cycles();
    assert_eq!(forward, reverse);
    assert_eq!(forward.len(), 2);
    assert_eq!(forward[0].settings, vec![id("feature.a"), id("feature.b")]);
    assert_eq!(forward[1].settings, vec![id("feature.self")]);
}

#[test]
fn malformed_empty_compound_conditions_are_rejected_at_registration() {
    let mut registry = SettingsRegistry::new();
    let error = registry
        .register(bool_setting(
            "feature.invalid",
            false,
            Some(AvailabilityPolicy {
                condition: AvailabilityCondition::Any {
                    conditions: Vec::new(),
                },
                when_unavailable: UnavailableBehavior::Disable,
            }),
        ))
        .unwrap_err();
    assert!(matches!(error, RegistryError::InvalidDefinition { .. }));
}

#[test]
fn capability_ids_preserve_validation_through_deserialization() {
    assert!(serde_json::from_str::<CapabilityId>(r#"""#).is_err());
    assert!(serde_json::from_str::<CapabilityId>(r#"" renderer.hdr ""#).is_err());
    assert_eq!(
        serde_json::from_str::<CapabilityId>(r#""renderer.hdr""#).unwrap(),
        capability("renderer.hdr")
    );
}
