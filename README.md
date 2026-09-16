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
- deterministic presentation metadata using localization keys, category/group/order, search keys, and discoverability;
- a validated WASM/browser boundary with TypeScript declarations and a shared Rust/web fixture;
- an optional React presentation bridge backed by `@moritzbrantner/ui` stable primitives;
- a reference settings UI that consumes Rust-validated presentation metadata while keeping state in the settings session;
- property, compatibility, consumer-conformance, fuzz-build, benchmark-build, and allocation-evidence hardening in CI;
- Rust tests, formatting, clippy, documentation checks, and browser-distribution validation in CI.

The core deliberately has no renderer, audio, input, UI-framework, filesystem, or platform dependency. `settings-adapters` never executes domain behavior; it only registers ordinary core definitions/capabilities and translates setting changes into command types owned by consumers. `settings-accessibility` annotates ordinary setting identifiers and analyzes normal presets without taking ownership of captions, narration, camera, input, haptics, audio, or gameplay behavior. `settings-presentation` owns only presentation metadata and deterministic ordering; localized strings and concrete widgets remain consumer-owned.

## Browser consumers

The generated `browser-dist` branch is an installable typed ESM package named `@moritzbrantner/settings-browser`. It contains the canonical browser adapter, declarations, generated WASM JavaScript, and the WASM binary in one self-contained package layout.

Cross-repository consumers should pin an exact `browser-dist` commit rather than execute the mutable branch or Pages URL directly. For example, with Bun:

```bash
bun add @moritzbrantner/settings-browser@github:moritzbrantner/settings#<browser-dist-commit>
```

That keeps application builds content-addressed while allowing an intentional dependency update when a newer settings foundation is accepted.

### React UI bridge

Consumers that already use `@moritzbrantner/ui` may import `@moritzbrantner/settings-browser/react`. This optional layer maps validated settings presentation metadata to shared UI primitives without moving React or UI behavior into `settings-core`.

The first supported control is `SettingsBooleanField`, which maps a boolean definition/value plus presentation localization keys to the stable `ToggleSetting` primitive. The consumer still owns translation, current state, persistence lifecycle, and the domain behavior triggered by a setting change. Unsupported setting kinds require an explicit consumer renderer until a shared mapping is added and dogfooded.

`react` and `@moritzbrantner/ui` are optional peer dependencies so browser-only consumers of the core WASM adapter do not pull in the UI stack.

## Workspace

```text
crates/settings-core           Canonical setting model and state semantics
crates/settings-adapters       Thin domain composition contracts
crates/settings-accessibility  Cross-cutting accessibility semantics
crates/settings-presentation   Localization-keyed presentation metadata
crates/settings-wasm           Browser/WASM distribution boundary
web/                           Typed browser API, optional React bridge, and reference UI
fixtures/                      Cross-boundary deterministic fixtures
benchmarks/                    Isolated Criterion workloads and allocation evidence
fuzz/                          Isolated cargo-fuzz targets
```

Run validation with:

```bash
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps
```

CI additionally compile-checks the isolated fuzz and benchmark workspaces and uploads fixed-workload allocation evidence without using wall-clock or allocator-count thresholds as ordinary pass/fail gates.

See [ARCHITECTURE.md](ARCHITECTURE.md) for authority boundaries and [ROADMAP.md](ROADMAP.md) for the completed foundation slices.
