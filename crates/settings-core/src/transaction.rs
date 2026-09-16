use crate::{
    ApplyMode, OverrideSource, SettingChange, SettingId, SettingValue, SettingsRegistry,
    SettingsState, ValidationError, diff,
};

#[derive(Clone, Debug, PartialEq)]
pub struct SettingsTransaction {
    baseline: SettingsState,
    staged: SettingsState,
}

impl SettingsTransaction {
    pub fn new(baseline: SettingsState) -> Self {
        Self {
            staged: baseline.clone(),
            baseline,
        }
    }

    pub fn baseline(&self) -> &SettingsState {
        &self.baseline
    }

    pub fn staged(&self) -> &SettingsState {
        &self.staged
    }

    pub fn stage_set(
        &mut self,
        registry: &SettingsRegistry,
        id: &SettingId,
        value: SettingValue,
    ) -> Result<(), ValidationError> {
        self.stage_set_with_source(registry, id, value, OverrideSource::UserOverride)
    }

    pub fn stage_set_with_source(
        &mut self,
        registry: &SettingsRegistry,
        id: &SettingId,
        value: SettingValue,
        source: OverrideSource,
    ) -> Result<(), ValidationError> {
        self.staged.set_with_source(registry, id, value, source)
    }

    pub fn stage_reset(
        &mut self,
        registry: &SettingsRegistry,
        id: &SettingId,
    ) -> Result<(), ValidationError> {
        self.staged.reset(registry, id)
    }

    pub fn stage_reset_many(
        &mut self,
        registry: &SettingsRegistry,
        ids: &[SettingId],
    ) -> Result<(), ValidationError> {
        let mut candidate = self.staged.clone();
        for id in ids {
            candidate.reset(registry, id)?;
        }
        self.staged = candidate;
        Ok(())
    }

    pub fn stage_reset_all(&mut self) {
        self.staged.reset_all();
    }

    pub fn is_dirty(&self) -> bool {
        self.baseline != self.staged
    }

    pub fn is_setting_dirty(&self, id: &SettingId) -> bool {
        !self.baseline.setting_layers_equal(&self.staged, id)
    }

    pub fn dirty_setting_ids(&self, registry: &SettingsRegistry) -> Vec<SettingId> {
        registry
            .iter()
            .filter(|(id, _)| self.is_setting_dirty(id))
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub fn pending_changes(&self, registry: &SettingsRegistry) -> Vec<SettingChange> {
        diff(registry, &self.baseline, &self.staged)
    }

    pub fn immediate_preview_changes(&self, registry: &SettingsRegistry) -> Vec<SettingChange> {
        self.pending_changes(registry)
            .into_iter()
            .filter(|change| change.apply_mode == ApplyMode::Immediate)
            .collect()
    }

    pub fn commit(self, registry: &SettingsRegistry) -> TransactionCommit {
        let changes = diff(registry, &self.baseline, &self.staged);
        TransactionCommit {
            state: self.staged,
            changes,
        }
    }

    pub fn cancel(self, registry: &SettingsRegistry) -> TransactionCancel {
        let immediate_revert = diff(registry, &self.staged, &self.baseline)
            .into_iter()
            .filter(|change| change.apply_mode == ApplyMode::Immediate)
            .collect();
        TransactionCancel {
            state: self.baseline,
            immediate_revert,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TransactionCommit {
    pub state: SettingsState,
    pub changes: Vec<SettingChange>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TransactionCancel {
    pub state: SettingsState,
    pub immediate_revert: Vec<SettingChange>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SafetyRollbackStatus {
    Pending,
    Confirmed,
    Expired,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TimedSafetyRollback {
    baseline: SettingsState,
    candidate: SettingsState,
    deadline_tick: u64,
    confirmed: bool,
}

impl TimedSafetyRollback {
    pub fn new(baseline: SettingsState, candidate: SettingsState, deadline_tick: u64) -> Self {
        Self {
            baseline,
            candidate,
            deadline_tick,
            confirmed: false,
        }
    }

    pub fn deadline_tick(&self) -> u64 {
        self.deadline_tick
    }

    pub fn status(&self, now_tick: u64) -> SafetyRollbackStatus {
        if self.confirmed {
            SafetyRollbackStatus::Confirmed
        } else if now_tick >= self.deadline_tick {
            SafetyRollbackStatus::Expired
        } else {
            SafetyRollbackStatus::Pending
        }
    }

    pub fn confirm(&mut self, now_tick: u64) -> bool {
        if self.status(now_tick) != SafetyRollbackStatus::Pending {
            return false;
        }
        self.confirmed = true;
        true
    }

    pub fn rollback_plan(&self, registry: &SettingsRegistry, now_tick: u64) -> Vec<SettingChange> {
        if self.status(now_tick) == SafetyRollbackStatus::Expired {
            diff(registry, &self.candidate, &self.baseline)
        } else {
            Vec::new()
        }
    }

    pub fn resolved_state(&self, now_tick: u64) -> Option<&SettingsState> {
        match self.status(now_tick) {
            SafetyRollbackStatus::Pending => None,
            SafetyRollbackStatus::Confirmed => Some(&self.candidate),
            SafetyRollbackStatus::Expired => Some(&self.baseline),
        }
    }
}
