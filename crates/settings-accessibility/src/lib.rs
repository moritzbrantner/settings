//! Cross-cutting accessibility semantics layered over `settings-core`.
//!
//! This crate describes accessibility relevance and preset impact. It does not own caption
//! rendering, narration, camera motion, audio, haptics, input behavior, or gameplay rules.

mod metadata;
mod preset;

pub use metadata::{
    AccessibilityBootstrapCandidate, AccessibilityBootstrapPriority, AccessibilityMetadataError,
    AccessibilityPresentationMetadata, AccessibilityRegistry, AccessibilityTag,
};
pub use preset::{
    AccessibilityPresetError, AccessibilityPresetImpact, AccessibilityPresetImpactEntry,
    analyze_accessibility_preset,
};
