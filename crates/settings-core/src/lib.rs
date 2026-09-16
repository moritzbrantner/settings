//! Deterministic, domain-agnostic semantics for user-facing settings.

mod availability;
mod error;
mod model;
mod persistence;
mod registry;
mod state;

pub use availability::{
    AvailabilityCondition, AvailabilityEvaluation, AvailabilityPolicy, AvailabilityReason,
    AvailabilityStatus, CapabilityFacts, CapabilityId, ConditionOutcome, DependencyCycle,
    UnavailableBehavior, evaluate_availability,
};
pub use error::{
    CapabilityIdError, PersistenceError, RegistryError, SettingIdError, ValidationError,
};
pub use model::{ApplyMode, SettingDefinition, SettingId, SettingKind, SettingScope, SettingValue};
pub use persistence::{
    CURRENT_SCHEMA_VERSION, LoadDiagnostic, LoadReport, decode_json, encode_json,
};
pub use registry::SettingsRegistry;
pub use state::{SettingChange, SettingsState, diff};
