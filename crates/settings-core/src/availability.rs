use crate::error::{CapabilityIdError, ValidationError};
use crate::model::{SettingId, SettingValue};
use crate::registry::SettingsRegistry;
use crate::state::SettingsState;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct CapabilityId(String);

impl CapabilityId {
    pub fn new(value: impl Into<String>) -> Result<Self, CapabilityIdError> {
        let value = value.into();
        if value.is_empty() {
            return Err(CapabilityIdError::Empty);
        }
        if value.trim() != value {
            return Err(CapabilityIdError::SurroundingWhitespace(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for CapabilityId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(D::Error::custom)
    }
}

impl Display for CapabilityId {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CapabilityFacts {
    facts: BTreeMap<CapabilityId, bool>,
}

impl CapabilityFacts {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&mut self, id: CapabilityId, value: bool) -> Option<bool> {
        self.facts.insert(id, value)
    }

    pub fn get(&self, id: &CapabilityId) -> Option<bool> {
        self.facts.get(id).copied()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&CapabilityId, bool)> {
        self.facts.iter().map(|(id, value)| (id, *value))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum AvailabilityCondition {
    Always,
    Capability {
        id: CapabilityId,
        expected: bool,
    },
    SettingEquals {
        id: SettingId,
        value: SettingValue,
    },
    All {
        conditions: Vec<AvailabilityCondition>,
    },
    Any {
        conditions: Vec<AvailabilityCondition>,
    },
    Not {
        condition: Box<AvailabilityCondition>,
    },
}

impl AvailabilityCondition {
    pub(crate) fn validate_structure(&self) -> Result<(), String> {
        match self {
            Self::All { conditions } | Self::Any { conditions } => {
                if conditions.is_empty() {
                    return Err("all/any availability conditions must not be empty".into());
                }
                for condition in conditions {
                    condition.validate_structure()?;
                }
                Ok(())
            }
            Self::Not { condition } => condition.validate_structure(),
            _ => Ok(()),
        }
    }

    fn collect_setting_dependencies(&self, dependencies: &mut BTreeSet<SettingId>) {
        match self {
            Self::SettingEquals { id, .. } => {
                dependencies.insert(id.clone());
            }
            Self::All { conditions } | Self::Any { conditions } => {
                for condition in conditions {
                    condition.collect_setting_dependencies(dependencies);
                }
            }
            Self::Not { condition } => condition.collect_setting_dependencies(dependencies),
            Self::Always | Self::Capability { .. } => {}
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableBehavior {
    Disable,
    Hide,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AvailabilityPolicy {
    pub condition: AvailabilityCondition,
    pub when_unavailable: UnavailableBehavior,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConditionOutcome {
    Satisfied,
    Unsatisfied,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AvailabilityStatus {
    Available,
    Disabled,
    Hidden,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AvailabilityReason {
    MissingCapability {
        id: CapabilityId,
        expected: bool,
    },
    CapabilityMismatch {
        id: CapabilityId,
        expected: bool,
        actual: bool,
    },
    MissingSetting {
        id: SettingId,
        expected: SettingValue,
    },
    InvalidSettingPredicate {
        id: SettingId,
        expected: SettingValue,
    },
    SettingValueMismatch {
        id: SettingId,
        expected: SettingValue,
        actual: SettingValue,
    },
    NegatedConditionMatched {
        condition: Box<AvailabilityCondition>,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct AvailabilityEvaluation {
    pub status: AvailabilityStatus,
    pub outcome: ConditionOutcome,
    pub reasons: Vec<AvailabilityReason>,
}

impl AvailabilityEvaluation {
    fn available() -> Self {
        Self {
            status: AvailabilityStatus::Available,
            outcome: ConditionOutcome::Satisfied,
            reasons: Vec::new(),
        }
    }
}

struct ConditionEvaluation {
    outcome: ConditionOutcome,
    reasons: Vec<AvailabilityReason>,
}

pub fn evaluate_availability(
    registry: &SettingsRegistry,
    state: &SettingsState,
    capabilities: &CapabilityFacts,
    id: &SettingId,
) -> Result<AvailabilityEvaluation, ValidationError> {
    let definition = registry
        .get(id)
        .ok_or_else(|| ValidationError::UnknownSetting(id.clone()))?;
    let Some(policy) = &definition.availability else {
        return Ok(AvailabilityEvaluation::available());
    };

    let evaluation = evaluate_condition(&policy.condition, registry, state, capabilities);
    let status = if evaluation.outcome == ConditionOutcome::Satisfied {
        AvailabilityStatus::Available
    } else {
        match policy.when_unavailable {
            UnavailableBehavior::Disable => AvailabilityStatus::Disabled,
            UnavailableBehavior::Hide => AvailabilityStatus::Hidden,
        }
    };

    Ok(AvailabilityEvaluation {
        status,
        outcome: evaluation.outcome,
        reasons: evaluation.reasons,
    })
}

fn evaluate_condition(
    condition: &AvailabilityCondition,
    registry: &SettingsRegistry,
    state: &SettingsState,
    capabilities: &CapabilityFacts,
) -> ConditionEvaluation {
    match condition {
        AvailabilityCondition::Always => ConditionEvaluation {
            outcome: ConditionOutcome::Satisfied,
            reasons: Vec::new(),
        },
        AvailabilityCondition::Capability { id, expected } => match capabilities.get(id) {
            None => ConditionEvaluation {
                outcome: ConditionOutcome::Unknown,
                reasons: vec![AvailabilityReason::MissingCapability {
                    id: id.clone(),
                    expected: *expected,
                }],
            },
            Some(actual) if actual == *expected => ConditionEvaluation {
                outcome: ConditionOutcome::Satisfied,
                reasons: Vec::new(),
            },
            Some(actual) => ConditionEvaluation {
                outcome: ConditionOutcome::Unsatisfied,
                reasons: vec![AvailabilityReason::CapabilityMismatch {
                    id: id.clone(),
                    expected: *expected,
                    actual,
                }],
            },
        },
        AvailabilityCondition::SettingEquals { id, value } => {
            let Some(definition) = registry.get(id) else {
                return ConditionEvaluation {
                    outcome: ConditionOutcome::Unknown,
                    reasons: vec![AvailabilityReason::MissingSetting {
                        id: id.clone(),
                        expected: value.clone(),
                    }],
                };
            };
            if definition.validate_value(value).is_err() {
                return ConditionEvaluation {
                    outcome: ConditionOutcome::Unknown,
                    reasons: vec![AvailabilityReason::InvalidSettingPredicate {
                        id: id.clone(),
                        expected: value.clone(),
                    }],
                };
            }

            let actual = state
                .effective_value(registry, id)
                .expect("registered settings always have an effective value");
            if actual == value {
                ConditionEvaluation {
                    outcome: ConditionOutcome::Satisfied,
                    reasons: Vec::new(),
                }
            } else {
                ConditionEvaluation {
                    outcome: ConditionOutcome::Unsatisfied,
                    reasons: vec![AvailabilityReason::SettingValueMismatch {
                        id: id.clone(),
                        expected: value.clone(),
                        actual: actual.clone(),
                    }],
                }
            }
        }
        AvailabilityCondition::All { conditions } => {
            let evaluations: Vec<_> = conditions
                .iter()
                .map(|condition| evaluate_condition(condition, registry, state, capabilities))
                .collect();
            combine_all(evaluations)
        }
        AvailabilityCondition::Any { conditions } => {
            let evaluations: Vec<_> = conditions
                .iter()
                .map(|condition| evaluate_condition(condition, registry, state, capabilities))
                .collect();
            combine_any(evaluations)
        }
        AvailabilityCondition::Not { condition } => {
            let evaluation = evaluate_condition(condition, registry, state, capabilities);
            match evaluation.outcome {
                ConditionOutcome::Satisfied => ConditionEvaluation {
                    outcome: ConditionOutcome::Unsatisfied,
                    reasons: vec![AvailabilityReason::NegatedConditionMatched {
                        condition: condition.clone(),
                    }],
                },
                ConditionOutcome::Unsatisfied => ConditionEvaluation {
                    outcome: ConditionOutcome::Satisfied,
                    reasons: Vec::new(),
                },
                ConditionOutcome::Unknown => evaluation,
            }
        }
    }
}

fn combine_all(evaluations: Vec<ConditionEvaluation>) -> ConditionEvaluation {
    if evaluations
        .iter()
        .any(|evaluation| evaluation.outcome == ConditionOutcome::Unsatisfied)
    {
        return ConditionEvaluation {
            outcome: ConditionOutcome::Unsatisfied,
            reasons: evaluations
                .into_iter()
                .filter(|evaluation| evaluation.outcome == ConditionOutcome::Unsatisfied)
                .flat_map(|evaluation| evaluation.reasons)
                .collect(),
        };
    }

    if evaluations
        .iter()
        .any(|evaluation| evaluation.outcome == ConditionOutcome::Unknown)
    {
        return ConditionEvaluation {
            outcome: ConditionOutcome::Unknown,
            reasons: evaluations
                .into_iter()
                .filter(|evaluation| evaluation.outcome == ConditionOutcome::Unknown)
                .flat_map(|evaluation| evaluation.reasons)
                .collect(),
        };
    }

    ConditionEvaluation {
        outcome: ConditionOutcome::Satisfied,
        reasons: Vec::new(),
    }
}

fn combine_any(evaluations: Vec<ConditionEvaluation>) -> ConditionEvaluation {
    if evaluations
        .iter()
        .any(|evaluation| evaluation.outcome == ConditionOutcome::Satisfied)
    {
        return ConditionEvaluation {
            outcome: ConditionOutcome::Satisfied,
            reasons: Vec::new(),
        };
    }

    if evaluations
        .iter()
        .any(|evaluation| evaluation.outcome == ConditionOutcome::Unknown)
    {
        return ConditionEvaluation {
            outcome: ConditionOutcome::Unknown,
            reasons: evaluations
                .into_iter()
                .filter(|evaluation| evaluation.outcome == ConditionOutcome::Unknown)
                .flat_map(|evaluation| evaluation.reasons)
                .collect(),
        };
    }

    ConditionEvaluation {
        outcome: ConditionOutcome::Unsatisfied,
        reasons: evaluations
            .into_iter()
            .flat_map(|evaluation| evaluation.reasons)
            .collect(),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DependencyCycle {
    pub settings: Vec<SettingId>,
}

impl SettingsRegistry {
    pub fn dependency_cycles(&self) -> Vec<DependencyCycle> {
        let graph = dependency_graph(self);
        strongly_connected_components(&graph)
            .into_iter()
            .filter(|component| {
                component.len() > 1
                    || component.first().is_some_and(|id| {
                        graph
                            .get(id)
                            .is_some_and(|dependencies| dependencies.contains(id))
                    })
            })
            .map(|settings| DependencyCycle { settings })
            .collect()
    }
}

fn dependency_graph(registry: &SettingsRegistry) -> BTreeMap<SettingId, Vec<SettingId>> {
    registry
        .iter()
        .map(|(id, definition)| {
            let mut dependencies = BTreeSet::new();
            if let Some(policy) = &definition.availability {
                policy
                    .condition
                    .collect_setting_dependencies(&mut dependencies);
            }
            let dependencies = dependencies
                .into_iter()
                .filter(|dependency| registry.get(dependency).is_some())
                .collect();
            (id.clone(), dependencies)
        })
        .collect()
}

fn strongly_connected_components(
    graph: &BTreeMap<SettingId, Vec<SettingId>>,
) -> Vec<Vec<SettingId>> {
    fn visit(
        node: &SettingId,
        graph: &BTreeMap<SettingId, Vec<SettingId>>,
        visited: &mut BTreeSet<SettingId>,
        order: &mut Vec<SettingId>,
    ) {
        if !visited.insert(node.clone()) {
            return;
        }
        if let Some(neighbors) = graph.get(node) {
            for neighbor in neighbors {
                visit(neighbor, graph, visited, order);
            }
        }
        order.push(node.clone());
    }

    fn collect(
        node: &SettingId,
        graph: &BTreeMap<SettingId, Vec<SettingId>>,
        visited: &mut BTreeSet<SettingId>,
        component: &mut Vec<SettingId>,
    ) {
        if !visited.insert(node.clone()) {
            return;
        }
        component.push(node.clone());
        if let Some(neighbors) = graph.get(node) {
            for neighbor in neighbors {
                collect(neighbor, graph, visited, component);
            }
        }
    }

    let mut visited = BTreeSet::new();
    let mut order = Vec::new();
    for node in graph.keys() {
        visit(node, graph, &mut visited, &mut order);
    }

    let mut transpose: BTreeMap<SettingId, Vec<SettingId>> =
        graph.keys().cloned().map(|id| (id, Vec::new())).collect();
    for (source, targets) in graph {
        for target in targets {
            if let Some(incoming) = transpose.get_mut(target) {
                incoming.push(source.clone());
            }
        }
    }
    for incoming in transpose.values_mut() {
        incoming.sort();
    }

    visited.clear();
    let mut components = Vec::new();
    while let Some(node) = order.pop() {
        if visited.contains(&node) {
            continue;
        }
        let mut component = Vec::new();
        collect(&node, &transpose, &mut visited, &mut component);
        component.sort();
        components.push(component);
    }
    components.sort();
    components
}
