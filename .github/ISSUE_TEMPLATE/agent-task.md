---
name: Agent task
about: One PR-sized task for a coding agent (see AGENT_TASKS.md)
title: "<Area> <step>: <what the consumer or system gains>"
labels: ["agent-task", "spec:draft"]
---

Step <n> of #<parent roadmap issue>. Consumer waiting: <repo#issue or "none">. Intended implementer: **<Opus|Sol|Sonnet>**. Start after: <#N or "nothing">. One branch (`agent/<topic>`), one PR; follows the `AGENTS.md` **Execution scope** rules.

## Goal

<Two or three sentences: what a consumer or the system can do afterwards.>

## Decisions already made (do not reopen)

- **Semantics and numbers:** <…>
- **Formats:** <persisted schema version/migration, shared fixture shape, browser package/React bridge API; or "no format change">
- **Compatibility:** <what happens to existing snapshots, compatibility goldens and pinned `browser-dist` consumers>
- **Left to the implementer:** <explicitly delegated choices, recorded in the PR>

## Acceptance

- <tests and fixtures>
- <checks CI does not run, if any>
- CI green and every Codex review finding addressed or answered.

## Expected changes

- <crates/web files/fixtures/docs>

## Out of scope

- <…>
- Sibling-foundation, tooling, CI, dependency-pin and benchmark-threshold work.

## Parallel work

- <open tasks touching the same files, or "none">
