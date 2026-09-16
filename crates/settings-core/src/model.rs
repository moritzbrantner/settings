use crate::{RegistryError, SettingIdError, ValidationError};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;
use std::fmt::{Display, Formatter};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct SettingId(String);

impl SettingId {
    pub fn new(value: impl Into<String>) -> Result<Self, SettingIdError> {
        let value = value.into();
        if value.is_empty() {
            return Err(SettingIdError::Empty);
        }
        if value.trim() != value {
            return Err(SettingIdError::SurroundingWhitespace(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for SettingId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(D::Error::custom)
    }
}

impl Display for SettingId {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingScope {
    Session,
    Save,
    Device,
    User,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApplyMode {
    Immediate,
    Apply,
    Restart,
    Reconnect,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum SettingValue {
    Bool(bool),
    Integer(i64),
    Number(f64),
    Text(String),
    Choice(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SettingKind {
    Bool,
    Integer { min: i64, max: i64 },
    Number { min: f64, max: f64 },
    Text { min_chars: usize, max_chars: usize },
    Choice { options: Vec<String> },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SettingDefinition {
    pub id: SettingId,
    pub kind: SettingKind,
    pub default: SettingValue,
    pub scope: SettingScope,
    pub apply_mode: ApplyMode,
}

impl SettingDefinition {
    pub fn validate_definition(&self) -> Result<(), RegistryError> {
        match &self.kind {
            SettingKind::Integer { min, max } if min > max => {
                return Err(RegistryError::InvalidDefinition {
                    id: self.id.clone(),
                    reason: format!("integer minimum {min} exceeds maximum {max}"),
                });
            }
            SettingKind::Number { min, max }
                if !min.is_finite() || !max.is_finite() || min > max =>
            {
                return Err(RegistryError::InvalidDefinition {
                    id: self.id.clone(),
                    reason: "number bounds must be finite and ordered".into(),
                });
            }
            SettingKind::Text {
                min_chars,
                max_chars,
            } if min_chars > max_chars => {
                return Err(RegistryError::InvalidDefinition {
                    id: self.id.clone(),
                    reason: format!("text minimum {min_chars} exceeds maximum {max_chars}"),
                });
            }
            SettingKind::Choice { options } => {
                if options.is_empty() {
                    return Err(RegistryError::InvalidDefinition {
                        id: self.id.clone(),
                        reason: "choice settings require at least one option".into(),
                    });
                }
                let unique: BTreeSet<_> = options.iter().collect();
                if unique.len() != options.len() {
                    return Err(RegistryError::InvalidDefinition {
                        id: self.id.clone(),
                        reason: "choice options must be unique".into(),
                    });
                }
            }
            _ => {}
        }

        self.validate_value(&self.default)?;
        Ok(())
    }

    pub fn validate_value(&self, value: &SettingValue) -> Result<(), ValidationError> {
        match (&self.kind, value) {
            (SettingKind::Bool, SettingValue::Bool(_)) => Ok(()),
            (SettingKind::Integer { min, max }, SettingValue::Integer(value)) => {
                if value < min || value > max {
                    Err(ValidationError::IntegerOutOfRange {
                        id: self.id.clone(),
                        value: *value,
                        min: *min,
                        max: *max,
                    })
                } else {
                    Ok(())
                }
            }
            (SettingKind::Number { min, max }, SettingValue::Number(value)) => {
                if !value.is_finite() || value < min || value > max {
                    Err(ValidationError::NumberOutOfRange {
                        id: self.id.clone(),
                        value: *value,
                        min: *min,
                        max: *max,
                    })
                } else {
                    Ok(())
                }
            }
            (
                SettingKind::Text {
                    min_chars,
                    max_chars,
                },
                SettingValue::Text(value),
            ) => {
                let actual = value.chars().count();
                if actual < *min_chars || actual > *max_chars {
                    Err(ValidationError::TextLength {
                        id: self.id.clone(),
                        actual,
                        min: *min_chars,
                        max: *max_chars,
                    })
                } else {
                    Ok(())
                }
            }
            (SettingKind::Choice { options }, SettingValue::Choice(value)) => {
                if options.contains(value) {
                    Ok(())
                } else {
                    Err(ValidationError::InvalidChoice {
                        id: self.id.clone(),
                        value: value.clone(),
                    })
                }
            }
            (kind, actual) => Err(ValidationError::TypeMismatch {
                id: self.id.clone(),
                expected: kind.name(),
                actual: actual.clone(),
            }),
        }
    }
}

impl SettingKind {
    fn name(&self) -> &'static str {
        match self {
            Self::Bool => "bool",
            Self::Integer { .. } => "integer",
            Self::Number { .. } => "number",
            Self::Text { .. } => "text",
            Self::Choice { .. } => "choice",
        }
    }
}
