use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use std::fmt::{Display, Formatter};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum InputBindingsSurfaceIdError {
    #[error("input-bindings surface id cannot be empty")]
    Empty,
    #[error("input-bindings surface id `{0}` contains leading or trailing whitespace")]
    SurroundingWhitespace(String),
}

/// Opaque application-composition key for an input-bindings-owned configuration surface.
///
/// The settings foundation intentionally does not model actions, chords, conflicts, profiles, or
/// binding persistence. Those remain authoritative in `input-bindings`; a consuming application
/// resolves this key to the real editor/runtime integration it already owns.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct InputBindingsSurfaceId(String);

impl InputBindingsSurfaceId {
    pub fn new(value: impl Into<String>) -> Result<Self, InputBindingsSurfaceIdError> {
        let value = value.into();
        if value.is_empty() {
            return Err(InputBindingsSurfaceIdError::Empty);
        }
        if value.trim() != value {
            return Err(InputBindingsSurfaceIdError::SurroundingWhitespace(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for InputBindingsSurfaceId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(D::Error::custom)
    }
}

impl Display for InputBindingsSurfaceId {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Declares that a unified settings experience should compose in an input-bindings-owned surface.
///
/// No binding data is mirrored here. The descriptor is only the seam by which a presentation layer
/// can ask the application composition layer to render the real `input-bindings` editor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InputBindingsIntegrationDescriptor {
    pub surface_id: InputBindingsSurfaceId,
}

impl InputBindingsIntegrationDescriptor {
    pub fn new(surface_id: InputBindingsSurfaceId) -> Self {
        Self { surface_id }
    }
}
