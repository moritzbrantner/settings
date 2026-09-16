use crate::{ApplyMode, SettingId, SettingValue, SettingsRegistry, ValidationError};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OverrideSource {
    UserOverride,
    Preset,
    Migration { from_version: u32 },
    Policy,
    CommandLineOverride,
    SessionOverride,
}

impl OverrideSource {
    pub fn is_persistable(&self) -> bool {
        matches!(
            self,
            Self::UserOverride | Self::Preset | Self::Migration { .. }
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ValueProvenance {
    Default,
    UserOverride,
    Preset,
    Migration { from_version: u32 },
    Policy,
    CommandLineOverride,
    SessionOverride,
}

impl From<&OverrideSource> for ValueProvenance {
    fn from(source: &OverrideSource) -> Self {
        match source {
            OverrideSource::UserOverride => Self::UserOverride,
            OverrideSource::Preset => Self::Preset,
            OverrideSource::Migration { from_version } => Self::Migration {
                from_version: *from_version,
            },
            OverrideSource::Policy => Self::Policy,
            OverrideSource::CommandLineOverride => Self::CommandLineOverride,
            OverrideSource::SessionOverride => Self::SessionOverride,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SettingOverride {
    pub value: SettingValue,
    pub source: OverrideSource,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SettingsState {
    durable_overrides: BTreeMap<SettingId, SettingOverride>,
    policy_overrides: BTreeMap<SettingId, SettingValue>,
    command_line_overrides: BTreeMap<SettingId, SettingValue>,
    session_overrides: BTreeMap<SettingId, SettingValue>,
}

impl SettingsState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(
        &mut self,
        registry: &SettingsRegistry,
        id: &SettingId,
        value: SettingValue,
    ) -> Result<(), ValidationError> {
        self.set_with_source(registry, id, value, OverrideSource::UserOverride)
    }

    pub fn set_with_source(
        &mut self,
        registry: &SettingsRegistry,
        id: &SettingId,
        value: SettingValue,
        source: OverrideSource,
    ) -> Result<(), ValidationError> {
        let definition = registry
            .get(id)
            .ok_or_else(|| ValidationError::UnknownSetting(id.clone()))?;
        definition.validate_value(&value)?;

        match source {
            OverrideSource::UserOverride
            | OverrideSource::Preset
            | OverrideSource::Migration { .. } => {
                if value == definition.default {
                    self.durable_overrides.remove(id);
                } else {
                    self.durable_overrides
                        .insert(id.clone(), SettingOverride { value, source });
                }
            }
            OverrideSource::Policy => {
                self.policy_overrides.insert(id.clone(), value);
            }
            OverrideSource::CommandLineOverride => {
                self.command_line_overrides.insert(id.clone(), value);
            }
            OverrideSource::SessionOverride => {
                self.session_overrides.insert(id.clone(), value);
            }
        }
        Ok(())
    }

    pub fn reset(
        &mut self,
        registry: &SettingsRegistry,
        id: &SettingId,
    ) -> Result<(), ValidationError> {
        if registry.get(id).is_none() {
            return Err(ValidationError::UnknownSetting(id.clone()));
        }
        self.durable_overrides.remove(id);
        Ok(())
    }

    pub fn clear_transient_override(&mut self, id: &SettingId, source: OverrideSource) -> bool {
        match source {
            OverrideSource::Policy => self.policy_overrides.remove(id).is_some(),
            OverrideSource::CommandLineOverride => {
                self.command_line_overrides.remove(id).is_some()
            }
            OverrideSource::SessionOverride => self.session_overrides.remove(id).is_some(),
            OverrideSource::UserOverride
            | OverrideSource::Preset
            | OverrideSource::Migration { .. } => false,
        }
    }

    pub fn merge_from(
        &mut self,
        registry: &SettingsRegistry,
        other: &SettingsState,
    ) -> Result<(), ValidationError> {
        for (id, setting_override) in &other.durable_overrides {
            self.set_with_source(
                registry,
                id,
                setting_override.value.clone(),
                setting_override.source.clone(),
            )?;
        }
        for (id, value) in &other.session_overrides {
            self.set_with_source(
                registry,
                id,
                value.clone(),
                OverrideSource::SessionOverride,
            )?;
        }
        for (id, value) in &other.command_line_overrides {
            self.set_with_source(
                registry,
                id,
                value.clone(),
                OverrideSource::CommandLineOverride,
            )?;
        }
        for (id, value) in &other.policy_overrides {
            self.set_with_source(registry, id, value.clone(), OverrideSource::Policy)?;
        }
        Ok(())
    }

    pub fn effective_value<'a>(
        &'a self,
        registry: &'a SettingsRegistry,
        id: &SettingId,
    ) -> Option<&'a SettingValue> {
        let definition = registry.get(id)?;
        if let Some(value) = valid_transient(&self.policy_overrides, definition, id) {
            return Some(value);
        }
        if let Some(value) = valid_transient(&self.command_line_overrides, definition, id) {
            return Some(value);
        }
        if let Some(value) = valid_transient(&self.session_overrides, definition, id) {
            return Some(value);
        }
        match self.durable_overrides.get(id) {
            Some(setting_override)
                if definition.validate_value(&setting_override.value).is_ok() =>
            {
                Some(&setting_override.value)
            }
            _ => Some(&definition.default),
        }
    }

    pub fn effective_provenance(
        &self,
        registry: &SettingsRegistry,
        id: &SettingId,
    ) -> Option<ValueProvenance> {
        let definition = registry.get(id)?;
        if valid_transient(&self.policy_overrides, definition, id).is_some() {
            return Some(ValueProvenance::Policy);
        }
        if valid_transient(&self.command_line_overrides, definition, id).is_some() {
            return Some(ValueProvenance::CommandLineOverride);
        }
        if valid_transient(&self.session_overrides, definition, id).is_some() {
            return Some(ValueProvenance::SessionOverride);
        }
        match self.durable_overrides.get(id) {
            Some(setting_override)
                if definition.validate_value(&setting_override.value).is_ok() =>
            {
                Some(ValueProvenance::from(&setting_override.source))
            }
            _ => Some(ValueProvenance::Default),
        }
    }

    pub fn override_value(&self, id: &SettingId) -> Option<&SettingValue> {
        self.durable_overrides
            .get(id)
            .map(|setting_override| &setting_override.value)
    }

    pub fn override_source(&self, id: &SettingId) -> Option<&OverrideSource> {
        self.durable_overrides
            .get(id)
            .map(|setting_override| &setting_override.source)
    }

    pub fn overrides(&self) -> impl Iterator<Item = (&SettingId, &SettingValue)> {
        self.durable_overrides
            .iter()
            .map(|(id, setting_override)| (id, &setting_override.value))
    }

    pub fn overrides_with_sources(&self) -> impl Iterator<Item = (&SettingId, &SettingOverride)> {
        self.durable_overrides.iter()
    }

    pub fn override_count(&self) -> usize {
        self.durable_overrides.len()
    }

    pub fn transient_override_count(&self) -> usize {
        self.policy_overrides.len()
            + self.command_line_overrides.len()
            + self.session_overrides.len()
    }
}

fn valid_transient<'a>(
    values: &'a BTreeMap<SettingId, SettingValue>,
    definition: &crate::SettingDefinition,
    id: &SettingId,
) -> Option<&'a SettingValue> {
    values
        .get(id)
        .filter(|value| definition.validate_value(value).is_ok())
}

#[derive(Clone, Debug, PartialEq)]
pub struct SettingChange {
    pub id: SettingId,
    pub before: SettingValue,
    pub after: SettingValue,
    pub apply_mode: ApplyMode,
}

pub fn diff(
    registry: &SettingsRegistry,
    before: &SettingsState,
    after: &SettingsState,
) -> Vec<SettingChange> {
    registry
        .iter()
        .filter_map(|(id, definition)| {
            let before = before.effective_value(registry, id)?;
            let after = after.effective_value(registry, id)?;
            (before != after).then(|| SettingChange {
                id: id.clone(),
                before: before.clone(),
                after: after.clone(),
                apply_mode: definition.apply_mode,
            })
        })
        .collect()
}
