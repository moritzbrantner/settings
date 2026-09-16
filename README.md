# settings

Reusable user-facing settings foundation for games, editors, and applications.

`settings-core` owns the semantics of declaring, validating, overriding, diffing, transacting, and persisting settings. Consumers remain authoritative for what a setting actually does: a renderer applies graphics changes, an audio system applies mixer/device changes, `input-bindings` owns binding semantics, and games own gameplay rules.

## Implemented foundation

- stable validated setting and capability identifiers;
- typed values and constraints;
- explicit `Session`, `Save`, `Device`, and `User` scopes;
- explicit `Immediate`, `Apply`, `Restart`, and `Reconnect` apply modes;
- deterministic registration, availability/dependency evaluation, and change sets;
- layered durable/transient overrides with provenance;
- per-scope versioned persistence, migration, diagnostics, and atomic-storage contracts;
- presets and transactional preview/apply/cancel flows with timed safety rollback;
- thin domain-adapter contracts for graphics, audio, gameplay/application systems;
- an opaque `input-bindings` composition descriptor that does not mirror binding semantics;
- cross-cutting accessibility tags, bootstrap metadata, and preset-impact explanations;
- a WASM/browser distribution surface for web consumers;
- Rust tests, formatting, clippy, documentation checks, and browser-distribution validation in CI.

The core deliberately has no renderer, audio, input, UI-framework, filesystem, or platform dependency. `settings-adapters` never executes domain behavior; it only registers ordinary core definitions/capabilities and translates setting changes into command types owned by consumers. `settings-accessibility` annotates ordinary setting identifiers and analyzes normal presets without taking ownership of captions, narration, camera, input, haptics, audio, or gameplay behavior.

## Workspace

```text
crates/settings-core           Canonical setting model and state semantics
crates/settings-adapters       Thin domain composition contracts
crates/settings-accessibility  Cross-cutting accessibility semantics
crates/settings-wasm           Browser/WASM distribution boundary
web/                           Browser distribution/demo assets
fixtures/                      Cross-boundary deterministic fixtures
```

Run validation with:

```bash
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for authority boundaries and [ROADMAP.md](ROADMAP.md) for the planned slices.
