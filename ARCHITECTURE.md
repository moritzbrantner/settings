# Architecture

## Authority boundary

`settings-core` is authoritative for generic setting semantics: identity, types, constraints, defaults, scopes, apply modes, overrides, deterministic diffs, declarative availability, provenance, transactions, presets, and the portable persistence envelope.

It is not authoritative for domain behavior.

- `input-bindings` owns key/controller binding semantics, conflict analysis, and binding profiles.
- Renderers and 3D foundations own graphics capabilities and applying graphics changes.
- Audio foundations own devices, mixers, spatial audio, and dynamic-range behavior.
- Games and applications own gameplay/application-specific settings and defaults.
- UI layers own presentation, localization, focus/navigation, and platform-native controls.

Consumers register settings and translate committed or preview changes into their own domain commands. This prevents the settings repository from becoming a dependency magnet or a second implementation of domain behavior.

## Consumer-owned defaults, delta-owned preferences

Defaults belong to the consumer that understands the domain. `settings-core` stores only values that differ from those defaults.

That means changing a consumer default does not copy or rewrite every user's profile, while an explicit user choice still wins. Setting a durable value back to its current default removes the durable override. This mirrors the delta-based profile principle used by `input-bindings`.

## Determinism

Registration order is never semantic.

Definitions and overrides use ordered maps, so iteration, diffs, dependency diagnostics, preset application, and serialized maps have stable ordering. The same registry and state therefore produce the same effective values, change list, availability result, transaction plans, and canonical persistence representation.

Floating-point setting values must be finite. NaN and infinities are rejected because they do not provide stable equality or portable persistence semantics.

## Validation

A definition declares a value kind and constraints. Registration validates the definition and its default before it becomes visible. Writes validate against the registered definition before mutating state.

Unknown setting identifiers and invalid persisted values are fail-closed: they are not applied. Compatible snapshots recover independently valid entries and return diagnostics for invalid or corrupt entries.

Identifiers retain their validation boundary during deserialization; Serde does not bypass `SettingId`, `CapabilityId`, or `PresetId` invariants.

## Scopes

The core models four scopes without deciding where they are stored:

- `Session`: ephemeral runtime preference.
- `Save`: belongs to a savegame/document/workspace.
- `Device`: belongs to a physical/logical device installation, such as resolution or output device.
- `User`: portable user preference, such as subtitle presentation.

Schema v2 persists exactly one durable scope per snapshot. This prevents device-local values from being accidentally copied into a cloud-synced user profile and keeps save/document settings independent. `Session` is deliberately not persistable.

Independently loaded `Save`, `Device`, and `User` states can be merged into one runtime state after each snapshot has been validated against the active registry.

## Provenance and layered overrides

Durable preferences and transient runtime overlays are deliberately separate. Durable overrides carry both a value and one of these sources:

- user override,
- preset,
- migration.

Transient overlays use these sources:

- policy,
- command-line override,
- session override.

The absence of any applicable override is reported as the consumer default. Effective precedence is deterministic and explicit:

1. policy,
2. command-line override,
3. session override,
4. durable override,
5. consumer default.

A transient overlay never destroys the durable value underneath it. For example, a policy may temporarily force volume to 10 while the user's durable preference remains 65. Export still writes 65; removing the policy reveals 65 again. A transient value equal to the consumer default is still retained because it may intentionally mask a durable override.

Provenance is queryable separately from the effective value and appears on deterministic value-change records as before/after provenance. This lets presentation and support tooling explain why a value is active without changing value semantics. `reset` changes the durable preference only; explicit transient-removal APIs remove policy, command-line, or session overlays without conflating them with user preference state.

Only durable sources are eligible for portable persistence. A migration load records the source schema version so migrated values are distinguishable from values read directly from the current schema.

A provenance-only edit can make a transaction dirty without producing a domain value-change record. This prevents consumers from reapplying an unchanged renderer/audio/game value merely because its explanatory provenance changed.

## Apply modes

The model distinguishes:

- `Immediate`: may be reflected as soon as the accepted value changes.
- `Apply`: stage and commit through an explicit apply action.
- `Restart`: accepted now, effective after process restart.
- `Reconnect`: accepted now, effective after reconnect/reload of an external session.

`settings-core` exposes the mode on deterministic change records. It does not directly call a renderer, restart a process, or reconnect a service.

## Presets

A preset is a validated identifier plus an ordered map of ordinary setting values. It is not another settings store and does not bypass normal definition validation.

Applying a preset happens against a cloned candidate state. Every value must validate before the candidate replaces the caller's state, so a partially invalid preset cannot leave half-applied changes. Successful preset values use normal durable overrides with `Preset` provenance; setting a preset value equal to the current consumer default still canonicalizes to no durable override.

Transient overlays remain separate while a preset is applied. A preset can therefore update the durable preference beneath an active policy or command-line override without pretending that the currently effective runtime value changed.

## Transactions and preview

`SettingsTransaction` owns a baseline state and an independently mutable staged state. Staging never mutates the baseline.

The transaction exposes deterministic pending value changes and a separate immediate-preview subset. Consumers that choose to preview `Immediate` changes can apply those effects in their authoritative domains. On cancel, the core computes reverse changes from staged back to baseline and returns only the immediate changes that may need external reversal. Non-immediate staged values were never required to be applied and therefore do not appear in the cancel revert plan.

Commit returns the staged state plus the deterministic baseline-to-staged value changes. Each value change carries before/after provenance and apply mode. The application composition layer remains responsible for dispatching those changes to the renderer, audio engine, input system, game rules, or other authoritative domain.

Dirty state compares the full layered state rather than only effective values. Per-setting dirty queries therefore detect durable provenance changes and transient-layer edits even when a higher-precedence overlay masks the domain value. Such edits can be dirty while `pending_changes` remains empty, because no external runtime effect needs to be applied.

Section reset is intentionally represented as resetting a caller-supplied list of setting identifiers; section/category ownership belongs to the later presentation model. Global reset clears all durable preferences. Neither reset operation removes policy, command-line, or session overlays because those are not user preference state.

## Timed safety rollback

Risky display changes often need a confirm-or-revert flow. `TimedSafetyRollback` holds a baseline state, a candidate state, and a caller-defined monotonic deadline tick.

The core never reads wall-clock or platform timers. The caller supplies `now_tick`, making pending/confirmed/expired decisions deterministic and testable. Confirmation is accepted only before expiry. Once expired, the core returns a candidate-to-baseline rollback plan and resolves to the baseline state; once confirmed, it resolves to the candidate and produces no rollback plan. A pending rollback deliberately has no resolved state, preventing a caller from accidentally treating an unconfirmed risky candidate as final.

The primitive deliberately does not decide which settings are risky. A renderer/application chooses when to wrap a committed candidate in this safety mechanism.

## Capabilities and availability

Capability identifiers are opaque facts supplied by consumers or platform adapters. The core does not know what `renderer.hdr`, `audio.spatial`, or any other capability means. A fact can be explicitly `true` or `false`; absence is distinct and means unknown.

Availability is declarative data attached to a setting. Conditions support capability predicates, setting-value predicates, `all`, `any`, and `not`. There are no callbacks in definitions and no domain code is executed while evaluating availability.

Condition evaluation uses three outcomes: satisfied, unsatisfied, and unknown. Compound conditions preserve unknown evidence conservatively instead of assuming an absent capability or setting is false. An availability policy maps a non-satisfied condition to either `Disabled` or `Hidden`, while the evaluation returns structured reasons such as a missing capability, a capability mismatch, a missing referenced setting, or a value mismatch. Presentation layers translate those reasons into localized user-facing explanations.

For example, a renderer may report `renderer.hdr = true`; `video.hdr` can then declare that fact as a prerequisite without `settings-core` learning how HDR works. Likewise, `video.render_scale` may declare that `video.upscaler == off` is required without the core applying either graphics setting.

## Setting dependencies and cycles

A setting-value predicate reads the referenced setting's current effective value. Referenced definitions and expected predicate values are validated at evaluation time; missing or incompatible references yield an unknown outcome rather than a guessed result.

Availability evaluation does not recursively evaluate the availability of referenced settings, so declarative value dependencies cannot create an evaluation stack loop. The registry nevertheless exposes deterministic cycle detection over the setting-to-setting dependency graph because mutually gating settings can create unusable configuration UX.

Cycle detection runs over the completed ordered registry rather than rejecting forward references during registration. Cyclic strongly connected components are reported in canonical setting-id order, including self-cycles. This keeps registration order non-semantic and lets consumers decide whether a reported cycle is a build-time error, diagnostic, or intentionally tolerated policy.

## Persistence and migration

Persistence is data-oriented: `settings-core` does not own filesystem paths, databases, browser storage, cloud accounts, encryption keys, or synchronization policy.

Schema v2 contains a schema version, one explicit durable scope, and an ordered map of delta-only overrides. Import checks that the envelope's scope matches the requested target before applying values.

Schema upgrades run through an explicit migration chain. The current v1-to-v2 migration partitions known legacy entries by consulting the active registry. Unknown v1 entries are dropped with diagnostics because the old mixed-scope envelope provides no trustworthy way to decide whether they belong to `Save`, `Device`, or `User`.

Unknown entries in v2 are preserved verbatim because the enclosing v2 scope makes their storage boundary safe. The preserved-entry collection itself is tagged with that source scope, and export rejects a collection whose scope does not match the target snapshot. Device-local unknown data therefore cannot accidentally be inserted into a `User` snapshot merely because the application merged multiple runtime states. If a later registry starts recognizing a preserved identifier, the known definition takes precedence over the preserved raw entry.

Corruption recovery is entry-oriented for a structurally readable, supported envelope. Bad identifiers, malformed values, invalid known values, and scope mismatches are skipped with diagnostics while independent valid entries are recovered. A malformed envelope or unsupported future schema fails as a whole rather than being guessed.

Import/export uses ordered maps and pretty JSON to provide a deterministic canonical representation. Re-exporting a recovered compatible v2 snapshot therefore stabilizes to the same bytes while retaining safe unknown entries.

## Atomic storage boundary

`AtomicSettingsStorage` represents one concrete storage target and exposes only reading the committed bytes and atomically replacing them.

The core does not implement filesystem writes itself. A conforming storage adapter must ensure that a failed replace never exposes a partially written snapshot. Filesystem adapters should normally write a temporary file, perform the durability barriers appropriate to the platform, and use an atomic rename/replace instead of truncating the live file in place.

This boundary keeps crash-safety responsibilities explicit while allowing local files, browser storage, cloud-backed stores, save containers, or application-specific persistence mechanisms to implement them appropriately.

## CQS shape

Reads (`get`, effective-value/provenance lookup, availability evaluation, iteration, diffing, dependency diagnostics, dirty queries, export) are separate from mutations (`register`, `set`, `reset`, transaction staging, transient-overlay removal, merge/import into caller-owned state). The crate keeps this lightweight and in-process; it does not introduce messaging, event sourcing, projections, or distributed CQRS infrastructure.

## Dependency direction

Domain repositories may depend on `settings-core`, or an application composition layer may depend on both. `settings-core` must not depend back on consumers such as `input-bindings`, renderers, audio engines, or individual games.

When a cross-repository integration becomes substantial, prefer a thin adapter crate at the composition edge over adding domain knowledge to this core.
