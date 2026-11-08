//! Platform-independent session logic behind the WASM transport.
//!
//! Errors are plain strings so the logic stays testable on native targets; the `wasm_bindgen`
//! wrapper converts them to JavaScript errors.

use serde_json::{Map, Value, json};
use settings_core::{
    AvailabilityReason, AvailabilityStatus, CapabilityFacts, CapabilityId, LoadDiagnostic,
    LoadReport, OverrideSource, PreservedEntries, SafetyRollbackStatus, SettingChange,
    SettingDefinition, SettingId, SettingScope, SettingValue, SettingsPreset, SettingsRegistry,
    SettingsState, TimedSafetyRollback, ValueProvenance, apply_preset, diff, evaluate_availability,
    export_scope_json, import_scope_json,
};
use settings_presentation::{PresentationEntry, PresentationRegistry};
use std::collections::BTreeMap;

const ALL_SCOPES: [SettingScope; 4] = [
    SettingScope::Session,
    SettingScope::Save,
    SettingScope::Device,
    SettingScope::User,
];

/// Transient overlay layers with their browser names, in precedence order.
const OVERLAYS: [(&str, OverrideSource); 3] = [
    ("policy", OverrideSource::Policy),
    ("command_line", OverrideSource::CommandLineOverride),
    ("session", OverrideSource::SessionOverride),
];

/// Largest integer a JavaScript number represents exactly (`Number.MAX_SAFE_INTEGER`).
const MAX_SAFE_TICK: f64 = 9_007_199_254_740_991.0;

/// Committed and staged layered settings state for one browser session.
#[derive(Clone, Debug)]
pub struct SessionCore {
    registry: SettingsRegistry,
    presentation: PresentationRegistry,
    committed: BTreeMap<SettingScope, SettingsState>,
    staged: BTreeMap<SettingScope, SettingsState>,
    preserved_entries: BTreeMap<SettingScope, PreservedEntries>,
    capabilities: CapabilityFacts,
    /// Open "apply with confirmation", one core rollback per scope sharing one deadline.
    confirmation: Option<BTreeMap<SettingScope, TimedSafetyRollback>>,
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
            confirmation: None,
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

    /// Apply a preset to the committed (and mirrored staged) state atomically with `Preset`
    /// provenance; returns the committed value changes.
    pub fn set_preset_json(&mut self, preset_json: &str) -> Result<String, String> {
        let preset = self.preset(preset_json)?;
        let committed = self.with_preset(&self.committed, &preset)?;
        let staged = self.with_preset(&self.staged, &preset)?;
        let changes = self.changes(&self.committed, &committed);
        self.committed = committed;
        self.staged = staged;
        changes_json(&changes)
    }

    /// Stage a preset atomically with `Preset` provenance; returns the staged value changes.
    pub fn stage_preset_json(&mut self, preset_json: &str) -> Result<String, String> {
        let preset = self.preset(preset_json)?;
        let staged = self.with_preset(&self.staged, &preset)?;
        let changes = self.changes(&self.staged, &staged);
        self.staged = staged;
        changes_json(&changes)
    }

    /// Set one transient overlay (`policy`, `command_line` or `session`) in the committed and
    /// staged state. The durable preference beneath it is untouched and never exported.
    pub fn set_overlay_json(
        &mut self,
        raw_layer: &str,
        raw_id: &str,
        value_json: &str,
    ) -> Result<(), String> {
        let source = parse_overlay(raw_layer)?;
        let (id, scope) = self.known(raw_id)?;
        let value: SettingValue = serde_json::from_str(value_json).map_err(to_string)?;
        for states in [&mut self.committed, &mut self.staged] {
            states
                .entry(scope)
                .or_default()
                .set_with_source(&self.registry, &id, value.clone(), source.clone())
                .map_err(to_string)?;
        }
        Ok(())
    }

    /// Remove one transient overlay; returns whether it existed.
    pub fn clear_overlay(&mut self, raw_layer: &str, raw_id: &str) -> Result<bool, String> {
        let source = parse_overlay(raw_layer)?;
        let (id, scope) = self.known(raw_id)?;
        let mut removed = false;
        for states in [&mut self.committed, &mut self.staged] {
            if let Some(state) = states.get_mut(&scope) {
                removed |= state.clear_transient_override(&id, source.clone());
            }
        }
        Ok(removed)
    }

    /// Remove every overlay of one layer.
    pub fn clear_overlays(&mut self, raw_layer: &str) -> Result<(), String> {
        let source = parse_overlay(raw_layer)?;
        for state in self.committed.values_mut().chain(self.staged.values_mut()) {
            for (id, _) in self.registry.iter() {
                state.clear_transient_override(id, source.clone());
            }
        }
        Ok(())
    }

    /// Commit the staged state like `apply_staged_json`, but keep the previous committed state
    /// until `confirm_applied` succeeds before `deadline_tick`. Ticks are caller-defined monotonic
    /// integers; the session never reads a clock.
    pub fn apply_staged_with_confirmation_json(
        &mut self,
        deadline_tick: f64,
    ) -> Result<String, String> {
        let deadline = parse_tick(deadline_tick)?;
        if self.confirmation.is_some() {
            return Err("a confirmation is already open; confirm or revert it first".to_owned());
        }
        let baseline = self.committed.clone();
        let changes = self.apply_staged_json()?;
        self.confirmation = Some(
            ALL_SCOPES
                .into_iter()
                .map(|scope| {
                    let rollback = TimedSafetyRollback::new(
                        state_for(&baseline, scope).clone(),
                        state_for(&self.committed, scope).clone(),
                        deadline,
                    );
                    (scope, rollback)
                })
                .collect(),
        );
        Ok(changes)
    }

    /// `none`, `pending` or `expired` at `now_tick`.
    pub fn confirmation_status(&self, now_tick: f64) -> Result<String, String> {
        let now = parse_tick(now_tick)?;
        Ok(match self.confirmation_rollback() {
            None => "none",
            Some(rollback) => match rollback.status(now) {
                SafetyRollbackStatus::Pending => "pending",
                SafetyRollbackStatus::Expired => "expired",
                // Confirming closes the confirmation, so it is never observed as open.
                SafetyRollbackStatus::Confirmed => "none",
            },
        }
        .to_owned())
    }

    /// Keep the applied state; succeeds only while the confirmation is pending.
    pub fn confirm_applied(&mut self, now_tick: f64) -> Result<bool, String> {
        let now = parse_tick(now_tick)?;
        let Some(rollbacks) = self.confirmation.as_mut() else {
            return Ok(false);
        };
        // Every scope shares the deadline, so all confirm or none do; confirm each one.
        let results: Vec<bool> = rollbacks
            .values_mut()
            .map(|rollback| rollback.confirm(now))
            .collect();
        let confirmed = results.iter().all(|confirmed| *confirmed);
        if confirmed {
            self.confirmation = None;
        }
        Ok(confirmed)
    }

    /// Restore the pre-apply durable state if the confirmation expired at `now_tick`; returns
    /// the value changes to undo (empty while pending or when nothing is open).
    pub fn roll_back_expired_json(&mut self, now_tick: f64) -> Result<String, String> {
        let now = parse_tick(now_tick)?;
        match self.confirmation_rollback() {
            Some(rollback) if rollback.status(now) == SafetyRollbackStatus::Expired => {
                self.roll_back(now)
            }
            _ => changes_json(&[]),
        }
    }

    /// Restore the pre-apply durable state now, regardless of the deadline.
    pub fn revert_applied_json(&mut self) -> Result<String, String> {
        match self.confirmation_rollback() {
            Some(rollback) => self.roll_back(rollback.deadline_tick()),
            None => changes_json(&[]),
        }
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
            // The durable preference beneath any overlay; invalid overrides fail closed.
            let durable = staged
                .override_value(id)
                .filter(|value| definition.validate_value(value).is_ok())
                .zip(staged.override_source(id));
            let (durable_value, durable_provenance) = match durable {
                Some((value, source)) => (value, ValueProvenance::from(source)),
                None => (&definition.default, ValueProvenance::Default),
            };
            let mut overlays = Map::new();
            for (name, source) in &OVERLAYS {
                if let Some(value) = staged.transient_override_value(id, source) {
                    overlays.insert((*name).to_owned(), json!(value));
                }
            }

            states.push(json!({
                "id": id.as_str(),
                "value": value,
                "committed_value": committed_value,
                "provenance": provenance_json(&provenance),
                "default": definition.default,
                "differs_from_default": value != &definition.default,
                "durable_value": durable_value,
                "durable_provenance": provenance_json(&durable_provenance),
                "overlays": overlays,
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

    /// Legacy import result: diagnostics as Rust debug strings. Prefer `import_scope_report_json`.
    pub fn import_scope_json(&mut self, raw_scope: &str, json: &str) -> Result<String, String> {
        let report = self.import(raw_scope, json)?;
        let diagnostics = report
            .diagnostics
            .iter()
            .map(|diagnostic| format!("{diagnostic:?}"))
            .collect::<Vec<_>>();
        serde_json::to_string(&diagnostics).map_err(to_string)
    }

    /// Replace one persistent scope and return a structured load report: loaded setting ids,
    /// preserved unknown ids, applied migrations and per-entry diagnostics with reasons.
    pub fn import_scope_report_json(
        &mut self,
        raw_scope: &str,
        json: &str,
    ) -> Result<String, String> {
        let report = self.import(raw_scope, json)?;
        let report = json!({
            "scope": scope_name(report.scope),
            "loaded": report.state.overrides().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            "preserved_unknown": report
                .preserved_entries
                .iter()
                .map(|(id, _)| id)
                .collect::<Vec<_>>(),
            "migrations": report
                .migrations
                .iter()
                .map(|migration| json!({
                    "from_version": migration.from_version,
                    "to_version": migration.to_version,
                }))
                .collect::<Vec<_>>(),
            "diagnostics": report.diagnostics.iter().map(diagnostic_json).collect::<Vec<_>>(),
        });
        serde_json::to_string(&report).map_err(to_string)
    }

    /// Replace one scope's durable layer and preserved entries from a snapshot. Transient
    /// overlays are not preferences, so they survive the import unchanged.
    fn import(&mut self, raw_scope: &str, json: &str) -> Result<LoadReport, String> {
        let scope = parse_scope(raw_scope)?;
        let report = import_scope_json(&self.registry, scope, json).map_err(to_string)?;
        let mut state = report.state.clone();
        replace_overlays(
            &self.registry,
            &mut state,
            state_for(&self.committed, scope),
        )?;

        self.staged.insert(scope, state.clone());
        self.committed.insert(scope, state);
        self.preserved_entries
            .insert(scope, report.preserved_entries.clone());
        Ok(report)
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

    /// Every scope, so comparisons also cover scopes a candidate state has just introduced.
    fn scopes(&self) -> impl Iterator<Item = SettingScope> {
        ALL_SCOPES.into_iter()
    }

    fn preset(&self, preset_json: &str) -> Result<SettingsPreset, String> {
        serde_json::from_str(preset_json).map_err(to_string)
    }

    /// Apply a preset to a clone of `states`, splitting its values by setting scope. Every value
    /// validates before the clone is returned, so a bad preset leaves the caller's state intact.
    fn with_preset(
        &self,
        states: &BTreeMap<SettingScope, SettingsState>,
        preset: &SettingsPreset,
    ) -> Result<BTreeMap<SettingScope, SettingsState>, String> {
        let mut parts: BTreeMap<SettingScope, SettingsPreset> = BTreeMap::new();
        for (id, value) in &preset.values {
            let (id, scope) = self.known(id.as_str())?;
            parts
                .entry(scope)
                .or_insert_with(|| SettingsPreset::new(preset.id.clone()))
                .insert(id, value.clone());
        }
        let mut candidate = states.clone();
        for (scope, part) in parts {
            apply_preset(&self.registry, candidate.entry(scope).or_default(), &part)
                .map_err(to_string)?;
        }
        Ok(candidate)
    }

    fn confirmation_rollback(&self) -> Option<&TimedSafetyRollback> {
        self.confirmation
            .as_ref()
            .and_then(|rollbacks| rollbacks.values().next())
    }

    /// Restore every scope's pre-apply state, keeping the current transient overlays, discard
    /// staged edits and close the confirmation.
    fn roll_back(&mut self, at_tick: u64) -> Result<String, String> {
        let rollbacks = self
            .confirmation
            .as_ref()
            .ok_or("no confirmation is open")?;
        let mut restored = BTreeMap::new();
        for (scope, rollback) in rollbacks {
            let mut state = rollback
                .resolved_state(at_tick)
                .ok_or("the confirmation is still pending")?
                .clone();
            replace_overlays(
                &self.registry,
                &mut state,
                state_for(&self.committed, *scope),
            )?;
            restored.insert(*scope, state);
        }
        let changes = self.changes(&self.committed, &restored);
        self.committed = restored.clone();
        self.staged = restored;
        self.confirmation = None;
        changes_json(&changes)
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

/// Make `target`'s transient overlays equal to `source`'s, leaving its durable layer alone.
fn replace_overlays(
    registry: &SettingsRegistry,
    target: &mut SettingsState,
    source: &SettingsState,
) -> Result<(), String> {
    for (id, _) in registry.iter() {
        for (_, layer) in &OVERLAYS {
            target.clear_transient_override(id, layer.clone());
            if let Some(value) = source.transient_override_value(id, layer) {
                target
                    .set_with_source(registry, id, value.clone(), layer.clone())
                    .map_err(to_string)?;
            }
        }
    }
    Ok(())
}

fn diagnostic_json(diagnostic: &LoadDiagnostic) -> Value {
    match diagnostic {
        LoadDiagnostic::UnknownSettingPreserved { id } => {
            json!({ "type": "unknown_setting_preserved", "id": id.as_str() })
        }
        LoadDiagnostic::InvalidValue { id, reason } => {
            json!({ "type": "invalid_value", "id": id.as_str(), "reason": reason })
        }
        LoadDiagnostic::CorruptValue { id, reason } => {
            json!({ "type": "corrupt_value", "id": id.as_str(), "reason": reason })
        }
        LoadDiagnostic::InvalidIdentifier { raw_id, reason } => {
            json!({ "type": "invalid_identifier", "raw_id": raw_id, "reason": reason })
        }
        LoadDiagnostic::ScopeMismatch {
            id,
            expected,
            actual,
        } => json!({
            "type": "scope_mismatch",
            "id": id.as_str(),
            "expected": scope_name(*expected),
            "actual": scope_name(*actual),
        }),
        LoadDiagnostic::LegacyUnknownEntryDropped { id } => {
            json!({ "type": "legacy_unknown_entry_dropped", "id": id.as_str() })
        }
    }
}

fn scope_name(scope: SettingScope) -> &'static str {
    match scope {
        SettingScope::Session => "session",
        SettingScope::Save => "save",
        SettingScope::Device => "device",
        SettingScope::User => "user",
    }
}

fn parse_overlay(value: &str) -> Result<OverrideSource, String> {
    OVERLAYS
        .iter()
        .find(|(name, _)| *name == value)
        .map(|(_, source)| source.clone())
        .ok_or_else(|| format!("unknown overlay layer `{value}`"))
}

/// Ticks cross the JavaScript boundary as numbers; accept only exact non-negative integers.
fn parse_tick(tick: f64) -> Result<u64, String> {
    if tick.is_finite() && tick >= 0.0 && tick.fract() == 0.0 && tick <= MAX_SAFE_TICK {
        Ok(tick as u64)
    } else {
        Err(format!(
            "tick must be a non-negative safe integer, got {tick}"
        ))
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
