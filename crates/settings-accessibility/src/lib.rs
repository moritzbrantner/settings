//! Cross-cutting accessibility semantics layered over `settings-core`.
//!
//! This crate describes accessibility relevance and preset impact. It does not own caption
//! rendering, narration, camera motion, audio, haptics, input behavior, or gameplay rules.

mod appearance;
mod metadata;
mod preset;

pub use appearance::register_appearance_accessibility_metadata;
pub use metadata::{
    AccessibilityBootstrapCandidate, AccessibilityBootstrapPriority, AccessibilityMetadataError,
    AccessibilityPresentationMetadata, AccessibilityRegistry, AccessibilityTag,
};
pub use preset::{
    AccessibilityPresetError, AccessibilityPresetImpact, AccessibilityPresetImpactEntry,
    analyze_accessibility_preset,
};
