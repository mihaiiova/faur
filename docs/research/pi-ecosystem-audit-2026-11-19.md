# Pi ecosystem reuse audit — 2026-11-19

> Historical assessment made before the simpler
> [2026-11-19 source-cwd amendment](../mcp-serving.md). Statements below about
> unpublished native prerequisites and a publication blocker are superseded:
> current hosting uses published packages, source cwd and advisory target paths.
> No upstream changes or proposals are required for that design.

## Scope and conclusion

Primary-source research observed 2026-11-19. Compared published npm archives,
maintainer source/changelogs and current Faur code, including the uncommitted
`feat/full-native-mcp` implementation. This is an adoption assessment, not a
runtime compatibility certification. No dependencies, implementations, GitHub
issues, native checkouts or global installations were changed. No provider,
credential or service-authentication calls were made. This note is the only
repository change from the audit.

**Best direction: reuse more native package discovery/filtering, evaluate the
new skills library behind a compatibility spike, and rebase local delegation
changes onto 0.89.1 before publication. No additional mandatory generated-agent
package is justified by this audit.** The full-native MCP publication blocker
remains real; taking the latest public packages does not remove it.

## Verified release identities

| Component | Published latest at observation | Faur/local state |
|---|---|---|
| `@earendil-works/pi-coding-agent` | **1.5.2**, 2026-11-10 | MCP manifest pins 1.5.2; local native tarball has additional unpublished patches |
| `pi-subagents` | **0.89.1**, 2026-11-18; gitHead `533033f0e906e85fdb0e909ce27a7c499ffb6485` | Faur pins 0.83.1; native patch checkout is based on 0.89.0 |
| `skills` (`vercel-labs/skills`) | **1.9.0**, 2026-11-16 | Registry acquisition invokes `skills@1.7.4` |
| `mihaiiova/pi-commands` | Git tag **v0.1.0**, commit `c2f7af4ed07e44c6f9a60e5b8f564feedcbc1559` | Already an explicit conditional dependency; no newer upstream implementation found |
| `pi-context-view` | **0.8.4**, 2026-11-10 | Optional developer-tool candidate, not a core dependency |

Pi main was inspected at `402dc19beda05291267b8a7e0d6b5a66466eece6`.
Its unreleased changes must not be represented as registry 1.5.2 capabilities.
Pi release source is `b4afdddf44e059c67ccf5097e5317d913521b470`.
Same-version local development tarballs are not equivalent to registry packages.
Sources: [1–6].

## Priorities

### 1. Use native package inventory and preserve native resource filters

**Recommendation: next bounded maker improvement; no new runtime dependency.**
Published Pi already exposes `DefaultPackageManager`, `listConfiguredPackages`,
installed paths and source/scope/filter metadata. Native package entries support
resource selection objects, empty lists, exclusions and exact selectors.
These are existing capabilities, not a new November release feature. [3,7]

Faur has an existing resolver seam in `src/check.mjs:loadProjectTools`, but
`src/discover.mjs` and maintenance discovery do not share a complete native
package inventory. `src/deps.mjs` and package validation use string specs;
native object filters cannot faithfully round-trip through that design.
This matches the still-open package discovery/filter issues [#29][i29] and
[#31][i31]. Generic npm discovery should at least distinguish `pi-package`
metadata from unrelated packages.

Reuse native identity/filter semantics rather than inventing a registry,
package manager or filter language. Inspection must be read-only: unconstrained
resolution can install code; extension loading is not static inspection.
Preserve or explicitly reject/report `autoload:false` delta semantics rather
than silently simplifying them. [7]

**Proof before adoption:** global/project duplicate sources, missing packages,
`skills:[]`, excluded extensions, and generation/edit/adoption/revision round-trip;
prove excluded resources absent in a real Pi fake-provider launch. No minimal
agent files or package costs should change.

### 2. Rebase the unpublished delegation patch onto pi-subagents 0.89.1

**Recommendation: investigate/verify now, then coordinated exact pins—not a
blind bump.**

0.89.1 fixes 0.89.0's strict-allowlist false positives for registered but
intentionally inactive tools, plus asynchronous status/placed-child abort issues.
Since 0.83.1, maintained releases also add workflow admission/security hardening,
cleanup/recovery fixes, explicit-provider no-rerouting behavior and output-length
failure handling. Those are reasons to use the maintained implementation rather
than add Faur substitutes. They are maintainer/source evidence, not new
acceptance tests run by this audit. [2,8,9]

Compatibility gates must cover inactive allowed tools versus actual active-tool
substitution, foreground/background children, source skills/instructions,
headless lifecycle, strict outputs and explicit unavailable providers. Older
persisted runs may no longer be resumable without trusted recovery records;
new permission admission hooks can affect headless calls. Do not assume the
whole 0.83.1→0.89.1 change is a drop-in patch.

The specialist Markdown-body correction in the current Faur tree should stay:
both 0.83.1 and 0.89.1 parse file bodies as specialist system prompts. It fixes
an existing generator bug, not a new-version format change. [10]

### 3. Evaluate skills 1.9.0's programmatic API without changing the current pin

**Recommendation: small disposable compatibility spike.**

Unlike the inspected 1.7.4 package, 1.9.0 exports a library API including source
resolution, installation, listing and removal. Reusing a resolved source between
preview and installation could reduce subprocess and GitHub-tree/name-resolution
plumbing in `src/registry-skills.mjs`. It offers explicit cwd, copy mode,
duplicate errors, symlink rejection and telemetry controls. [4,11]

**Do not just bump the CLI.** The new lock contract uses v2 metadata,
`computedHash` and a separate Git `commit`; `ref` need not equal the resolved
commit. Faur currently relies on `lockEntry(...).ref === parsed.ref` and on
preserving unrelated shared lock metadata. Upstream content-hash normalization
also differs from Faur's byte/mode/tree ownership signature; it cannot replace
those safeguards by assumption. [11; local `src/registry-skills.mjs`]

Costs include Node **>=22.20.0** and additional maker dependencies. API defaults
must not silently enable telemetry, auto-select unrelated clients or install
globally. Keep explicit reviewed commit, target, staging, stale-preview, approval
and rollback semantics.

**Proof:** moving branch with stable commit, v1/v2 shared-lock behavior,
symlink/duplicate rejection, altered installed-tree preservation, no global writes
or telemetry, and plain Pi use with Faur absent. Measure actual code removed
before adopting another core dependency.

### 4. Reuse native provenance and session APIs for diagnostics

**Recommendation: build on what Faur already uses; no new telemetry package.**

Pi 1.5.2 already exposes tool/command `sourceInfo`, tool exposure metadata,
session entries/branches and statistics. `src/maintenance-extension.mjs` already
collects bounded provenance and execution evidence; source/target selection must
remain accurate when maintaining a different agent. Use these to consolidate
[#68][i68] acceptance evidence instead of creating a run database, cloud tracing
integration or parallel session parser. Session contents may contain secrets;
historical reads need explicit consent, bounds and redaction. [3,12]

Watch, but do not depend yet on, unreleased Pi diagnostic/session-start fixes,
replacement-session JSON/RPC behavior, MCP tool-search restoration and dependency
updates. These improve future harness reliability but do not supply our missing
native identity contract. [6]

### 5. Optional developer tooling, not Faur infrastructure

`pi-context-view@0.8.4` can inspect prompt/tool declarations and extension
injections. It could help debug capability descriptions without building another
inspection UI. It observes sensitive runtime data and is executable extension
code; test only as an explicit developer tool, with auto-probing disabled and no
assumption of provider-call-free behavior until verified. No generated agent
should inherit it by default. [5,13]

Keep pi-commands and builtin MCP: Faur already composes these appropriately.
No new replacement is warranted. Commands enforce declared argv/approval rules,
not OS or credential isolation. [14]

Do not add a permission-system fork, alternative delegation runtime, competing
MCP adapter, scheduler, memory platform or marketplace merely because it is
maintained. In particular, `@gotgenes/pi-permission-system` documents special
integration with its own subagent fork, not demonstrated compatibility with
Faur's nicobailon package. Any future need should be opt-in and consumer-led;
permission hooks are not an OS sandbox. [15]

## Does latest upstream replace our local full-native prerequisite?

**No.** Exact inspected Pi release/main and pi-subagents 0.89.1 still lack the
end-to-end contracts implemented locally:

- source configuration identity separate from execution workspace;
- project-only exclusion propagated through settings/resources/extensions and
  native foreground/background delegation;
- source-aware MCP/command declaration discovery with execution at target cwd;
- public structured builtin MCP `waitForStartup()` covering all enabled servers
  and configuration failures, not merely selected direct-tool first-prompt waits.

Published Pi already has builtin MCP/codemode/tool-search factories and native
credentials/locking. We are reusing those; they are not newly introduced by our
patches. None is a replacement for the additional source/workspace and readiness
contracts. Our local changes remain unpublished release prerequisites. [3,6–10,14]

Native workflow drain/async observation improvements also do not prove that
Faur's bounded process termination kills detached/background workers. Retain the
explicit cleanup caveat; do not replace it with an upstream feature name. [8]

## Recommended order

1. Preserve the current release blocker; rebase/verify local delegation changes
   against exact published 0.89.1 before coordinating upstream releases.
2. Implement native maker inventory and resource-filter preservation as the
   bounded #29/#31 work, without adding runtime machinery.
3. Run a skills 1.9 API/lock-v2 spike before deciding whether its simplification
   outweighs the dependency and compatibility costs.

No dependency update or implementation is approved by this research note.
The audit did not run the newly researched versions against Faur. Read-only
GitHub checks confirmed #29/#30/#31/#45/#54/#51/#68 remain open; an open issue is
not proof that every acceptance criterion is missing. The roadmap's 0.39 heading
is stale relative to the released package version; code and GitHub own current
behavior/scope. [i29,i31,i68]

## Primary sources

1. [Pi npm metadata](https://registry.npmjs.org/@earendil-works%2fpi-coding-agent)
   and [v1.5.2 release](https://github.com/earendil-works/pi/releases/tag/v1.5.2).
2. [pi-subagents npm metadata](https://registry.npmjs.org/pi-subagents) and
   [v0.89.1 release](https://github.com/nicobailon/pi-subagents/releases/tag/v0.89.1).
3. [Pi 1.5.2 SDK documentation](https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/docs/sdk.md).
4. [skills 1.9.0 metadata/archive](https://registry.npmjs.org/skills/1.9.0).
5. [pi-context-view metadata](https://registry.npmjs.org/pi-context-view).
6. [Pi inspected-main changelog](https://github.com/earendil-works/pi/blob/402dc19beda05291267b8a7e0d6b5a66466eece6/packages/coding-agent/CHANGELOG.md)
   and [SDK source](https://github.com/earendil-works/pi/blob/402dc19beda05291267b8a7e0d6b5a66466eece6/packages/coding-agent/src/core/sdk.ts).
7. [Pi 1.5.2 packages](https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/docs/packages.md).
8. [pi-subagents exact 0.89.1 changelog](https://github.com/nicobailon/pi-subagents/blob/533033f0e906e85fdb0e909ce27a7c499ffb6485/CHANGELOG.md).
9. [0.89.0→0.89.1 source comparison](https://github.com/nicobailon/pi-subagents/compare/4aa4ddb0ecb7ad56a6c9e56c96f39f7877a1550f...533033f0e906e85fdb0e909ce27a7c499ffb6485).
10. [Published specialist parser](https://github.com/nicobailon/pi-subagents/blob/533033f0e906e85fdb0e909ce27a7c499ffb6485/src/agents/agents.ts)
    and [child session implementation](https://github.com/nicobailon/pi-subagents/blob/533033f0e906e85fdb0e909ce27a7c499ffb6485/src/runs/shared/child-session.ts).
11. [skills API documentation](https://github.com/vercel-labs/skills/blob/57217cf86ba38148a57af9e90d14a4c049558330/docs/api.md),
    [exact 1.9.0 archive](https://registry.npmjs.org/skills/-/skills-1.9.0.tgz).
12. [Pi 1.5.2 extension metadata](https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/docs/extensions.md).
13. [pi-context-view exact 0.8.4 archive](https://registry.npmjs.org/pi-context-view/-/pi-context-view-0.8.4.tgz).
14. [pi-commands exact source/README](https://github.com/mihaiiova/pi-commands/blob/c2f7af4ed07e44c6f9a60e5b8f564feedcbc1559/README.md).
15. [Permission-system fork metadata](https://registry.npmjs.org/@gotgenes/pi-permission-system),
    [exact 42.2.0 archive](https://registry.npmjs.org/@gotgenes/pi-permission-system/-/pi-permission-system-42.2.0.tgz).

[i29]: https://github.com/mihaiiova/faur/issues/29
[i31]: https://github.com/mihaiiova/faur/issues/31
[i68]: https://github.com/mihaiiova/faur/issues/68
