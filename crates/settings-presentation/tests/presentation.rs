use serde::Deserialize;
use settings_core::{SettingDefinition, SettingId, SettingsRegistry};
use settings_presentation::{
    Discoverability, LocalizationKey, PresentationEntry, PresentationMetadata,
    PresentationRegistry, PresentationRegistryError,
};
use std::collections::{BTreeMap, BTreeSet};

fn id(value: &str) -> SettingId {
    SettingId::new(value).unwrap()
}

fn key(value: &str) -> LocalizationKey {
    LocalizationKey::new(value).unwrap()
}

#[derive(Deserialize)]
struct ReferenceFixture {
    definitions: Vec<SettingDefinition>,
    presentation: Vec<PresentationEntry>,
    localizations: BTreeMap<String, String>,
}

fn fixture() -> ReferenceFixture {
    serde_json::from_str(include_str!(
        "../../../fixtures/presentation/reference.json"
    ))
    .unwrap()
}

fn registry(definitions: impl IntoIterator<Item = SettingDefinition>) -> SettingsRegistry {
    let mut registry = SettingsRegistry::new();
    for definition in definitions {
        registry.register(definition).unwrap();
    }
    registry
}

#[test]
fn shared_fixture_produces_deterministic_presentation_order() {
    let fixture = fixture();
    let settings = registry(fixture.definitions);
    let presentation = PresentationRegistry::from_entries(&settings, fixture.presentation).unwrap();

    assert_eq!(
        presentation
            .ordered_entries()
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "accessibility.reduce_motion",
            "accessibility.captions",
            "audio.master_volume",
            "video.fullscreen",
        ]
    );
    assert_eq!(
        fixture.localizations["settings.audio.master_volume.label"],
        "Master volume"
    );
}

#[test]
fn registration_order_never_changes_presentation_order() {
    let fixture = fixture();
    let settings = registry(fixture.definitions);
    let forward =
        PresentationRegistry::from_entries(&settings, fixture.presentation.clone()).unwrap();
    let reverse = PresentationRegistry::from_entries(
        &settings,
        fixture.presentation.into_iter().rev().collect::<Vec<_>>(),
    )
    .unwrap();

    assert_eq!(forward.ordered_entries(), reverse.ordered_entries());
}

#[test]
fn unknown_and_duplicate_metadata_fail_closed() {
    let fixture = fixture();
    let settings = registry(fixture.definitions);
    let metadata = PresentationMetadata {
        label_key: key("settings.missing.label"),
        description_key: None,
        category_key: key("settings.category.other"),
        group_key: None,
        order: 0,
        discoverability: Discoverability::SearchOnly,
        search_keys: BTreeSet::new(),
    };
    let mut presentation = PresentationRegistry::new();

    assert_eq!(
        presentation
            .register(&settings, id("missing.setting"), metadata.clone())
            .unwrap_err(),
        PresentationRegistryError::UnknownSetting(id("missing.setting"))
    );

    let known = id("audio.master_volume");
    presentation
        .register(&settings, known.clone(), metadata.clone())
        .unwrap();
    assert_eq!(
        presentation
            .register(&settings, known.clone(), metadata)
            .unwrap_err(),
        PresentationRegistryError::Duplicate(known)
    );
}

#[test]
fn localization_keys_preserve_validation_through_deserialization() {
    assert!(serde_json::from_str::<LocalizationKey>(r#"""#).is_err());
    assert!(serde_json::from_str::<LocalizationKey>(r#"" label ""#).is_err());
    assert_eq!(
        serde_json::from_str::<LocalizationKey>(r#""settings.audio.label""#).unwrap(),
        key("settings.audio.label")
    );
}
