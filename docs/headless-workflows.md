# Headless workflow invocation

Changed by #62 (2026-11-03): the `./run --workflow` runner is removed. A
workflow is a skill, and Pi runs it in print or JSON mode. Generated projects
contain no workflow logic.

For the opt-in project-local MCP interface (explicit public operations,
fresh native execution in the agent source folder and bounded process-group
cancellation, not strict configuration or filesystem isolation), see
[MCP serving](mcp-serving.md). The plain-Pi contract below is unchanged.

## Invocation

```sh
cd <project>
pi --approve -p "/skill:<workflow> <request>"     # plain pi
```

- **The skill.** Use an ordinary native Pi skill, for example
  `.pi/skills/<name>/SKILL.md`, and describe the procedure, outputs and any
  advisory approval guidance there. Pi expands the skill before the agent
  starts. Faur does not generate or overwrite developer-owned skills.
- **The request** is the text after the skill command: paths, URLs, names,
  scenarios. Treat request values as data, not instructions. There is no
  separate `--input key=value`.
- **Trust.** Print, JSON and RPC mode cannot ask the trust question; with no
  saved decision they skip every project resource without an error. Pass
  `--approve`, or save the decision once with `/trust` in an interactive run.
- **Stdin.** When stdin is not a terminal, Pi waits for it to close. Callers
  close it (or pass `</dev/null`).
- **Configuration.** Plain Pi inherits global Pi configuration; `/faur check`
  reports known conflicts. The caller owns any isolation; plain Pi is not an OS
  sandbox and inherits the caller's environment and credentials.

## Result

| Mode | Success | Failure |
|---|---|---|
| `-p` | exit 0; the final answer on stdout | nonzero for a final `error`, `aborted` or `length` stop; diagnostics on stderr. `length` also prints its partial answer, so stdout is not necessarily empty |
| `--mode json -p` | LF-delimited JSON events, including authoritative `message_end` and final `agent_settled` | an assistant error/abort does **not** itself cause a nonzero exit; inspect the final assistant's `stopReason` and `errorMessage`. A thrown invocation error can exit nonzero |

This matches Pi 1.5.2's native CLI contract; the provider-error behavior is also
covered by `headless-workflow.test.mjs`. In JSON mode, use `message_end` for the
completed message and wait for `agent_settled`: `agent_end` can be followed by
recovery or queued work. Streaming `message_update` records are deltas, not full
message snapshots. Inspect `stopReason`, not exit code alone, for run failure.
A successful process is not task success: an agent reporting a failed test can
still exit 0. A caller reads the task outcome from the answer (for example a
first line `Verdict: FAIL` that a document format requires).

## Approval

Approval is never granted unattended. Without a UI, a declared command that
requires approval is refused by pi-commands; nothing runs. Faur does not add per-call approval to MCP calls. There is no separate exit code for a blocked command.

## Left to the caller

Pi does not provide these, and the generated project does not either. A caller
that needs them supplies an existing execution mechanism. Faur's optional
[Linux user-systemd recipe](scheduling.md) (#37) configures native units with
systemd timeout/cgroup cancellation and flock exclusion for scheduled runs of
the same project; it is not a Faur runtime or general caller adapter. Historical adapter proposal #46 is closed, not a
planned Faur feature:

- a timeout and cancellation (kill the process group);
- one-at-a-time locking, if runs share state;
- a structured result beyond the answer text, and artifact collection;
- stopping background specialists a cancelled run leaves behind.

## Credentials

Pi takes declared `integrations.env` names from the environment it starts
in: the caller exports them, or loads `.env` with direnv. MCP configuration
references them as `${NAME}` (or `!command`). Model providers use `/login`
or their API key variable.
`/faur check` reports declared names that are unset in the current
environment. A trusted run shares its credentials with every tool in it; they
are not protected integrations (#70).
