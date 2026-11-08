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
- deterministic appearance semantics for system/light/dark, normal/high/low contrast, color-vision assistance, and independent night/low-light mode;
- deterministic presentation metadata using localization keys, category/group/order, search keys, and discoverability;
- a validated WASM/browser boundary with TypeScript declarations and a shared Rust/web fixture;
- an optional React presentation bridge backed by `@moritzbrantner/ui` stable primitives;
- a reference settings UI that consumes Rust-validated presentation metadata while keeping state in the settings session;
- property, compatibility, consumer-conformance, fuzz-build, benchmark-build, and allocation-evidence hardening in CI;
- Rust tests, formatting, clippy, documentation checks, and browser-distribution validation in CI, with forward-only publication of the `browser-dist` branch.

The core deliberately has no renderer, audio, input, UI-framework, filesystem, or platform dependency. `settings-adapters` never executes domain behavior; it only registers ordinary core definitions/capabilities and translates setting changes into command types owned by consumers. `settings-accessibility` annotates ordinary setting identifiers and analyzes normal presets without taking ownership of captions, narration, camera, input, haptics, audio, or gameplay behavior. `settings-appearance` defines reusable appearance choices and resolves system-following preferences against caller-supplied platform facts, while palettes, color transforms, OS theme detection, and rendering remain consumer-owned. `settings-presentation` owns only presentation metadata and deterministic ordering; localized strings and concrete widgets remain consumer-owned.

Appearance dimensions deliberately compose instead of overriding each other. A night/low-light preference does not silently force dark mode, high and low contrast are mutually exclusive values of one setting, and a color-vision assist mode requests an accessible palette rather than a simulated impairment filter. When a preference follows the system, callers supply the system color-scheme/contrast facts; unknown facts fail closed instead of being guessed.

## Browser consumers

The generated `browser-dist` branch is an installable typed ESM package named `@moritzbrantner/settings-browser`. It contains the canonical browser adapter, declarations, generated WASM JavaScript, and the WASM binary in one self-contained package layout.

Cross-repository consumers should pin an exact `browser-dist` commit rather than execute the mutable branch or Pages URL directly. For example, with Bun:

```bash
bun add @moritzbrantner/settings-browser@github:moritzbrantner/settings#<browser-dist-commit>
```

That keeps application builds content-addressed while allowing an intentional dependency update when a newer settings foundation is accepted.

### Distribution branch

The `Browser distribution` workflow (`.github/workflows/pages.yml`) builds and validates the package, then `scripts/publish-git-dist.mjs` publishes it to `browser-dist` after every push to `main`:

- The branch only fast-forwards. Each new commit has the previous `browser-dist` tip as its parent and is pushed without force, so every commit a consumer has pinned stays reachable.
- A new commit is made only when the package contents change. A source commit that leaves the built package byte-identical publishes nothing, and the previous commit stays current.
- Each commit holds the package at the repository root, plus `.nojekyll` and a `SOURCE_SHA` file naming the source commit that produced those contents. The commit message names the same source commit and links to it.

Pull requests run the publisher's unit tests and a dry run that prepares the next commit against the current tip without pushing; the run summary shows the resulting commit and dependency specifier. To prepare the same commit locally, assemble `dist/` as the workflow does and run `node scripts/publish-git-dist.mjs --dist dist`; add `--push` only to publish.

Before forward-only publishing, every publication replaced `browser-dist` with a new unconnected commit. Only the last of those commits (`0da81df`) is part of the branch history; commits pinned from earlier publications are not reachable from any branch and should be re-pinned to a current `browser-dist` commit.

### React UI bridge

Consumers that already use `@moritzbrantner/ui` may import `@moritzbrantner/settings-browser/react`. This optional layer maps validated settings presentation metadata to shared UI primitives without moving React or UI behavior into `settings-core`.

The first supported control is `SettingsBooleanField`, which maps a boolean definition/value plus presentation localization keys to the stable `ToggleSetting` primitive. The consumer still owns translation, current state, persistence lifecycle, and the domain behavior triggered by a setting change. Unsupported setting kinds require an explicit consumer renderer until a shared mapping is added and dogfooded.

`react` and `@moritzbrantner/ui` are optional peer dependencies so browser-only consumers of the core WASM adapter do not pull in the UI stack.

### Staging, provenance and availability

`BrowserSettingsSession` keeps a committed and a staged state. `set`, `reset`, `resetMany` and `resetAll` commit directly (and replace any staged value), so consumers that never stage see the previous behavior. `stageSet`, `stageResetMany` (section reset) and `stageResetAll` (global reset) change only the staged state until `applyStaged` or `cancelStaged`; both return deterministic value-change records with apply mode and before/after provenance. `settingStates()` reports, per setting, the staged and committed values, provenance, whether a durable override exists, whether it is staged, and availability evaluated in Rust against the capability facts passed to `setCapabilities`. Resets remove overrides; they never copy defaults.

### Presets, overlays, persistence and safety confirmation (API version 2)

`SETTINGS_BROWSER_API_VERSION` 2 (package 0.4.0) only adds to version 1; existing methods keep their behavior and `importScope` stays as a deprecated alias.

- **Durable value beneath the effective one.** Each `settingStates()` entry also carries `default`, `differs_from_default`, `durable_value` and `durable_provenance` (the user/preset/migration preference beneath any overlay) and `overlays` (every transient layer present, including masked ones).
- **Presets.** `setPreset(preset)` and `stagePreset(preset)` apply a `{ id, values }` preset atomically across scopes with `preset` provenance: one invalid or unknown value rejects the whole preset. `fixtures/presentation/playground.json` ships fixed `performance` and `quality` presets with localization keys. User-created named profiles stay consumer-owned: store the per-scope `exportScope` snapshots under a name and load them with `importScopeReport`.
- **Overlays.** `setOverlay(layer, id, value)`, `clearOverlay(layer, id)` and `clearOverlays(layer?)` drive the `policy`, `command_line` and `session` layers, for example from a developer panel or URL query. Overlays are never exported, and resets and imports leave them in place.
- **Persistence.** `exportScope(scope)` returns the canonical delta-only snapshot of `user`, `device` or `save`, so it can be stored as-is (for example in `localStorage`). `importScopeReport(scope, snapshot)` migrates retained legacy snapshots and returns `{ scope, loaded, preserved_unknown, migrations, diagnostics }`. Each diagnostic names the entry and why it was preserved, rejected or dropped. A malformed envelope, unsupported schema or mismatched scope throws instead.
- **Apply with confirmation.** `applyStagedWithConfirmation(deadlineTick)` commits like `applyStaged` but keeps the previous state. `confirmApplied(nowTick)` keeps the change only before the deadline. `rollBackExpired(nowTick)` (after the deadline) or `revertApplied()` (immediately) restores the pre-apply durable state, discards staged edits, keeps overlays and returns the changes to undo. Ticks are caller-supplied non-negative integers; the session never reads a clock. Simulating a consumer apply failure belongs to the consumer adapter, which calls `revertApplied()`.

## Settings Playground

`web/playground/` is a separate example application, the realistic dogfooding consumer next to the small reference UI. It imports only `@moritzbrantner/settings-browser` (resolved to the package assembled from this commit) and `@moritzbrantner/ui` stable primitives, pinned to a `ui` commit as a git dependency. It loads `fixtures/presentation/playground.json` at runtime as `playground-settings.json` and covers every setting kind with exact numeric entry, category navigation and search, scope/apply-mode/provenance/modified state, availability reasons, Apply/Cancel, restart/reconnect notices and per-setting, section and global reset.

The Graphics category renders a live scene through the commit-pinned `3d-lab` renderer (`@moritzbrantner/three-d-renderer`). `src/graphics.ts` translates committed values into renderer commands: fog applies immediately; field of view, render scale, anti-aliasing and shadows apply after Apply (the last two recreate the renderer). Features the renderer lacks (VSync/present mode, HDR, upscaling) are reported as missing capabilities and stay disabled, and a window-mode change uses the Fullscreen API with a 15-second confirm-or-revert.

The preview scene is `asset-tooling` content. `bun run fetch:scene-kit` (part of `dev` and `build`) downloads the release tars pinned by SHA-256 in `web/playground/scene-kit.lock.json` (the immutable `humanoid-ranger-male-v9` Ranger and the `greyhaven-nature` trees, rocks and bushes), refuses any tar, manifest or content-addressed resource that does not match its pin, export ref or hash, and copies the selected entries unchanged into the ignored `.scene-kit/`. Nothing binary is committed. `src/sceneKit.ts` loads them through 3d-lab's bundle adapters; object density (staged) and draw distance (immediate) choose which deterministic placements are drawn. An asset the renderer cannot draw falls back to its next level-of-detail variant or to a proxy sized from the bundle descriptor, and the collapsible developer diagnostics under the preview show each release, tar hash, export ref and per-asset variant outcome. Provenance stays there and never becomes settings metadata.

The Simulation category runs a small bounded Rapier world (`@dimforge/rapier3d-compat`, pinned exactly) drawn by the same 3d-lab renderer with the committed graphics configuration. `src/physics.ts` is the only module that imports Rapier: it owns the demo scene, translates committed world settings into explicit commands and executes them, so a later swap to `physics-engine` replaces that adapter alone. Body count (staged) and the seed rebuild the world; gravity, bounciness (both staged) and tick rate update the running world in place; interpolation and the debug overlay only change drawing. With a fixed configuration and the scripted push at step 60 the per-step trace is exactly repeatable, and the preview publishes the digest at step 120 after each rebuild so the browser tests can compare restarts. Simulation behavior stays in the playground, never in `settings-core`.

The Controls category composes the commit-pinned `input-bindings` workbench (`@moritzbrantner/input-bindings-react`). The fixture's `input_bindings_surfaces` entry carries only the opaque `InputBindingsIntegrationDescriptor`; `src/controls.ts` resolves it to the playground's action registry and stores the binding profile as an `input-bindings` portable configuration. Bindings, conflicts and binding reset stay in that editor, while look sensitivity, invert and deadzone remain ordinary settings with their own reset.

```bash
cd web/playground
bun install --frozen-lockfile
bun run dev                          # wasm-pack build + Vite dev server
bun run serve:e2e                    # production build served at http://127.0.0.1:4317/
bunx playwright test --workers=1     # browser journeys (starts serve:e2e)
```

The independent XState contract in `web/playground/e2e/settings-machine.spec.ts` generates bounded Playwright paths for editing, staging, Apply, Cancel, and reset. It asserts the visible setting value and available actions after every transition without importing the application's transition logic. Run only those paths with `bunx playwright test --grep '@state:settings'` from `web/playground/`; they use the existing browser test server and CI gate.

## Workspace

```text
crates/settings-core           Canonical setting model and state semantics
crates/settings-adapters       Thin domain composition contracts
crates/settings-accessibility  Cross-cutting accessibility semantics
crates/settings-appearance     Appearance preference and system-resolution semantics
crates/settings-presentation   Localization-keyed presentation metadata
crates/settings-wasm           Browser/WASM distribution boundary
web/                           Typed browser API, optional React bridge, and reference UI
web/playground/                Settings Playground example application
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
