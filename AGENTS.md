# Agent guidance

## Authority

`settings-core` owns generic setting semantics only. Do not move renderer, audio, input-binding, gameplay, filesystem, cloud-sync, or UI-framework behavior into the core.

Consumer defaults are authoritative. Persisted state contains overrides, not copied defaults.

## Determinism and safety

- Registration order must never affect behavior.
- Prefer ordered collections when their order is externally observable.
- Reject non-finite floating-point values.
- Unknown or invalid values must not silently become active settings.
- Resetting to a default must remove the override.
- Schema changes require compatibility/migration evidence before changing the version.

## Architecture

Keep CQS lightweight: queries and mutations should be explicit, but do not add messaging/event-sourcing/distributed infrastructure without a concrete consumer requirement.

Integrations with sibling repositories belong at adapter/composition boundaries. Avoid circular dependencies.

## Validation

Before integration run:

```bash
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps
```

Add focused correctness tests for every semantic change. Add deterministic benchmarks when optimizing representative workloads; do not replace correctness tests with timing thresholds.
