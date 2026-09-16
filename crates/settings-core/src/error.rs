use crate::{SettingId, SettingValue};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum SettingIdError {
    #[error("setting id cannot be empty")]
    Empty,
    #[error("setting id `{0}` contains leading or trailing whitespace")]
    SurroundingWhitespace(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum CapabilityIdError {
    #[error("capability id cannot be empty")]
    Empty,
    #[error("capability id `{0}` contains leading or trailing whitespace")]
    SurroundingWhitespace(String),
}

#[derive(Clone, Debug, PartialEq, Error)]
pub enum RegistryError {
    #[error("duplicate setting id `{0}`")]
    Duplicate(SettingId),
    #[error("invalid definition for `{id}`: {reason}")]
    InvalidDefinition { id: SettingId, reason: String },
    #[error(transparent)]
    InvalidDefault(#[from] ValidationError),
}

#[derive(Clone, Debug, PartialEq, Error)]
pub enum ValidationError {
    #[error("unknown setting `{0}`")]
    UnknownSetting(SettingId),
    #[error("setting `{id}` expects {expected}, got {actual:?}")]
    TypeMismatch {
        id: SettingId,
        expected: &'static str,
        actual: SettingValue,
    },
    #[error("integer value {value} for `{id}` is outside [{min}, {max}]")]
    IntegerOutOfRange {
        id: SettingId,
        value: i64,
        min: i64,
        max: i64,
    },
    #[error("number value {value} for `{id}` is outside [{min}, {max}] or non-finite")]
    NumberOutOfRange {
        id: SettingId,
        value: f64,
        min: f64,
        max: f64,
    },
    #[error("text value for `{id}` has {actual} characters; expected [{min}, {max}]")]
    TextLength {
        id: SettingId,
        actual: usize,
        min: usize,
        max: usize,
    },
    #[error("choice `{value}` is not valid for `{id}`")]
    InvalidChoice { id: SettingId, value: String },
}

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("settings JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported settings schema version {found}; supported version is {supported}")]
    UnsupportedSchemaVersion { found: u32, supported: u32 },
}
