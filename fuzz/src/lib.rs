use settings_core::{
    ApplyMode, SettingDefinition, SettingId, SettingKind, SettingScope, SettingValue,
    SettingsRegistry,
};

fn id(value: &str) -> SettingId {
    SettingId::new(value).unwrap()
}

pub fn registry() -> SettingsRegistry {
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
