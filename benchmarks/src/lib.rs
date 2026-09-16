use settings_core::{
    ApplyMode, SettingDefinition, SettingId, SettingKind, SettingScope, SettingValue,
    SettingsRegistry, SettingsState, diff,
};
use settings_presentation::{
    Discoverability, LocalizationKey, PresentationMetadata, PresentationRegistry,
};
use std::collections::BTreeSet;

pub struct SettingsWorkload {
    pub registry: SettingsRegistry,
    pub before: SettingsState,
    pub after: SettingsState,
    pub presentation: PresentationRegistry,
}

pub fn build_workload(size: usize, changed_every: usize) -> SettingsWorkload {
    assert!(size > 0);
    assert!(changed_every > 0);

    let mut registry = SettingsRegistry::new();
    let mut presentation = PresentationRegistry::new();
    let before = SettingsState::new();
    let mut after = SettingsState::new();

    for index in 0..size {
        let setting_id = SettingId::new(format!("benchmark.setting.{index:05}")).unwrap();
        registry
            .register(SettingDefinition {
                id: setting_id.clone(),
                kind: SettingKind::Bool,
                default: SettingValue::Bool(false),
                scope: SettingScope::User,
                apply_mode: ApplyMode::Immediate,
                availability: None,
            })
            .unwrap();

        presentation
            .register(
                &registry,
                setting_id.clone(),
                PresentationMetadata {
                    label_key: LocalizationKey::new(format!("benchmark.label.{index:05}")).unwrap(),
                    description_key: None,
                    category_key: LocalizationKey::new(format!(
                        "benchmark.category.{:02}",
                        index % 10
                    ))
                    .unwrap(),
                    group_key: Some(
                        LocalizationKey::new(format!("benchmark.group.{:02}", index % 5)).unwrap(),
                    ),
                    order: index as i32,
                    discoverability: Discoverability::Primary,
                    search_keys: BTreeSet::new(),
                },
            )
            .unwrap();

        if index % changed_every == 0 {
            after
                .set(&registry, &setting_id, SettingValue::Bool(true))
                .unwrap();
        }
    }

    SettingsWorkload {
        registry,
        before,
        after,
        presentation,
    }
}

pub fn scan_effective_values(workload: &SettingsWorkload) -> usize {
    workload
        .registry
        .iter()
        .filter(|(id, _)| {
            matches!(
                workload.after.effective_value(&workload.registry, id),
                Some(SettingValue::Bool(true))
            )
        })
        .count()
}

pub fn materialize_diff(workload: &SettingsWorkload) -> Vec<settings_core::SettingChange> {
    diff(&workload.registry, &workload.before, &workload.after)
}

pub fn materialize_presentation(
    workload: &SettingsWorkload,
) -> Vec<settings_presentation::PresentationEntry> {
    workload.presentation.ordered_entries()
}
