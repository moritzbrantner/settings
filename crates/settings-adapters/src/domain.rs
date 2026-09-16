use settings_core::{
    CapabilityFacts, CapabilityId, RegistryError, SettingChange, SettingDefinition, SettingsRegistry,
};
use thiserror::Error;

/// Settings and capability facts exposed by one domain-owned subsystem.
///
/// Definitions remain ordinary `settings-core` definitions. Capability facts describe what the
/// owning subsystem reports at composition time; they are not inferred by this crate.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AdapterDescriptor {
    definitions: Vec<SettingDefinition>,
    capabilities: Vec<(CapabilityId, bool)>,
}

impl AdapterDescriptor {
    pub fn new(definitions: impl IntoIterator<Item = SettingDefinition>) -> Self {
        Self {
            definitions: definitions.into_iter().collect(),
            capabilities: Vec::new(),
        }
    }

    /// Adds one domain-reported capability fact.
    ///
    /// Declarations are intentionally retained rather than collapsed into a map. This lets atomic
    /// installation reject contradictory duplicate facts instead of making builder order semantic.
    pub fn with_capability(mut self, id: CapabilityId, value: bool) -> Self {
        self.capabilities.push((id, value));
        self
    }

    pub fn definitions(&self) -> &[SettingDefinition] {
        &self.definitions
    }

    pub fn capabilities(&self) -> impl Iterator<Item = (&CapabilityId, bool)> {
        self.capabilities.iter().map(|(id, value)| (id, *value))
    }
}

#[derive(Clone, Debug, PartialEq, Error)]
pub enum AdapterInstallError {
    #[error(transparent)]
    Registry(#[from] RegistryError),
    #[error(
        "capability `{id}` conflicts with an existing fact: existing={existing}, incoming={incoming}"
    )]
    CapabilityConflict {
        id: CapabilityId,
        existing: bool,
        incoming: bool,
    },
}

/// Atomically registers a domain descriptor into the shared settings composition state.
///
/// On failure neither the registry nor the capability facts are changed. This keeps adapter
/// installation equivalent to ordinary core registration while preventing partially installed
/// domains.
pub fn install_adapter_descriptor(
    registry: &mut SettingsRegistry,
    capabilities: &mut CapabilityFacts,
    descriptor: &AdapterDescriptor,
) -> Result<(), AdapterInstallError> {
    let mut candidate_registry = registry.clone();
    let mut candidate_capabilities = capabilities.clone();

    for definition in descriptor.definitions() {
        candidate_registry.register(definition.clone())?;
    }

    for (id, incoming) in descriptor.capabilities() {
        if let Some(existing) = candidate_capabilities.get(id)
            && existing != incoming
        {
            return Err(AdapterInstallError::CapabilityConflict {
                id: id.clone(),
                existing,
                incoming,
            });
        }
        candidate_capabilities.set(id.clone(), incoming);
    }

    *registry = candidate_registry;
    *capabilities = candidate_capabilities;
    Ok(())
}

/// Translates generic setting changes into commands owned by a consuming domain.
///
/// The command and error types belong to the consumer. This crate never executes the command and
/// therefore never becomes authoritative for renderer, mixer, gameplay, or application behavior.
pub trait DomainSettingsAdapter {
    type Command;
    type Error;

    fn descriptor(&self) -> AdapterDescriptor;

    fn command_for_change(
        &self,
        change: &SettingChange,
    ) -> Result<Option<Self::Command>, Self::Error>;
}

pub fn commands_for_changes<A: DomainSettingsAdapter>(
    adapter: &A,
    changes: &[SettingChange],
) -> Result<Vec<A::Command>, A::Error> {
    let mut commands = Vec::new();
    for change in changes {
        if let Some(command) = adapter.command_for_change(change)? {
            commands.push(command);
        }
    }
    Ok(commands)
}

/// Marker contract for renderer-owned settings and capabilities.
pub trait GraphicsSettingsAdapter: DomainSettingsAdapter {}

/// Marker contract for mixer/device-owned settings and capabilities.
pub trait AudioSettingsAdapter: DomainSettingsAdapter {}

/// Marker contract for gameplay or ordinary application-owned settings.
pub trait ApplicationSettingsAdapter: DomainSettingsAdapter {}
