# Agent guidance

## Authority

`settings-core` owns generic setting semantics only. Do not move renderer, audio, input-binding, gameplay, filesystem, cloud-sync, or UI-framework behavior into the core.

`settings-appearance` owns reusable appearance preference choices and deterministic resolution against caller-supplied system facts only. Palettes, color transforms, operating-system theme detection, CSS, and renderer behavior stay in consumers.

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

## Execution scope

These rules govern how work is sliced and when expensive checks run. They never relax Authority or Determinism and safety.

- **One task = one branch = one PR.** A task is a tracking issue or roadmap step (for example a sub-issue of the Settings Playground roadmap), including an explicitly specified core or web half as a separate task per `AGENT_TASKS.md`. Deliver the task's complete declared scope on one branch, including the crates, WASM/browser package, fixtures, web UI and docs it requires, in small commits. Do not split a task into new issues or follow-up PRs on your own; if it cannot land as one PR, stop and propose the split on the issue instead of creating it.
- **Stay inside the task.** Do not start sibling-foundation, tooling, CI, dependency-pin, maintenance or benchmark work unless the task cannot be completed without it. Note unrelated findings in one line of the PR description; do not open issues for them.
- **No new ratchets unless the task asks for one.** Do not add timing or allocation thresholds, baselines or gates on your own initiative. Existing ones stay; when a task legitimately moves one, update it in the same PR.
- **One format bump per task.** Settle persisted schema, shared fixture and public browser package API changes before implementing; a task changes each at most once, with compatibility/migration evidence.
- **Validate in tiers.** While iterating, run the focused `cargo test -p <crate>` and the commands under Validation for the touched scope. GitHub Actions is the full gate: `ci.yml` runs tests, Clippy, rustfmt, rustdoc, the fuzz/benchmark harness checks and allocation evidence; `pages.yml` builds the WASM package and validates the browser modules, shared fixture and installable package. Before pushing, run locally only what CI does not cover, such as opening the reference UI or playground in a browser for visible web changes. A red CI check blocks merge; fix it rather than re-proving it locally.
- **Codex reviews the PR.** Codex reviews automatically when a PR is opened or marked ready, so open it (or mark a draft ready) only once the branch is complete. Address or explicitly answer every Codex finding before merge; after substantial fixes, comment `@codex review` for another pass.
- **Decide and continue.** When a task leaves a design choice open, pick the simplest option consistent with this file and `ARCHITECTURE.md`, record it in the PR description and keep going.
- **Short PR descriptions.** At most about 15 lines: what changed, schema/API compatibility changes, one line naming the checks that ran, and anything not verified.

Tasks arrive as GitHub issues in the format, labels and pickup rules of `AGENT_TASKS.md`; implement only `spec:ready` issues labeled for you. Claude Opus runs the loop with the `/orchestrate` skill (`.claude/skills/orchestrate/`), preferably under `/goal` (see the skill's Pacing section); ChatGPT Sol uses the Codex `implementer-loop` skill (`.agents/skills/implementer-loop/`).
