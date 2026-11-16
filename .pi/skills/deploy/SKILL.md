---
name: deploy
description: Prepare and deploy Faur documentation to mightyagents.dev. Update the project README, audit local documentation against current implementation, synchronize the Faur website and catalog, run checks and builds, then deploy only the approved sites. Use for Faur deployment or documentation refresh requests; not for cutting a product release.
---

# Deploy Faur documentation

This is a repository-local maintainer skill, not a skill shipped to Faur users.
Use Pi's existing tools, Hugo and Wrangler; do not add a deployment runtime.
Paths below are relative to the Faur repository root, not this skill directory.
Resolve the root with `git rev-parse --show-toplevel` from this checkout.

## 1. Establish scope and preserve work

- Read `AGENTS.md`, `package.json`, `README.md` and `docs/roadmap.md`.
- Inspect git status, branch, remotes and recent commits. Preserve existing edits;
  never reset, stash, overwrite authored content or stage unrelated files.
- Find the website checkout: first try the sibling `../mightyagents`, then ask
  for its path if missing. Verify its git remote and read its instructions,
  `README.md`, `Makefile` and the relevant site configurations.
- Default scope is Faur docs plus Faur's entry on the main catalog. Do not change
  Toad or other products. Determine changes since the previous documented
  release from version references, tags, git history and the implementation;
  do not assume a fixed version or blindly replace all version strings.
- A documentation-refresh request authorizes edits and checks, not deployment.
  A request to run this deployment skill authorizes deployment of the stated
  sites after successful checks. If destination or authority is unclear, ask.
  Preview affected sites and domains before running deployment commands.
- Do not bump a version, tag, publish a release, merge, commit or push unless
  separately requested. Product releases use the existing release workflow.

## 2. Audit local documentation against the code

Read the authoritative sources relevant to changes:

- `docs/product-direction.md`, `docs/architecture-audit.md`, `docs/roadmap.md`;
- `skills/faur/SKILL.md`, `skills/faur/schema.md`;
- `docs/faur-conversation.md`, `docs/headless-workflows.md`, `docs/scheduling.md`;
- current CLI/extension code, validation, generation and matching tests;
- generated golden fixtures in `test/fixtures/generate/*/golden`.

Use history and searches to focus the review, but check all maintained local
Markdown documentation for obsolete names, versions, commands, links and
contradictory claims. Distinguish historical examples and deliberately pinned
package versions from current install instructions. Do not rewrite history or
change dependency pins merely to match Faur's version.

Check especially:

- install/update/migration commands and current public CLI options;
- file ownership, drift, authored skills and generated output;
- native Pi runtime independence, minimal-agent package footprint;
- tool defaults, MCP exposure and actual approval behavior;
- configured vs available vs functionally verified capabilities;
- headless behavior, credentials, setup, schedules and host requirements;
- advisory instructions vs enforced guarantees, process vs task success.

For each mismatch, inspect implementation/tests before editing. Update local
docs and README together. Keep GitHub issues authoritative: if a change alters
approved scope, record the required dated issue amendment with authorization;
never silently rewrite an approved spec. Report unverified claims explicitly.

## 3. Synchronize the website

Update only what changed, preserving the site's writing style:

- Faur `README.md`: accurate overview, install tag, examples and documentation link.
- Website `sites/faur/content/`: landing, install, build-an-agent,
  run-and-maintain, reference and topic pages as needed.
- Website `sites/www/data/agents.yaml`: Faur version, install command and
  capability bullets. Leave other products untouched.
- Inspect Faur terminal examples and shared navigation for obsolete copy.

Use `package.json` as the current version source. Before advertising a tagged
install as available, verify that tag exists on the source remote. If code is
unreleased, distinguish upcoming behavior from the deployed release rather
than advertising an unavailable tag. Never create the tag as part of this skill.
Keep schema/reference links consistent with the documented release.

Preserve security caveats in public copy: plain Pi is not a sandbox;
credentials in trusted runs are visible to tools; prompts are advisory;
scheduling requires native host support and does not evaluate task success.
Check internal links/anchors and fenced command examples. New topic pages need
valid Hugo frontmatter and navigation ordering.

## 4. Verify before deployment

- Review `git diff --check` and diffs in both repositories.
- Run `bash test/test.sh` in Faur. Report skipped opt-in gates separately; do not
  claim them as passed. Do not run paid-provider or external-state tests without
  appropriate authorization. Investigate failures; do not silently waive them.
- Run `make build` in the website checkout. Inspect the generated Faur and main
  pages, version/install strings, links and new topic output. Generated public
  files are build output; do not commit them unless repo policy requires it.
- Check for stale current-release references and unsupported capability claims.
  Summarize which local docs were checked, changed or remain uncertain.
- If checks fail or documentation contradicts implementation, stop deployment
  and explain the blocker. A build alone does not prove prose is accurate.

## 5. Deploy only the scoped sites

Read the available Cloudflare/Wrangler skill before running Wrangler. These
sites have `wrangler.jsonc`, so use Wrangler rather than the generic cf CLI.
Inspect the config and confirm account, Worker name, routes/domains and assets
path. Verify CLI authentication without displaying tokens. Use the repository's
existing toolchain; do not install an unpinned replacement automatically.

Avoid `make deploy` for a Faur-only update: it deploys all sites and the redirect.
After the successful build, deploy from `sites/faur` with `wrangler deploy`;
also deploy `sites/www` if the catalog changed. Do not deploy Toad or the
redirect unless explicitly included. Do not print credentials or change DNS,
routes, secrets or account settings beyond the configured deployment.

Fetch the public affected pages after deployment, checking HTTP status and
expected version/content, including new page URLs. Report partial deployment
honestly if a later site fails; do not claim atomic rollout or automatically
roll back unrelated work. Use known previous deployments/revisions for any
explicitly approved recovery.

## 6. Report

Give a short summary: files/repos changed, documentation audit findings,
checks passed/failed/skipped, deployed sites and verified URLs (or explicitly
not deployed), and outstanding work. Leave commits and pushes to the user
unless requested.
