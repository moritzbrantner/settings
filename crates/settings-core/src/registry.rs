use crate::{RegistryError, SettingDefinition, SettingId};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SettingsRegistry {
    definitions: BTreeMap<SettingId, SettingDefinition>,
}

impl SettingsRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, definition: SettingDefinition) -> Result<(), RegistryError> {
        definition.validate_definition()?;
        if self.definitions.contains_key(&definition.id) {
            return Err(RegistryError::Duplicate(definition.id));
        }
        self.definitions.insert(definition.id.clone(), definition);
        Ok(())
    }

    pub fn get(&self, id: &SettingId) -> Option<&SettingDefinition> {
        self.definitions.get(id)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&SettingId, &SettingDefinition)> {
        self.definitions.iter()
    }

    pub fn len(&self) -> usize {
        self.definitions.len()
    }

    pub fn is_empty(&self) -> bool {
        self.definitions.is_empty()
    }
}
