//! Thin composition contracts between `settings-core` and domain-owned systems.
//!
//! This crate deliberately does not implement renderer, audio, input-binding, or gameplay
//! behavior. Consumers keep those domains authoritative and translate generic settings changes
//! into their own command types.

mod domain;
mod input_bindings;

pub use domain::{
    AdapterDescriptor, AdapterInstallError, ApplicationSettingsAdapter, AudioSettingsAdapter,
    DomainSettingsAdapter, GraphicsSettingsAdapter, commands_for_changes,
    install_adapter_descriptor,
};
pub use input_bindings::{
    InputBindingsIntegrationDescriptor, InputBindingsSurfaceId, InputBindingsSurfaceIdError,
};
