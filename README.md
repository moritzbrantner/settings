# settings

Reusable user-facing settings foundation for games, editors, and applications.

`settings-core` owns the semantics of declaring, validating, overriding, diffing, and persisting settings. Consumers remain authoritative for what a setting actually does: a renderer applies graphics changes, an audio system applies mixer/device changes, `input-bindings` owns binding semantics, and games own gameplay rules.

## MVP

The first slice provides:

- stable setting identifiers;
- typed values and constraints;
- explicit `Session`, `Save`, `Device`, and `User` scopes;
- explicit `Immediate`, `Apply`, `Restart`, and `Reconnect` apply modes;
- deterministic registration and iteration via ordered maps;
- consumer-owned defaults with delta-only user overrides;
- deterministic diffs for apply/revert orchestration;
- versioned JSON persistence with fail-closed handling of unknown or invalid entries;
- Rust tests, formatting, clippy, and documentation checks in CI.

The core deliberately has no renderer, audio, input, UI-framework, filesystem, or platform dependency.

## Workspace

```text
crates/settings-core   Canonical setting model and state semantics
```

Run validation with:

```bash
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for authority boundaries and [ROADMAP.md](ROADMAP.md) for the planned slices.
