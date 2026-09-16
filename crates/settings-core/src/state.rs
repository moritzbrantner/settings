use crate::{ApplyMode, SettingId, SettingValue, SettingsRegistry, ValidationError};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SettingsState {
    overrides: BTreeMap<SettingId, SettingValue>,
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
        let definition = registry
            .get(id)
            .ok_or_else(|| ValidationError::UnknownSetting(id.clone()))?;
        definition.validate_value(&value)?;

        if value == definition.default {
            self.overrides.remove(id);
        } else {
            self.overrides.insert(id.clone(), value);
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
        self.overrides.remove(id);
        Ok(())
    }

    pub fn effective_value<'a>(
        &'a self,
        registry: &'a SettingsRegistry,
        id: &SettingId,
    ) -> Option<&'a SettingValue> {
        self.overrides
            .get(id)
            .or_else(|| registry.get(id).map(|definition| &definition.default))
    }

    pub fn override_value(&self, id: &SettingId) -> Option<&SettingValue> {
        self.overrides.get(id)
    }

    pub fn overrides(&self) -> impl Iterator<Item = (&SettingId, &SettingValue)> {
        self.overrides.iter()
    }

    pub fn override_count(&self) -> usize {
        self.overrides.len()
    }
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
