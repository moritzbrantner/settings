//! Acceptance contract for the Settings Playground fixture (issue #22).
//!
//! The playground loads `fixtures/presentation/playground.json` (same shape as the reference
//! fixture: `definitions`, `presentation`, `localizations`). These tests pin what the fixture must
//! contain so the browser journeys in `web/playground/e2e` can exercise every setting kind, every
//! apply-mode family, availability, discoverability and the canonical appearance settings without
//! hard-coding product content.

use serde::Deserialize;
use settings_adapters::InputBindingsIntegrationDescriptor;
use settings_appearance::{
    AppearanceDefaults, ColorSchemePreference, ColorVisionAssistMode, ContrastPreference,
    install_appearance_settings,
};
use settings_core::{
    ApplyMode, OverrideSource, SettingDefinition, SettingKind, SettingsPreset, SettingsRegistry,
    SettingsState, UnavailableBehavior, apply_preset,
};
use settings_presentation::{Discoverability, PresentationEntry, PresentationRegistry};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Deserialize)]
struct PlaygroundFixture {
    definitions: Vec<SettingDefinition>,
    presentation: Vec<PresentationEntry>,
    #[serde(default)]
    input_bindings_surfaces: Vec<InputBindingsSurface>,
    #[serde(default)]
    presets: Vec<FixturePreset>,
    localizations: BTreeMap<String, String>,
}

/// A fixed playground preset: canonical core preset plus consumer-owned localization keys.
#[derive(Deserialize)]
struct FixturePreset {
    #[serde(flatten)]
    preset: SettingsPreset,
    label_key: String,
    description_key: String,
}

/// Places an opaque input-bindings-owned surface in a playground category (issue #24).
#[derive(Deserialize)]
struct InputBindingsSurface {
    category_key: String,
    descriptor: InputBindingsIntegrationDescriptor,
}

fn fixture() -> PlaygroundFixture {
    serde_json::from_str(include_str!(
        "../../../fixtures/presentation/playground.json"
    ))
    .expect("playground fixture must deserialize as definitions/presentation/localizations")
}

fn registry(definitions: impl IntoIterator<Item = SettingDefinition>) -> SettingsRegistry {
    let mut registry = SettingsRegistry::new();
    for definition in definitions {
        registry
            .register(definition)
            .expect("every playground definition must register");
    }
    registry
}

fn metadata_by_id(
    fixture: &PlaygroundFixture,
) -> BTreeMap<String, &settings_presentation::PresentationMetadata> {
    fixture
        .presentation
        .iter()
        .map(|entry| (entry.id.as_str().to_owned(), &entry.metadata))
        .collect()
}

/// Settings the browser journeys may edit freely: primary discoverability and no availability
/// gate.
fn editable_primary(fixture: &PlaygroundFixture) -> Vec<&SettingDefinition> {
    let metadata = metadata_by_id(fixture);
    fixture
        .definitions
        .iter()
        .filter(|definition| definition.availability.is_none())
        .filter(|definition| {
            metadata
                .get(definition.id.as_str())
                .is_some_and(|m| m.discoverability == Discoverability::Primary)
        })
        .collect()
}

#[test]
fn playground_fixture_registers_and_presents_every_setting() {
    let fixture = fixture();
    let settings = registry(fixture.definitions.clone());
    let presentation = PresentationRegistry::from_entries(&settings, fixture.presentation.clone())
        .expect("presentation metadata must validate against the playground registry");

    let presented: BTreeSet<_> = presentation
        .ordered_entries()
        .into_iter()
        .map(|entry| entry.id.as_str().to_owned())
        .collect();
    let defined: BTreeSet<_> = fixture
        .definitions
        .iter()
        .map(|definition| definition.id.as_str().to_owned())
        .collect();
    assert_eq!(
        presented, defined,
        "every playground setting must be presented"
    );

    for entry in &fixture.presentation {
        let metadata = &entry.metadata;
        let keys = [
            Some(&metadata.label_key),
            metadata.description_key.as_ref(),
            Some(&metadata.category_key),
            metadata.group_key.as_ref(),
        ]
        .into_iter()
        .flatten()
        .chain(metadata.search_keys.iter());
        for key in keys {
            let text = fixture
                .localizations
                .get(key.as_str())
                .unwrap_or_else(|| panic!("playground localization is missing {key}"));
            assert!(
                !text.trim().is_empty(),
                "localization {key} must not be blank"
            );
        }
    }

    let labels: BTreeSet<_> = fixture
        .presentation
        .iter()
        .map(|entry| fixture.localizations[entry.metadata.label_key.as_str()].clone())
        .collect();
    assert_eq!(
        labels.len(),
        fixture.presentation.len(),
        "localized setting labels must be unique so each control has a distinct accessible name"
    );
}

#[test]
fn playground_registration_order_never_changes_presentation_order() {
    let fixture = fixture();
    let forward_settings = registry(fixture.definitions.clone());
    let reverse_settings = registry(fixture.definitions.iter().rev().cloned());
    let forward =
        PresentationRegistry::from_entries(&forward_settings, fixture.presentation.clone())
            .unwrap();
    let reverse = PresentationRegistry::from_entries(
        &reverse_settings,
        fixture
            .presentation
            .iter()
            .rev()
            .cloned()
            .collect::<Vec<_>>(),
    )
    .unwrap();

    assert_eq!(forward.ordered_entries(), reverse.ordered_entries());
}

#[test]
fn playground_covers_every_setting_kind_with_an_editable_primary_setting() {
    let fixture = fixture();
    let editable = editable_primary(&fixture);

    assert!(
        editable.iter().any(|d| matches!(d.kind, SettingKind::Bool)),
        "needs an editable primary boolean setting"
    );
    assert!(
        editable
            .iter()
            .any(|d| matches!(d.kind, SettingKind::Integer { min, max } if max - min >= 2)),
        "needs an editable primary integer setting with room for boundary tests"
    );
    assert!(
        editable
            .iter()
            .any(|d| matches!(d.kind, SettingKind::Number { min, max } if max > min)),
        "needs an editable primary number setting with a non-empty range"
    );
    assert!(
        editable.iter().any(|d| matches!(
            d.kind,
            SettingKind::Text { min_chars, max_chars } if min_chars >= 1 && max_chars > min_chars
        )),
        "needs an editable primary text setting with a non-zero minimum length"
    );
    assert!(
        editable
            .iter()
            .any(|d| matches!(&d.kind, SettingKind::Choice { options } if options.len() >= 2)),
        "needs an editable primary choice setting with at least two options"
    );
}

#[test]
fn playground_exercises_apply_modes_availability_discoverability_and_categories() {
    let fixture = fixture();
    let editable = editable_primary(&fixture);

    assert!(
        editable
            .iter()
            .any(|d| d.apply_mode == ApplyMode::Immediate),
        "needs an editable immediate setting"
    );
    assert!(
        editable.iter().any(|d| d.apply_mode == ApplyMode::Apply),
        "needs an editable staged (apply) setting for Apply/Cancel"
    );
    assert!(
        editable
            .iter()
            .any(|d| matches!(d.apply_mode, ApplyMode::Restart | ApplyMode::Reconnect)),
        "needs an editable restart or reconnect setting"
    );
    assert!(
        fixture.definitions.iter().any(|d| d
            .availability
            .as_ref()
            .is_some_and(|policy| { policy.when_unavailable == UnavailableBehavior::Disable })),
        "needs at least one capability- or dependency-gated setting that disables when unavailable"
    );
    assert!(
        fixture
            .presentation
            .iter()
            .any(|entry| entry.metadata.discoverability != Discoverability::Primary),
        "needs at least one advanced or search-only setting"
    );
    assert!(
        fixture
            .presentation
            .iter()
            .any(|entry| !entry.metadata.search_keys.is_empty()),
        "needs at least one setting with localized search keys"
    );

    let metadata = metadata_by_id(&fixture);
    let editable_categories: BTreeSet<_> = editable
        .iter()
        .map(|d| metadata[d.id.as_str()].category_key.as_str().to_owned())
        .collect();
    assert!(
        editable_categories.len() >= 2,
        "needs editable primary settings in at least two categories for section reset"
    );
}

#[test]
fn playground_includes_the_canonical_appearance_settings() {
    let fixture = fixture();
    let mut canonical = SettingsRegistry::new();
    install_appearance_settings(
        &mut canonical,
        AppearanceDefaults {
            color_scheme: ColorSchemePreference::System,
            contrast: ContrastPreference::System,
            color_vision: ColorVisionAssistMode::Off,
            night_mode: false,
        },
    )
    .unwrap();

    let by_id: BTreeMap<_, _> = fixture
        .definitions
        .iter()
        .map(|definition| (definition.id.as_str().to_owned(), definition))
        .collect();
    for (id, expected) in canonical.iter() {
        let actual = by_id
            .get(id.as_str())
            .unwrap_or_else(|| panic!("playground must include appearance setting {id}"));
        // Defaults are consumer-owned; kind, scope and apply mode are the crate's semantics.
        assert_eq!(actual.kind, expected.kind, "{id} kind");
        assert_eq!(actual.scope, expected.scope, "{id} scope");
        assert_eq!(actual.apply_mode, expected.apply_mode, "{id} apply mode");
    }
}

#[test]
fn playground_composes_the_input_bindings_editor_into_controls_without_binding_settings() {
    let fixture = fixture();
    let categories: BTreeSet<_> = fixture
        .presentation
        .iter()
        .map(|entry| entry.metadata.category_key.as_str().to_owned())
        .collect();

    let [surface] = fixture.input_bindings_surfaces.as_slice() else {
        panic!("playground must compose exactly one input-bindings surface");
    };
    assert_eq!(surface.category_key, "settings.category.controls");
    assert!(categories.contains(&surface.category_key));
    assert_eq!(
        surface.descriptor.surface_id.as_str(),
        "playground.controls"
    );

    // Bindings stay owned by input-bindings: no setting may model a binding, action or profile.
    for definition in &fixture.definitions {
        let id = definition.id.as_str();
        assert!(
            !["binding", "keybind", "shortcut", "chord"]
                .iter()
                .any(|word| id.contains(word)),
            "{id} looks like binding state; bindings belong to the input-bindings editor"
        );
    }
}

#[test]
fn playground_physics_slice_has_rebuild_in_place_and_presentation_settings() {
    // Issue #26: the playground translates these demo settings into simulation commands; the
    // fixture only declares their generic semantics.
    let fixture = fixture();
    let by_id: BTreeMap<_, _> = fixture
        .definitions
        .iter()
        .map(|definition| (definition.id.as_str(), definition))
        .collect();
    let metadata = metadata_by_id(&fixture);
    let expected = [
        ("simulation.body_count", ApplyMode::Apply),
        ("simulation.gravity", ApplyMode::Apply),
        ("simulation.restitution", ApplyMode::Apply),
        ("simulation.interpolation", ApplyMode::Immediate),
        ("simulation.tick_rate", ApplyMode::Immediate),
        ("simulation.debug_overlay", ApplyMode::Immediate),
        ("simulation.random_seed", ApplyMode::Immediate),
    ];
    for (id, mode) in expected {
        let definition = by_id
            .get(id)
            .unwrap_or_else(|| panic!("physics slice needs {id}"));
        assert_eq!(definition.apply_mode, mode, "{id} apply mode");
        assert!(definition.availability.is_none(), "{id} must stay editable");
        assert_eq!(
            metadata[id].category_key.as_str(),
            "settings.category.simulation",
            "{id} category"
        );
    }
}

#[test]
fn playground_presets_are_valid_localized_and_applied_with_preset_provenance() {
    // Issue #28: fixed Performance/Quality presets exercise preset provenance in the browser.
    let fixture = fixture();
    let registry = registry(fixture.definitions.clone());
    let ids: Vec<_> = fixture
        .presets
        .iter()
        .map(|entry| entry.preset.id.as_str())
        .collect();
    assert_eq!(ids, ["performance", "quality"]);

    for entry in &fixture.presets {
        for key in [&entry.label_key, &entry.description_key] {
            assert!(
                fixture.localizations.contains_key(key),
                "missing localization {key}"
            );
        }
        let mut state = SettingsState::new();
        apply_preset(&registry, &mut state, &entry.preset)
            .unwrap_or_else(|error| panic!("{} must apply: {error}", entry.preset.id));
        assert!(
            state
                .overrides_with_sources()
                .all(|(_, setting_override)| setting_override.source == OverrideSource::Preset)
        );
        assert!(
            state.override_count() > 0,
            "{} changes nothing",
            entry.preset.id
        );
    }

    // Both presets set the same settings, so switching between them is a complete swap.
    let keys = |index: usize| -> Vec<_> { fixture.presets[index].preset.values.keys().collect() };
    assert_eq!(keys(0), keys(1));
}
