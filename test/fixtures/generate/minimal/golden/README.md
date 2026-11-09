<!-- faur:generated v1 sha256=4ecf2abc946d7a5d3960d76d971648d036a457ec5fbb583622e42015ac8855cd -->
# notes-helper

Answers questions about the notes in this folder

## Run

Start it with `pi` in this folder. Your global Pi configuration (settings,
packages, MCP servers, instructions) is added to the project's. `/faur check`
reports known conflicts, including extensions that replace built-in MCP.
Your environment, including any credentials in it, is inherited; this is not
an OS sandbox. Skills in `~/.agents/skills/` and `AGENTS.md` files in parent
folders also load, for the orchestrator. Pi asks once whether to trust the
project; headless runs pass `--approve` instead.

```sh
pi                          # interactive
pi --approve -p "..."       # headless one-shot
```

Authenticate with `/login`, or export the provider-specific key (for
example `DEEPSEEK_API_KEY`). See the capability section below for which
capabilities are enforced vs advisory.

## Maintain

This project runs on Pi alone and pins no Faur package. Maintain it from
your own Pi with Faur installed: run `pi` in this folder and use
`/faur <request>` to propose a change (discuss, apply or discard it when the
turn ends), `/faur check` to verify the agent, `/faur status` to summarize
it and `/faur permissions` to list, add or remove declared commands. Without
Faur, edit the files directly; roll back with git. Restart Pi when packages change.

## Capabilities and limits

Lead defaultTools controls built-in tools; independently registered extension tools may remain active, and MCP exposure is configured separately.
Plain Pi inherits global configuration. Tool lists are not OS isolation: bash and shell-like commands can reach what the user account can.
Agent instructions are advisory, not enforced.
