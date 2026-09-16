//! Deterministic, domain-agnostic semantics for user-facing settings.

mod error;
mod model;
mod persistence;
mod registry;
mod state;

pub use error::{PersistenceError, RegistryError, SettingIdError, ValidationError};
pub use model::{ApplyMode, SettingDefinition, SettingId, SettingKind, SettingScope, SettingValue};
pub use persistence::{CURRENT_SCHEMA_VERSION, LoadDiagnostic, LoadReport, decode_json, encode_json};
pub use registry::SettingsRegistry;
pub use state::{SettingChange, SettingsState, diff};
