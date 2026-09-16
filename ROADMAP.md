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

- [ ] Opaque capability facts supplied by consumers/platform adapters.
- [ ] Availability rules (`all`, `any`, `not`, capability/value predicates).
- [ ] Dependency rules between settings without callbacks inside definitions.
- [ ] Explainable disabled/hidden reasons for UI consumption.
- [ ] Conservative evaluation when referenced facts/settings are missing.
- [ ] Cycle detection for setting-to-setting dependency graphs.

Example target: HDR is exposed only when the renderer reports HDR support; manual render scale can become unavailable while a mutually exclusive upscaler mode is active.

## Slice 2 — Persistence, migration, and provenance

- [ ] Explicit migration chain between schema versions.
- [ ] Per-scope snapshots so device values are not accidentally cloud-synced with user values.
- [ ] Load provenance: default, user override, preset, migration, policy, or command-line/session override.
- [ ] Atomic storage-adapter contract with crash-safe replace semantics.
- [ ] Forward-compatible unknown-entry preservation where safe.
- [ ] Import/export with deterministic canonical representation.
- [ ] Corruption diagnostics and recovery fixtures.

## Slice 3 — Presets and transactional application

- [ ] Presets as named sets of ordinary setting values, never a second source of truth.
- [ ] Preview/stage/apply/cancel transaction coordinator.
- [ ] Revert plans for immediate settings when a staged group is cancelled.
- [ ] Timed safety rollback primitive for risky display changes.
- [ ] Section-level and global reset.
- [ ] Change provenance and dirty-state queries.

Example target: switching resolution/HDR can be previewed and automatically reverted unless confirmed.

## Slice 4 — Domain adapters

Keep adapters thin and domain authority outside this repository.

- [ ] `input-bindings` integration descriptor so controls appear in a unified settings experience without duplicating binding semantics.
- [ ] Graphics adapter contract for renderer-owned capabilities and application.
- [ ] Audio adapter contract for mixer/device-owned settings.
- [ ] Gameplay/application adapter examples using consumer-owned commands.
- [ ] Shared fixtures proving adapters do not change core semantics.

## Slice 5 — Accessibility semantics

Accessibility is cross-cutting rather than a single settings category.

- [ ] Semantic tags for settings that affect motion, captions, contrast, audio cues, timing, haptics, input, and text presentation.
- [ ] Accessibility presets implemented as normal preset values.
- [ ] Conflict/explanation surface when a preset would overwrite explicit choices.
- [ ] First-launch/bootstrap query so critical accessibility options can be offered before normal navigation.
- [ ] Machine-readable presentation metadata for accessible settings UIs.

The actual caption renderer, narration, input engine, camera, and game rules remain in their owning repositories.

## Slice 6 — Presentation model and web/WASM consumption

- [ ] Stable category/group/order metadata using localization keys rather than embedded translated strings.
- [ ] Search keywords and discoverability metadata.
- [ ] Rust-to-WASM/TypeScript boundary for web editors and GitHub Pages consumers.
- [ ] Shared fixtures across Rust and web representations.
- [ ] Reference settings UI that consumes the presentation model without becoming authoritative for state.

## Slice 7 — Hardening and observability

- [ ] Property tests for registry/state invariants.
- [ ] Fuzz persisted envelopes and migration inputs.
- [ ] Deterministic benchmark workloads for large registries and change sets.
- [ ] Allocation/materialization evidence for hot settings-screen paths.
- [ ] Compatibility fixtures retained across schema versions.
- [ ] Consumer conformance tests for adapter contracts.

Performance work should add representative benchmarks rather than wall-clock pass/fail thresholds in ordinary hosted CI.

## Initial consumer targets

Use real consumers to prevent the foundation from becoming speculative:

1. `input-bindings` / a game controls screen for cross-foundation composition.
2. One renderer-backed game for graphics capability/apply semantics.
3. One game with audio and accessibility settings.
4. One non-game editor/application to verify the model stays general-purpose.
