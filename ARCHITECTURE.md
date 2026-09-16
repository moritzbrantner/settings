# Architecture

## Authority boundary

`settings-core` is authoritative for generic setting semantics: identity, types, constraints, defaults, scopes, apply modes, overrides, deterministic diffs, declarative availability, and the portable persistence envelope.

It is not authoritative for domain behavior.

- `input-bindings` owns key/controller binding semantics, conflict analysis, and binding profiles.
- Renderers and 3D foundations own graphics capabilities and applying graphics changes.
- Audio foundations own devices, mixers, spatial audio, and dynamic-range behavior.
- Games and applications own gameplay/application-specific settings and defaults.
- UI layers own presentation, localization, focus/navigation, and platform-native controls.

Consumers register settings and translate committed changes into their own domain commands. This prevents the settings repository from becoming a dependency magnet or a second implementation of domain behavior.

## Consumer-owned defaults, delta-owned preferences

Defaults belong to the consumer that understands the domain. `settings-core` stores only values that differ from those defaults.

That means changing a consumer default does not copy or rewrite every user's profile, while an explicit user choice still wins. Setting a value back to its current default removes the override. This mirrors the delta-based profile principle used by `input-bindings`.

## Determinism

Registration order is never semantic.

Definitions and overrides use ordered maps, so iteration, diffs, and serialized maps have stable ordering. Diffs are computed over the registry's canonical identifier order. The same registry and override set therefore produce the same effective values and change list.

Floating-point setting values must be finite. NaN and infinities are rejected because they do not provide stable equality or portable persistence semantics.

## Validation

A definition declares a value kind and constraints. Registration validates the definition and its default before it becomes visible. Writes validate against the registered definition before mutating state.

Unknown setting identifiers and invalid persisted values are fail-closed: they are not applied. Loading a schema version newer or older than the implemented version is rejected until an explicit migration exists. Known valid values can still be recovered from a version-compatible file when individual stale entries are skipped, with diagnostics returned to the caller.

Identifiers retain their validation boundary during deserialization; Serde does not bypass `SettingId` or `CapabilityId` invariants.

## Scopes

The core models four scopes without deciding where they are stored:

- `Session`: ephemeral runtime preference.
- `Save`: belongs to a savegame/document/workspace.
- `Device`: belongs to a physical/logical device installation, such as resolution or output device.
- `User`: portable user preference, such as subtitle presentation.

Persistence backends and synchronization policies are later adapters. A consumer can therefore map scopes onto local files, browser storage, cloud profiles, save data, or another store without changing setting semantics.

`Session` overrides are never serialized or restored by the portable persistence envelope.

## Apply modes

The model distinguishes:

- `Immediate`: may be reflected as soon as the accepted value changes.
- `Apply`: stage and commit through an explicit apply action.
- `Restart`: accepted now, effective after process restart.
- `Reconnect`: accepted now, effective after reconnect/reload of an external session.

`settings-core` exposes the mode on deterministic change records. It does not directly call a renderer, restart a process, or reconnect a service.

## Capabilities and availability

Capability identifiers are opaque facts supplied by consumers or platform adapters. The core does not know what `renderer.hdr`, `audio.spatial`, or any other capability means. A fact can be explicitly `true` or `false`; absence is distinct and means unknown.

Availability is declarative data attached to a setting. Conditions support capability predicates, setting-value predicates, `all`, `any`, and `not`. There are no callbacks in definitions and no domain code is executed while evaluating availability.

Condition evaluation uses three outcomes: satisfied, unsatisfied, and unknown. Compound conditions preserve unknown evidence conservatively instead of assuming an absent capability or setting is false. An availability policy maps a non-satisfied condition to either `Disabled` or `Hidden`, while the evaluation returns structured reasons such as a missing capability, a capability mismatch, a missing referenced setting, or a value mismatch. Presentation layers translate those reasons into localized user-facing explanations.

For example, a renderer may report `renderer.hdr = true`; `video.hdr` can then declare that fact as a prerequisite without `settings-core` learning how HDR works. Likewise, `video.render_scale` may declare that `video.upscaler == off` is required without the core applying either graphics setting.

## Setting dependencies and cycles

A setting-value predicate reads the referenced setting's current effective value. Referenced definitions and expected predicate values are validated at evaluation time; missing or incompatible references yield an unknown outcome rather than a guessed result.

Availability evaluation does not recursively evaluate the availability of referenced settings, so declarative value dependencies cannot create an evaluation stack loop. The registry nevertheless exposes deterministic cycle detection over the setting-to-setting dependency graph because mutually gating settings can create unusable configuration UX.

Cycle detection runs over the completed ordered registry rather than rejecting forward references during registration. Cyclic strongly connected components are reported in canonical setting-id order, including self-cycles. This keeps registration order non-semantic and lets consumers decide whether a reported cycle is a build-time error, diagnostic, or intentionally tolerated policy.

## Persistence

The MVP JSON envelope contains a schema version and delta-only overrides. Persistence is deliberately data-oriented: there is no filesystem API in the core crate.

Encoding receives the active registry so ephemeral session values and stale/invalid overrides cannot leak into durable state. The caller owns where bytes live. Later slices can add migration registries, per-scope snapshots, encryption/sync adapters, and provenance without coupling the canonical model to a storage technology.

## CQS shape

Reads (`get`, effective-value lookup, availability evaluation, iteration, diffing, dependency diagnostics) are separate from mutations (`register`, `set`, `reset`). The crate keeps this lightweight and in-process; it does not introduce messaging, event sourcing, projections, or distributed CQRS infrastructure.

## Dependency direction

Domain repositories may depend on `settings-core`, or an application composition layer may depend on both. `settings-core` must not depend back on consumers such as `input-bindings`, renderers, audio engines, or individual games.

When a cross-repository integration becomes substantial, prefer a thin adapter crate at the composition edge over adding domain knowledge to this core.
