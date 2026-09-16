use settings_adapters::{
    AdapterDescriptor, ApplicationSettingsAdapter, AudioSettingsAdapter, DomainSettingsAdapter,
    GraphicsSettingsAdapter, commands_for_changes, install_adapter_descriptor,
};
use settings_core::{
    ApplyMode, CapabilityFacts, CapabilityId, SettingDefinition, SettingId, SettingKind,
    SettingScope, SettingValue, SettingsRegistry, SettingsState, diff,
};
use std::convert::Infallible;
use std::fmt::Debug;

fn id(value: &str) -> SettingId {
    SettingId::new(value).unwrap()
}

fn capability(value: &str) -> CapabilityId {
    CapabilityId::new(value).unwrap()
}

fn assert_consumer_conformance<A>(
    adapter: &A,
    owned_id: &str,
    before: SettingValue,
    after: SettingValue,
    expected: A::Command,
) where
    A: DomainSettingsAdapter<Error = Infallible>,
    A::Command: Debug + PartialEq,
{
    let descriptor = adapter.descriptor();
    let mut registry = SettingsRegistry::new();
    let mut capabilities = CapabilityFacts::new();
    install_adapter_descriptor(&mut registry, &mut capabilities, &descriptor).unwrap();

    let owned = id(owned_id);
    let mut baseline = SettingsState::new();
    baseline.set(&registry, &owned, before).unwrap();
    let mut changed = baseline.clone();
    changed.set(&registry, &owned, after).unwrap();

    let owned_changes = diff(&registry, &baseline, &changed);
    assert_eq!(
        commands_for_changes(adapter, &owned_changes).unwrap(),
        vec![expected]
    );

    let unrelated = id("unrelated.diagnostic_toggle");
    registry
        .register(SettingDefinition {
            id: unrelated.clone(),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::Session,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        })
        .unwrap();
    let mut unrelated_changed = changed.clone();
    unrelated_changed
        .set(&registry, &unrelated, SettingValue::Bool(true))
        .unwrap();

    let unrelated_changes = diff(&registry, &changed, &unrelated_changed);
    assert!(commands_for_changes(adapter, &unrelated_changes)
        .unwrap()
        .is_empty());
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum GraphicsCommand {
    SetVsync(bool),
}

struct GraphicsConsumer;

impl DomainSettingsAdapter for GraphicsConsumer {
    type Command = GraphicsCommand;
    type Error = Infallible;

    fn descriptor(&self) -> AdapterDescriptor {
        AdapterDescriptor::new([SettingDefinition {
            id: id("video.vsync"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        }])
        .with_capability(capability("renderer.vsync"), true)
    }

    fn command_for_change(
        &self,
        change: &settings_core::SettingChange,
    ) -> Result<Option<Self::Command>, Self::Error> {
        if change.id.as_str() != "video.vsync" {
            return Ok(None);
        }
        match &change.after {
            SettingValue::Bool(value) => Ok(Some(GraphicsCommand::SetVsync(*value))),
            _ => unreachable!("video.vsync is registered as a boolean"),
        }
    }
}

impl GraphicsSettingsAdapter for GraphicsConsumer {}

#[derive(Clone, Debug, PartialEq, Eq)]
enum AudioCommand {
    SetVolume(i64),
}

struct AudioConsumer;

impl DomainSettingsAdapter for AudioConsumer {
    type Command = AudioCommand;
    type Error = Infallible;

    fn descriptor(&self) -> AdapterDescriptor {
        AdapterDescriptor::new([SettingDefinition {
            id: id("audio.volume"),
            kind: SettingKind::Integer { min: 0, max: 100 },
            default: SettingValue::Integer(80),
            scope: SettingScope::User,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        }])
    }

    fn command_for_change(
        &self,
        change: &settings_core::SettingChange,
    ) -> Result<Option<Self::Command>, Self::Error> {
        if change.id.as_str() != "audio.volume" {
            return Ok(None);
        }
        match &change.after {
            SettingValue::Integer(value) => Ok(Some(AudioCommand::SetVolume(*value))),
            _ => unreachable!("audio.volume is registered as an integer"),
        }
    }
}

impl AudioSettingsAdapter for AudioConsumer {}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ApplicationCommand {
    SetAutoPause(bool),
}

struct ApplicationConsumer;

impl DomainSettingsAdapter for ApplicationConsumer {
    type Command = ApplicationCommand;
    type Error = Infallible;

    fn descriptor(&self) -> AdapterDescriptor {
        AdapterDescriptor::new([SettingDefinition {
            id: id("game.auto_pause"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(true),
            scope: SettingScope::Save,
            apply_mode: ApplyMode::Immediate,
            availability: None,
        }])
    }

    fn command_for_change(
        &self,
        change: &settings_core::SettingChange,
    ) -> Result<Option<Self::Command>, Self::Error> {
        if change.id.as_str() != "game.auto_pause" {
            return Ok(None);
        }
        match &change.after {
            SettingValue::Bool(value) => Ok(Some(ApplicationCommand::SetAutoPause(*value))),
            _ => unreachable!("game.auto_pause is registered as a boolean"),
        }
    }
}

impl ApplicationSettingsAdapter for ApplicationConsumer {}

#[test]
fn graphics_consumer_conforms_to_adapter_boundaries() {
    assert_consumer_conformance(
        &GraphicsConsumer,
        "video.vsync",
        SettingValue::Bool(false),
        SettingValue::Bool(true),
        GraphicsCommand::SetVsync(true),
    );
}

#[test]
fn audio_consumer_conforms_to_adapter_boundaries() {
    assert_consumer_conformance(
        &AudioConsumer,
        "audio.volume",
        SettingValue::Integer(80),
        SettingValue::Integer(35),
        AudioCommand::SetVolume(35),
    );
}

#[test]
fn application_consumer_conforms_to_adapter_boundaries() {
    assert_consumer_conformance(
        &ApplicationConsumer,
        "game.auto_pause",
        SettingValue::Bool(true),
        SettingValue::Bool(false),
        ApplicationCommand::SetAutoPause(false),
    );
}
