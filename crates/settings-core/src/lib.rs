//! Deterministic, domain-agnostic semantics for user-facing settings.

mod availability;
mod error;
mod model;
mod persistence;
mod registry;
mod state;
mod storage;

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
    CURRENT_SCHEMA_VERSION, LoadDiagnostic, LoadReport, MigrationRecord, PreservedEntries,
    export_scope_json, import_scope_json,
};
pub use registry::SettingsRegistry;
pub use state::{
    OverrideSource, SettingChange, SettingOverride, SettingsState, ValueProvenance, diff,
};
pub use storage::AtomicSettingsStorage;
