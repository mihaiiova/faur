# Manage agents from the main project

With Faur available in your main project's Pi session:

```text
/faur agents
/faur
/faur Update Jared’s review operation
/faur agent jared status
/faur agent jared Add a read-only audit MCP operation
```

`/faur agents` inventories without a model call. Bare `/faur` offers a picker
when there are project-local agents and no active maintenance conversation.
Explicit `agent <folder-name>` syntax also works without a UI. Quote a folder
name containing spaces. Natural named requests match folder names
case-insensitively, as whole names; multiple matches require selection. Unknown
explicit names are errors, not permission to create a replacement.

## Convention, not a registry

```text
main-project/
  .agents/
    jared/
      .pi/system.yaml
      .faur/build.json       # after generation; optional for discovery
    researcher/
      .pi/system.yaml
    skills/                  # shared skills, never an agent entry
```

The existing `.pi/system.yaml` is the identifier. No new marker, schema field,
registry, UUID or inventory file is added. Discovery only examines direct
`.agents/` children; unrelated folders and shared `skills/` are ignored. It
never follows directory, `.pi`, or design-file symlinks. A broken design is
listed as invalid rather than silently disappearing; repair its declarations
before normal maintenance. A build record's presence is not proof of successful
execution or capability verification.

New independent agents default to `.agents/<name>/`, unless you explicitly
choose another location. Agents elsewhere remain supported by starting Pi in
their folder (or using Faur's existing CLI); they are not recursively discovered.
Faur does not relocate existing agents. Inside an existing Faur project, the
ordinary `/faur` behavior still maintains that project. Explicit Create, Build,
Design or New requests start an independent agent instead (unless you target an
existing child with `agent <name>`). Use Add/Change for changes to the current
agent, including adding its internal specialists.

## Scope and ownership

Selecting an agent reuses one maintenance controller and Faur's existing
validation, diff, preview, approval and stale-file checks. Approvals name
paths relative to the selected agent's root; the notification, maintenance
status and planning context identify that root. The caller's working directory
does not change. Main-project files and other agents are not part of the change.
No target selection silently discards a pending proposal: use `/faur exit`
first. `/reload` restores an active selection and keeps operational tools off.
If that selected folder has disappeared, maintenance ends without applying.
After leaving maintenance, bare `/faur` can select a different agent. Explicit
`agent <name>` commands always select the named target.

Discovery/selection does not install anything or load an agent's extensions,
skills, MCP servers, setup hooks or execution tool permissions. Caller tools and
past tool calls are not evidence about the selected agent's runtime. Explicit
`check`/`setup` commands retain their documented semantics: trusted declaration
checks can execute shell code, and installs need confirmation. Trust the main
project before discovering or maintaining its children. Initial agent design can
still start in an empty/untrusted folder without scanning project resources.

This is maintenance routing, not filesystem/OS isolation. Developer permissions
are unchanged, prompts are advisory, and filesystem checks do not defend against
hostile concurrent changes. To **run** a selected agent, start Pi in its folder
or call its [public MCP interface](mcp-serving.md); routing does not turn the
main project's agent into the selected one.

## Verification

```sh
node --test test/project-agents.test.mjs test/project-agents-rpc.test.mjs
bash test/test.sh
```

Pure fixtures cover inventory, unbuilt/broken designs, unrelated directories,
symlink refusal, spaces, name ambiguity and creation routing. Real Pi RPC tests
use a local deterministic faux model (no paid provider): inventory with no model
call, named revision with inspect/propose/approve, pending-proposal preservation,
agent-specific writes, picker selection and reload restoration. Poison target
extensions prove they are not loaded. Existing direct-folder maintenance tests
remain the baseline.
