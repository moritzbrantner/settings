//! Deterministic presentation metadata layered over `settings-core`.
//!
//! The presentation layer owns discoverability, grouping, ordering, and localization keys. It does
//! not own setting values, availability, persistence, or domain behavior.

mod model;

pub use model::{
    Discoverability, LocalizationKey, LocalizationKeyError, PresentationEntry,
    PresentationMetadata, PresentationRegistry, PresentationRegistryError,
};
