# Roadmap

The roadmap is organized as vertical slices. Each slice must preserve deterministic semantics and the authority boundaries in `ARCHITECTURE.md`.

## Slice 0 — Foundation MVP

Implemented in the initial feature slice.

- [x] Rust 2024 workspace with a narrow `settings-core` crate.
- [x] Stable validated setting identifiers.
- [x] Typed values: boolean, integer, number, text, and choice.
- [x] Integer/number/text/choice constraints.
- [x] `Session`, `Save`, `Device`, and `User` scopes.
- [x] `Immediate`, `Apply`, `Restart`, and `Reconnect` apply modes.
- [x] Deterministic registry with duplicate rejection.
- [x] Consumer-owned defaults and delta-only overrides.
- [x] Reset-to-default canonicalization.
- [x] Deterministic before/after change sets carrying apply mode.
- [x] Versioned deterministic JSON envelope.
- [x] Fail-closed persisted-entry validation with load diagnostics.
- [x] CI for tests, clippy, rustfmt, and rustdoc.

Acceptance boundary: two different consumers can declare independent settings, mutate values, reset to defaults, diff states, persist overrides, and restore them without the core knowing anything about either consumer domain.

## Slice 1 — Capabilities and dependencies

Make availability a first-class evaluated result rather than UI ad-hoc logic.

- [x] Opaque capability facts supplied by consumers/platform adapters.
- [x] Availability rules (`all`, `any`, `not`, capability/value predicates).
- [x] Dependency rules between settings without callbacks inside definitions.
- [x] Explainable disabled/hidden reasons for UI consumption.
- [x] Conservative evaluation when referenced facts/settings are missing.
- [x] Cycle detection for setting-to-setting dependency graphs.

Example target: HDR is exposed only when the renderer reports HDR support; manual render scale can become unavailable while a mutually exclusive upscaler mode is active.

Acceptance boundary: capability names remain opaque to the core; a renderer can explicitly report HDR support, setting values can declaratively gate other settings, missing evidence remains unknown rather than being guessed, and cyclic setting dependencies are reported deterministically independent of registration order.

## Slice 2 — Persistence, migration, and provenance

- [x] Explicit migration chain between schema versions.
- [x] Per-scope snapshots so device values are not accidentally cloud-synced with user values.
- [x] Load provenance: default, user override, preset, migration, policy, or command-line/session override.
- [x] Atomic storage-adapter contract with crash-safe replace semantics.
- [x] Forward-compatible unknown-entry preservation where safe.
- [x] Import/export with deterministic canonical representation.
- [x] Corruption diagnostics and recovery fixtures.

Schema v2 stores one `Save`, `Device`, or `User` scope per snapshot. `Session` is deliberately non-persistent. Migration from the legacy mixed-scope v1 envelope is explicit: known entries are partitioned through the current registry, while unknown legacy entries are dropped because their scope cannot be proven safely. Unknown v2 entries are retained verbatim because the enclosing snapshot supplies a trustworthy scope boundary.

Acceptance boundary: user/device/save snapshots can be stored independently and merged into one runtime state; migrations and runtime override sources remain explainable; transient policy/command-line/session values do not leak into durable preferences; compatible corruption recovers safe entries with diagnostics; and re-exporting a recovered v2 snapshot is canonical and preserves safe unknown entries.

## Slice 3 — Presets and transactional application

- [x] Presets as named sets of ordinary setting values, never a second source of truth.
- [x] Preview/stage/apply/cancel transaction coordinator.
- [x] Revert plans for immediate settings when a staged group is cancelled.
- [x] Timed safety rollback primitive for risky display changes.
- [x] Section-level and global reset.
- [x] Change provenance and dirty-state queries.

Section reset is expressed as `stage_reset_many` over identifiers supplied by the presentation/application layer; `settings-core` does not invent section/category ownership before the presentation-model slice. Global reset clears durable preferences while leaving policy, command-line, and session overlays intact.

Example target: switching resolution/HDR can be staged and applied, wrapped in a timed confirmation guard, and deterministically reverted unless confirmed. Immediate settings such as volume can be previewed while editing and receive an explicit reverse change plan on cancel.

Acceptance boundary: applying a preset is atomic and uses ordinary validated setting values with preset provenance; transactions never mutate their baseline; dirty-state detects durable, provenance, and transient-layer edits; cancel returns only immediate effects that consumers may need to reverse; commit returns deterministic value changes with before/after provenance; a preset can update the durable preference beneath an active policy without faking a runtime effect; and safety rollback uses caller-supplied monotonic ticks, cannot resolve while pending, and deterministically selects candidate or baseline only after confirmation or expiry.

## Slice 4 — Domain adapters

Keep adapters thin and domain authority outside this repository.

- [x] `input-bindings` integration descriptor so controls appear in a unified settings experience without duplicating binding semantics.
- [x] Graphics adapter contract for renderer-owned capabilities and application.
- [x] Audio adapter contract for mixer/device-owned settings.
- [x] Gameplay/application adapter examples using consumer-owned commands.
- [x] Shared fixtures proving adapters do not change core semantics.

`settings-adapters` contains only composition contracts. Domain adapters expose ordinary `settings-core` definitions and capability facts, then translate committed changes into consumer-owned command types; the crate never executes renderer, mixer, gameplay, or application behavior. Adapter installation is atomic and rejects contradictory capability facts rather than partially mutating the shared registry.

The `input-bindings` seam is deliberately only an opaque configuration-surface identifier. Actions, chords, contexts, conflicts, profiles, persistence, and the actual editor remain authoritative in the `input-bindings` repository and are not mirrored as generic setting values.

Acceptance boundary: installing an adapter produces the same registry, availability, and setting semantics as direct `settings-core` registration; conflicting installation fails without partial state; graphics/audio/application examples emit only consumer-owned commands; and the input-bindings descriptor contains no binding model to drift from the authoritative foundation.

## Slice 5 — Accessibility semantics

Accessibility is cross-cutting rather than a single settings category.

- [x] Semantic tags for settings that affect motion, captions, contrast, audio cues, timing, haptics, input, and text presentation.
- [x] Accessibility presets implemented as normal preset values.
- [x] Conflict/explanation surface when a preset would overwrite explicit choices.
- [x] First-launch/bootstrap query so critical accessibility options can be offered before normal navigation.
- [x] Machine-readable presentation metadata for accessible settings UIs.

`settings-accessibility` keeps accessibility metadata separate from ordinary setting definitions, so a setting can participate in several accessibility facets without turning those facets into mutually exclusive categories. Metadata registration is validated against the ordinary settings registry and iterates deterministically by setting identifier.

Accessibility presets remain ordinary `SettingsPreset` values. Before applying one, `analyze_accessibility_preset` validates that every target is accessibility-tagged and returns a structured impact report covering the durable preference, the currently effective value/provenance, and whether the preset would replace an explicit user choice. This remains correct when a policy or other transient override masks the durable value.

Bootstrap metadata carries only accessibility-specific priority. The application owns the decision that it is in a first-launch/bootstrap flow; the settings foundation does not infer first launch from the absence of overrides. General localization keys, categories, search metadata, and layout ordering remain part of Slice 6.

The actual caption renderer, narration, input engine, camera, haptics, audio behavior, and game rules remain in their owning repositories.

Acceptance boundary: accessibility metadata cannot reference unknown settings, empty or duplicate metadata fails closed, multiple semantic tags remain machine-readable, bootstrap candidates are ordered deterministically, accessibility presets use the canonical core preset path, and explicit-choice conflicts remain explainable even when the runtime value is masked by a transient override.

## Slice 6 — Presentation model and web/WASM consumption

- [x] Stable category/group/order metadata using localization keys rather than embedded translated strings.
- [x] Search keywords and discoverability metadata.
- [x] Rust-to-WASM/TypeScript boundary for web editors and GitHub Pages consumers.
- [x] Shared fixtures across Rust and web representations.
- [x] Reference settings UI that consumes the presentation model without becoming authoritative for state.

`settings-presentation` is a separate layer keyed by ordinary `SettingId`s. It carries stable localization keys, category/group membership, deterministic order, discoverability, and localized-search keys without introducing translated strings or UI-framework concepts into `settings-core`. Unknown or duplicate presentation entries fail closed, and observable ordering is independent of registration order.

`settings-wasm` validates presentation entries against the canonical Rust settings registry and returns them in Rust-defined order. The browser wrapper remains an adapter over that session and ships TypeScript declarations; it does not duplicate validation, persistence, migration, or ordering semantics. The reference UI resolves localization keys, implements search/discoverability, and reads/writes values through the settings session rather than owning settings state.

`fixtures/presentation/reference.json` is consumed directly by Rust acceptance tests and by the browser reference UI. Browser CI independently verifies its presentation/localization shape, then publishes that exact fixture with the generated WASM package and reference UI.

Acceptance boundary: registration order cannot change presentation order; localization keys remain validated identifiers rather than translated text; presentation metadata cannot reference unknown settings; browser consumers receive the canonical Rust ordering through WASM; the shared fixture is validated from both Rust and JavaScript; and UI filtering never becomes a second source of truth for setting values.

## Slice 7 — Hardening and observability

- [x] Property tests for registry/state invariants.
- [x] Fuzz persisted envelopes and migration inputs.
- [x] Deterministic benchmark workloads for large registries and change sets.
- [x] Allocation/materialization evidence for hot settings-screen paths.
- [x] Compatibility fixtures retained across schema versions.
- [x] Consumer conformance tests for adapter contracts.

Property tests cover transient precedence independent of mutation order, durable default canonicalization, canonical scope round-trips, and directional diff symmetry.

`fuzz/` is an isolated cargo-fuzz workspace whose targets exercise arbitrary persisted envelopes and forced v1 migration objects. CI compile-checks the targets on stable; longer fuzz campaigns remain explicit work rather than nondeterministic pull-request gates.

`benchmarks/` is an isolated Criterion workspace with deterministic 100, 1,000, and 5,000-setting workloads for effective scans, sparse diffs, and presentation materialization. CI compiles and lints these workloads but intentionally does not gate on wall-clock timing.

The allocation-evidence binary records allocation calls and requested bytes for a fixed 1,000-setting settings-screen workload and uploads its JSON output as a CI artifact. These figures are evidence, not allocator-specific pass/fail thresholds.

Retained compatibility goldens lock v1-to-v2 canonical user/device migration output and v2 unknown-entry preservation. Adapter conformance tests exercise representative graphics, audio, and application consumers, requiring owned changes to map to consumer commands while unrelated changes remain ignored.

Acceptance boundary: runtime crates do not depend on fuzz or benchmark tooling; property, compatibility, and consumer-conformance suites pass; fuzz/benchmark harnesses compile on stable; fixed-workload allocation evidence is produced; and ordinary CI does not depend on timing or allocator-count thresholds.

## Initial consumer targets

Use real consumers to prevent the foundation from becoming speculative:

1. `input-bindings` / a game controls screen for cross-foundation composition.
2. One renderer-backed game for graphics capability/apply semantics.
3. One game with audio and accessibility settings.
4. One non-game editor/application to verify the model stays general-purpose.
