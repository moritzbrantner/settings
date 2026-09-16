use serde::Deserialize;
use settings_adapters::{
    AdapterDescriptor, AdapterInstallError, ApplicationSettingsAdapter, AudioSettingsAdapter,
    DomainSettingsAdapter, GraphicsSettingsAdapter, InputBindingsIntegrationDescriptor,
    InputBindingsSurfaceId, commands_for_changes, install_adapter_descriptor,
};
use settings_core::{
    ApplyMode, AvailabilityCondition, AvailabilityPolicy, AvailabilityStatus, CapabilityFacts,
    CapabilityId, SettingDefinition, SettingId, SettingKind, SettingScope, SettingValue,
    SettingsRegistry, SettingsState, UnavailableBehavior, diff, evaluate_availability,
};
use std::convert::Infallible;

fn id(value: &str) -> SettingId {
    SettingId::new(value).unwrap()
}

fn capability(value: &str) -> CapabilityId {
    CapabilityId::new(value).unwrap()
}

#[derive(Deserialize)]
struct EquivalenceFixture {
    definitions: Vec<SettingDefinition>,
    capabilities: Vec<FixtureCapability>,
}

#[derive(Deserialize)]
struct FixtureCapability {
    id: CapabilityId,
    value: bool,
}

#[test]
fn adapter_fixture_is_semantically_equivalent_to_direct_core_registration() {
    let fixture: EquivalenceFixture = serde_json::from_str(include_str!(
        "../../../fixtures/adapters/domain-equivalence.json"
    ))
    .unwrap();

    let mut descriptor = AdapterDescriptor::new(fixture.definitions.clone());
    for fact in &fixture.capabilities {
        descriptor = descriptor.with_capability(fact.id.clone(), fact.value);
    }

    let mut adapter_registry = SettingsRegistry::new();
    let mut adapter_capabilities = CapabilityFacts::new();
    install_adapter_descriptor(
        &mut adapter_registry,
        &mut adapter_capabilities,
        &descriptor,
    )
    .unwrap();

    let mut direct_registry = SettingsRegistry::new();
    for definition in fixture.definitions {
        direct_registry.register(definition).unwrap();
    }
    let mut direct_capabilities = CapabilityFacts::new();
    for fact in fixture.capabilities {
        direct_capabilities.set(fact.id, fact.value);
    }

    assert_eq!(adapter_registry, direct_registry);
    assert_eq!(adapter_capabilities, direct_capabilities);

    let state = SettingsState::new();
    let video_hdr = id("video.hdr");
    assert_eq!(
        evaluate_availability(
            &adapter_registry,
            &state,
            &adapter_capabilities,
            &video_hdr,
        )
        .unwrap()
        .status,
        AvailabilityStatus::Available
    );
    assert_eq!(
        evaluate_availability(
            &adapter_registry,
            &state,
            &adapter_capabilities,
            &video_hdr,
        ),
        evaluate_availability(
            &direct_registry,
            &state,
            &direct_capabilities,
            &video_hdr,
        )
    );
}

#[test]
fn adapter_install_is_atomic_on_capability_conflicts() {
    let mut registry = SettingsRegistry::new();
    let mut capabilities = CapabilityFacts::new();
    capabilities.set(capability("renderer.hdr"), false);

    let before_registry = registry.clone();
    let before_capabilities = capabilities.clone();
    let descriptor = AdapterDescriptor::new([SettingDefinition {
        id: id("video.hdr"),
        kind: SettingKind::Bool,
        default: SettingValue::Bool(false),
        scope: SettingScope::Device,
        apply_mode: ApplyMode::Apply,
        availability: None,
    }])
    .with_capability(capability("renderer.hdr"), true);

    let error = install_adapter_descriptor(&mut registry, &mut capabilities, &descriptor)
        .expect_err("conflicting capability must fail closed");
    assert!(matches!(
        error,
        AdapterInstallError::CapabilityConflict { .. }
    ));
    assert_eq!(registry, before_registry);
    assert_eq!(capabilities, before_capabilities);
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum RendererCommand {
    SetHdr(bool),
}

struct GraphicsAdapter;

impl DomainSettingsAdapter for GraphicsAdapter {
    type Command = RendererCommand;
    type Error = Infallible;

    fn descriptor(&self) -> AdapterDescriptor {
        AdapterDescriptor::new([SettingDefinition {
            id: id("video.hdr"),
            kind: SettingKind::Bool,
            default: SettingValue::Bool(false),
            scope: SettingScope::Device,
            apply_mode: ApplyMode::Apply,
            availability: Some(AvailabilityPolicy {
                condition: AvailabilityCondition::Capability {
                    id: capability("renderer.hdr"),
                    expected: true,
                },
                when_unavailable: UnavailableBehavior::Disable,
            }),
        }])
        .with_capability(capability("renderer.hdr"), true)
    }

    fn command_for_change(
        &self,
        change: &settings_core::SettingChange,
    ) -> Result<Option<Self::Command>, Self::Error> {
        if change.id.as_str() != "video.hdr" {
            return Ok(None);
        }
        match change.after {
            SettingValue::Bool(value) => Ok(Some(RendererCommand::SetHdr(value))),
            _ => unreachable!("registered video.hdr is always boolean"),
        }
    }
}

impl GraphicsSettingsAdapter for GraphicsAdapter {}

#[derive(Clone, Debug, PartialEq, Eq)]
enum MixerCommand {
    SetMasterVolume(i64),
}

struct AudioAdapter;

impl DomainSettingsAdapter for AudioAdapter {
    type Command = MixerCommand;
    type Error = Infallible;

    fn descriptor(&self) -> AdapterDescriptor {
        AdapterDescriptor::new([SettingDefinition {
            id: id("audio.master_volume"),
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
        if change.id.as_str() != "audio.master_volume" {
            return Ok(None);
        }
        match change.after {
            SettingValue::Integer(value) => Ok(Some(MixerCommand::SetMasterVolume(value))),
            _ => unreachable!("registered master volume is always integer"),
        }
    }
}

impl AudioSettingsAdapter for AudioAdapter {}

#[derive(Clone, Debug, PartialEq, Eq)]
enum GameCommand {
    SetAutoPause(bool),
}

struct GameAdapter;

impl DomainSettingsAdapter for GameAdapter {
    type Command = GameCommand;
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
        match change.after {
            SettingValue::Bool(value) => Ok(Some(GameCommand::SetAutoPause(value))),
            _ => unreachable!("registered game.auto_pause is always boolean"),
        }
    }
}

impl ApplicationSettingsAdapter for GameAdapter {}

#[test]
fn adapters_translate_changes_into_consumer_owned_commands_without_executing_them() {
    fn require_graphics<T: GraphicsSettingsAdapter>(_: &T) {}
    fn require_audio<T: AudioSettingsAdapter>(_: &T) {}
    fn require_application<T: ApplicationSettingsAdapter>(_: &T) {}

    let graphics = GraphicsAdapter;
    let audio = AudioAdapter;
    let game = GameAdapter;
    require_graphics(&graphics);
    require_audio(&audio);
    require_application(&game);

    let mut registry = SettingsRegistry::new();
    let mut capabilities = CapabilityFacts::new();
    for descriptor in [
        graphics.descriptor(),
        audio.descriptor(),
        game.descriptor(),
    ] {
        install_adapter_descriptor(&mut registry, &mut capabilities, &descriptor).unwrap();
    }

    let baseline = SettingsState::new();
    let mut changed = baseline.clone();
    changed
        .set(&registry, &id("video.hdr"), SettingValue::Bool(true))
        .unwrap();
    changed
        .set(
            &registry,
            &id("audio.master_volume"),
            SettingValue::Integer(35),
        )
        .unwrap();
    changed
        .set(
            &registry,
            &id("game.auto_pause"),
            SettingValue::Bool(false),
        )
        .unwrap();

    let changes = diff(&registry, &baseline, &changed);
    assert_eq!(
        commands_for_changes(&graphics, &changes).unwrap(),
        vec![RendererCommand::SetHdr(true)]
    );
    assert_eq!(
        commands_for_changes(&audio, &changes).unwrap(),
        vec![MixerCommand::SetMasterVolume(35)]
    );
    assert_eq!(
        commands_for_changes(&game, &changes).unwrap(),
        vec![GameCommand::SetAutoPause(false)]
    );
}

#[test]
fn input_bindings_descriptor_is_only_an_opaque_composition_seam() {
    let descriptor = InputBindingsIntegrationDescriptor::new(
        InputBindingsSurfaceId::new("controls.editor").unwrap(),
    );
    let json = serde_json::to_value(&descriptor).unwrap();

    assert_eq!(json, serde_json::json!({ "surface_id": "controls.editor" }));
    assert!(InputBindingsSurfaceId::new("").is_err());
    assert!(InputBindingsSurfaceId::new(" controls.editor ").is_err());
}
