# Faur — roadmap

This is the single ordering/index of active work. GitHub issues own scope and
acceptance criteria; this file is not a second specification. Product boundaries
are in [product-direction.md](product-direction.md); engineering practice is in
[AGENTS.md](../AGENTS.md).

## Current state

**v0.38.0** is released. Faur creates and maintains ordinary Pi projects;
generated projects run with plain `pi` without Faur or `system.yaml` at runtime.
Native files are authoritative for execution; changes are previewed, approved
and reconciled rather than continuously synchronized.

Simplification epic [#73](https://github.com/mihaiiova/faur/issues/73) is complete:
native skills replaced document/workflow declarations (#75), agent tools and
MCP integration exclusions replaced overlapping policies (#74), and
conversational diagnostics distinguish current, historical and unverified
evidence (#76). Skills remain developer-owned; instructions are advisory.

Below 1.0, breaking schema changes are allowed. No compatibility framework is
promised. Existing `policies` declarations require manual relocation as the
schema describes; do not remove restrictions silently.

## Active queue — reconciled 2026-11-09

The rewritten issues need their stated design or verification step; old readiness
labels have been removed. No implementation is currently in progress.

| Order | Issue | Next bounded step |
|---|---|---|
| 1 | [#68 Public-alpha acceptance gate](https://github.com/mihaiiova/faur/issues/68) | Map existing real-Pi tests to minimal, marketing and QA criteria; implement only missing boundary coverage. |
| 2 | [#29 Package discovery](https://github.com/mihaiiova/faur/issues/29) | Share local/native package discovery and bounded Pi-package search across builder and maintenance. |
| 2 | [#31 Native package filters](https://github.com/mihaiiova/faur/issues/31) | Preserve Pi's filtered package entries through generation, drift and adoption. #30 is not a blocker. |
| 3 | [#30 Static package inspection](https://github.com/mihaiiova/faur/issues/30) | Bounded exact-version inspection and factual proposal evidence; no trial execution or safety certification. |
| Small independent fix | [#69 Project name/description](https://github.com/mihaiiova/faur/issues/69) | Use the existing validated preview/apply path; no directory relocation. |
| Verification first | [#45 Specialist project lookup](https://github.com/mihaiiova/faur/issues/45) | Reproduce against pinned pi-subagents; prefer native behavior/upstream fix, never a Faur runtime hook. |
| Verification first | [#54 Specialist report reading](https://github.com/mihaiiova/faur/issues/54) | Verify native tools/durable outputs already solve prompt-free report access; no secret-path or command-classification subsystem. |
| Guidance/test task | [#51 Code handoffs and unattended skill suitability](https://github.com/mihaiiova/faur/issues/51) | Precise code handoffs and model-reviewed skill suitability; incorporates #52 without a scanner. |
| Consumer-led definition | [#35 Native run investigation](https://github.com/mihaiiova/faur/issues/35) | Consent, bounded/redacted native session evidence, observations versus inference; incorporates #40 without a runtime index. |
| Deferred | [#37 External scheduling](https://github.com/mihaiiova/faur/issues/37) | Demonstrate an ordinary skill under an existing external scheduler, then justify minimal maker-side support. |

No workflow-result, run-folder, scenario-engine or runtime-adapter issue is a
blocker for this queue. Scheduling is not implemented. The historical
`agents-cron` selection is a candidate to revalidate against the actual consumer,
not a mandatory dependency or a new workflow schema.

## Retired commitments

Closed with owner approval during the 2026-11-09 backlog reconciliation:

- **#43, #44, #46:** structured execution results, artifact routing/retention and
  inbound MCP execution belong to callers, consuming projects or a separately
  justified reusable package, not Faur core. These features were not delivered.
- **#38, #39:** no general scenario schema/evaluator or restricted scenario
  runtime. Use ordinary project tests and #68's explicit architecture gate.
- **#48, #70:** sandbox/protected-integration requirements are archived, not
  implemented guarantees. Research and security limitations remain available;
  a concrete consumer and evidence of an enforceable existing solution are
  prerequisites to reactivation.
- **#40 → #35; #52 → #51:** duplicate concerns consolidated into the surviving
  issues, not marked implemented.
- **#59:** migration implementation children are complete. Outstanding
  reference-agent/live acceptance is carried explicitly by #68; closing the
  migration container does not assert that unrun gates passed.
- **#24:** the permanent historical roadmap epic is retired. This file indexes
  focused active issues; no replacement all-project epic is needed.

Prior plans, amendments and shipped milestones remain in issue history and git.
Closed proposals are context, not promises to implement their old architecture.

## Verification and limitations

The v0.38.0 default suite and opt-in real-Pi delegation gate passed during epic
#73 consolidation. Local probes/fake providers verify loading and boundaries,
not output quality or live-service authentication. Live-provider and
clean-environment gates remain unrun; the live Owlie project was not regenerated.
The public-alpha gap map is #68, not a blanket readiness claim.

- Plain Pi inherits global configuration; callers own isolation. There is no
  OS sandbox or same-user credential confidentiality supplied by Faur.
- A global extension registering `/mcp` can replace built-in MCP and invalidate
  project exposure settings. Checks report the conflict, not repair it silently.
- Lead `defaultTools` is not a universal extension/MCP permission boundary.
  Specialist allowlists and scoped commands have their own verified mechanisms.
- Headless trust approval does not grant approval for consequential commands.
  Commands requiring interactive approval are refused unattended.
- Callers own timeouts, cancellation, overlapping runs, background-child cleanup
  and any external scheduling. Process completion is not task success.
- `check-agent --connect` uses a separate project-local Pi home and its trust;
  it is not a functional verification of the user's ambient plain-Pi setup.
