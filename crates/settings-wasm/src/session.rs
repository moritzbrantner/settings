//! Platform-independent session logic behind the WASM transport.
//!
//! Errors are plain strings so the logic stays testable on native targets; the `wasm_bindgen`
//! wrapper converts them to JavaScript errors.

use serde_json::{Value, json};
use settings_core::{
    AvailabilityReason, AvailabilityStatus, CapabilityFacts, CapabilityId, PreservedEntries,
    SettingChange, SettingDefinition, SettingId, SettingScope, SettingValue, SettingsRegistry,
    SettingsState, ValueProvenance, diff, evaluate_availability, export_scope_json,
    import_scope_json,
};
use settings_presentation::{PresentationEntry, PresentationRegistry};
use std::collections::BTreeMap;

/// Committed and staged layered settings state for one browser session.
#[derive(Clone, Debug)]
pub struct SessionCore {
    registry: SettingsRegistry,
    presentation: PresentationRegistry,
    committed: BTreeMap<SettingScope, SettingsState>,
    staged: BTreeMap<SettingScope, SettingsState>,
    preserved_entries: BTreeMap<SettingScope, PreservedEntries>,
    capabilities: CapabilityFacts,
}

impl SessionCore {
    pub fn new(definitions_json: &str) -> Result<Self, String> {
        let definitions: Vec<SettingDefinition> =
            serde_json::from_str(definitions_json).map_err(to_string)?;
        let mut registry = SettingsRegistry::new();
        for definition in definitions {
            registry.register(definition).map_err(to_string)?;
        }

        Ok(Self {
            registry,
            presentation: PresentationRegistry::new(),
            committed: BTreeMap::new(),
            staged: BTreeMap::new(),
            preserved_entries: BTreeMap::new(),
            capabilities: CapabilityFacts::new(),
        })
    }

    pub fn load_presentation_json(&mut self, presentation_json: &str) -> Result<(), String> {
        let entries: Vec<PresentationEntry> =
            serde_json::from_str(presentation_json).map_err(to_string)?;
        self.presentation =
            PresentationRegistry::from_entries(&self.registry, entries).map_err(to_string)?;
        Ok(())
    }

    pub fn presentation_json(&self) -> Result<String, String> {
        serde_json::to_string(&self.presentation.ordered_entries()).map_err(to_string)
    }

    pub fn effective_values_json(&self) -> Result<String, String> {
        let values = self
            .registry
            .iter()
            .map(|(id, definition)| {
                let value = state_for(&self.committed, definition.scope)
                    .effective_value(&self.registry, id)
                    .unwrap_or(&definition.default)
                    .clone();
                (id.to_string(), value)
            })
            .collect::<BTreeMap<_, _>>();

        serde_json::to_string(&values).map_err(to_string)
    }

    pub fn set_json(&mut self, raw_id: &str, value_json: &str) -> Result<(), String> {
        let (id, scope) = self.known(raw_id)?;
        let value: SettingValue = serde_json::from_str(value_json).map_err(to_string)?;
        // Validation happens before any mutation, so both layers stay consistent on error.
        self.committed
            .entry(scope)
            .or_default()
            .set(&self.registry, &id, value.clone())
            .map_err(to_string)?;
        self.staged
            .entry(scope)
            .or_default()
            .set(&self.registry, &id, value)
            .map_err(to_string)
    }

    pub fn reset(&mut self, raw_id: &str) -> Result<(), String> {
        let (id, scope) = self.known(raw_id)?;
        reset_in(&mut self.committed, &self.registry, &id, scope)?;
        reset_in(&mut self.staged, &self.registry, &id, scope)
    }

    pub fn reset_many_json(&mut self, ids_json: &str) -> Result<(), String> {
        let ids = self.known_list(ids_json)?;
        for (id, scope) in &ids {
            reset_in(&mut self.committed, &self.registry, id, *scope)?;
            reset_in(&mut self.staged, &self.registry, id, *scope)?;
        }
        Ok(())
    }

    pub fn reset_all(&mut self) {
        for state in self.committed.values_mut().chain(self.staged.values_mut()) {
            state.reset_all();
        }
    }

    pub fn stage_set_json(&mut self, raw_id: &str, value_json: &str) -> Result<(), String> {
        let (id, scope) = self.known(raw_id)?;
        let value: SettingValue = serde_json::from_str(value_json).map_err(to_string)?;
        self.staged
            .entry(scope)
            .or_default()
            .set(&self.registry, &id, value)
            .map_err(to_string)
    }

    pub fn stage_reset_many_json(&mut self, ids_json: &str) -> Result<(), String> {
        let ids = self.known_list(ids_json)?;
        for (id, scope) in &ids {
            reset_in(&mut self.staged, &self.registry, id, *scope)?;
        }
        Ok(())
    }

    pub fn stage_reset_all(&mut self) {
        for state in self.staged.values_mut() {
            state.reset_all();
        }
    }

    pub fn has_staged_changes(&self) -> bool {
        self.scopes()
            .any(|scope| state_for(&self.committed, scope) != state_for(&self.staged, scope))
    }

    pub fn staged_changes_json(&self) -> Result<String, String> {
        changes_json(&self.changes(&self.committed, &self.staged))
    }

    pub fn apply_staged_json(&mut self) -> Result<String, String> {
        let changes = self.changes(&self.committed, &self.staged);
        self.committed = self.staged.clone();
        changes_json(&changes)
    }

    pub fn cancel_staged_json(&mut self) -> Result<String, String> {
        let changes = self.changes(&self.staged, &self.committed);
        self.staged = self.committed.clone();
        changes_json(&changes)
    }

    pub fn set_capabilities_json(&mut self, facts_json: &str) -> Result<(), String> {
        let raw: BTreeMap<String, bool> = serde_json::from_str(facts_json).map_err(to_string)?;
        let mut facts = CapabilityFacts::new();
        for (id, value) in raw {
            facts.set(CapabilityId::new(id).map_err(to_string)?, value);
        }
        self.capabilities = facts;
        Ok(())
    }

    pub fn setting_states_json(&self) -> Result<String, String> {
        // Dependencies may reference settings from any scope. Combine the staged layers
        // only for availability evaluation; values, provenance and persistence stay scoped.
        let mut staged_for_availability = SettingsState::new();
        for scoped_state in self.staged.values() {
            staged_for_availability
                .merge_from(&self.registry, scoped_state)
                .map_err(to_string)?;
        }

        let mut states = Vec::new();
        for (id, definition) in self.registry.iter() {
            let staged = state_for(&self.staged, definition.scope);
            let committed = state_for(&self.committed, definition.scope);
            let value = staged
                .effective_value(&self.registry, id)
                .unwrap_or(&definition.default);
            let committed_value = committed
                .effective_value(&self.registry, id)
                .unwrap_or(&definition.default);
            let provenance = staged
                .effective_provenance(&self.registry, id)
                .unwrap_or(ValueProvenance::Default);
            let staged_layer = (staged.override_value(id), staged.override_source(id));
            let committed_layer = (committed.override_value(id), committed.override_source(id));
            // Availability reads the values the user is currently editing.
            let availability = evaluate_availability(
                &self.registry,
                &staged_for_availability,
                &self.capabilities,
                id,
            )
            .map_err(to_string)?;

            states.push(json!({
                "id": id.as_str(),
                "value": value,
                "committed_value": committed_value,
                "provenance": provenance_json(&provenance),
                "overridden": staged.override_value(id).is_some(),
                "staged": staged_layer != committed_layer,
                "availability": {
                    "status": status_name(availability.status),
                    "reasons": availability.reasons.iter().map(reason_json).collect::<Vec<_>>(),
                },
            }));
        }
        serde_json::to_string(&states).map_err(to_string)
    }

    pub fn import_scope_json(&mut self, raw_scope: &str, json: &str) -> Result<String, String> {
        let scope = parse_scope(raw_scope)?;
        let report = import_scope_json(&self.registry, scope, json).map_err(to_string)?;
        let diagnostics = report
            .diagnostics
            .iter()
            .map(|diagnostic| format!("{diagnostic:?}"))
            .collect::<Vec<_>>();

        self.staged.insert(scope, report.state.clone());
        self.committed.insert(scope, report.state);
        self.preserved_entries
            .insert(scope, report.preserved_entries);

        serde_json::to_string(&diagnostics).map_err(to_string)
    }

    pub fn export_scope_json(&self, raw_scope: &str) -> Result<String, String> {
        let scope = parse_scope(raw_scope)?;
        let state = state_for(&self.committed, scope);

        if let Some(preserved_entries) = self.preserved_entries.get(&scope) {
            return export_scope_json(&self.registry, state, scope, preserved_entries)
                .map_err(to_string);
        }

        let preserved_entries = PreservedEntries::new(scope).map_err(to_string)?;
        export_scope_json(&self.registry, state, scope, &preserved_entries).map_err(to_string)
    }

    fn known(&self, raw_id: &str) -> Result<(SettingId, SettingScope), String> {
        let id = SettingId::new(raw_id).map_err(to_string)?;
        let scope = self
            .registry
            .get(&id)
            .ok_or_else(|| format!("unknown setting `{id}`"))?
            .scope;
        Ok((id, scope))
    }

    /// Parse and validate every id before any mutation so list operations are atomic.
    fn known_list(&self, ids_json: &str) -> Result<Vec<(SettingId, SettingScope)>, String> {
        let raw: Vec<String> = serde_json::from_str(ids_json).map_err(to_string)?;
        raw.iter().map(|raw_id| self.known(raw_id)).collect()
    }

    fn scopes(&self) -> impl Iterator<Item = SettingScope> + '_ {
        self.committed
            .keys()
            .chain(self.staged.keys())
            .copied()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
    }

    fn changes(
        &self,
        before: &BTreeMap<SettingScope, SettingsState>,
        after: &BTreeMap<SettingScope, SettingsState>,
    ) -> Vec<SettingChange> {
        let mut changes: Vec<_> = self
            .scopes()
            .flat_map(|scope| {
                diff(
                    &self.registry,
                    state_for(before, scope),
                    state_for(after, scope),
                )
            })
            .collect();
        changes.sort_by(|left, right| left.id.cmp(&right.id));
        changes
    }
}

static EMPTY_STATE: std::sync::LazyLock<SettingsState> =
    std::sync::LazyLock::new(SettingsState::new);

fn state_for(
    states: &BTreeMap<SettingScope, SettingsState>,
    scope: SettingScope,
) -> &SettingsState {
    states.get(&scope).unwrap_or(&EMPTY_STATE)
}

fn reset_in(
    states: &mut BTreeMap<SettingScope, SettingsState>,
    registry: &SettingsRegistry,
    id: &SettingId,
    scope: SettingScope,
) -> Result<(), String> {
    states
        .entry(scope)
        .or_default()
        .reset(registry, id)
        .map_err(to_string)
}

fn changes_json(changes: &[SettingChange]) -> Result<String, String> {
    let changes = changes
        .iter()
        .map(|change| {
            json!({
                "id": change.id.as_str(),
                "before": change.before,
                "after": change.after,
                "before_provenance": provenance_json(&change.before_provenance),
                "after_provenance": provenance_json(&change.after_provenance),
                "apply_mode": change.apply_mode,
            })
        })
        .collect::<Vec<_>>();
    serde_json::to_string(&changes).map_err(to_string)
}

fn provenance_json(provenance: &ValueProvenance) -> Value {
    match provenance {
        ValueProvenance::Default => json!({ "type": "default" }),
        ValueProvenance::UserOverride => json!({ "type": "user_override" }),
        ValueProvenance::Preset => json!({ "type": "preset" }),
        ValueProvenance::Migration { from_version } => {
            json!({ "type": "migration", "from_version": from_version })
        }
        ValueProvenance::Policy => json!({ "type": "policy" }),
        ValueProvenance::CommandLineOverride => json!({ "type": "command_line_override" }),
        ValueProvenance::SessionOverride => json!({ "type": "session_override" }),
    }
}

fn status_name(status: AvailabilityStatus) -> &'static str {
    match status {
        AvailabilityStatus::Available => "available",
        AvailabilityStatus::Disabled => "disabled",
        AvailabilityStatus::Hidden => "hidden",
    }
}

fn reason_json(reason: &AvailabilityReason) -> Value {
    match reason {
        AvailabilityReason::MissingCapability { id, expected } => {
            json!({ "type": "missing_capability", "id": id.as_str(), "expected": expected })
        }
        AvailabilityReason::CapabilityMismatch {
            id,
            expected,
            actual,
        } => json!({
            "type": "capability_mismatch",
            "id": id.as_str(),
            "expected": expected,
            "actual": actual,
        }),
        AvailabilityReason::MissingSetting { id, expected } => {
            json!({ "type": "missing_setting", "id": id.as_str(), "expected": expected })
        }
        AvailabilityReason::InvalidSettingPredicate { id, expected } => {
            json!({ "type": "invalid_setting_predicate", "id": id.as_str(), "expected": expected })
        }
        AvailabilityReason::SettingValueMismatch {
            id,
            expected,
            actual,
        } => json!({
            "type": "setting_value_mismatch",
            "id": id.as_str(),
            "expected": expected,
            "actual": actual,
        }),
        AvailabilityReason::NegatedConditionMatched { condition } => {
            json!({ "type": "negated_condition_matched", "condition": condition })
        }
    }
}

fn parse_scope(value: &str) -> Result<SettingScope, String> {
    match value {
        "session" => Ok(SettingScope::Session),
        "save" => Ok(SettingScope::Save),
        "device" => Ok(SettingScope::Device),
        "user" => Ok(SettingScope::User),
        _ => Err(format!("unknown settings scope `{value}`")),
    }
}

fn to_string(error: impl ToString) -> String {
    error.to_string()
}
