# Distributing Faur-built agents without separately installing Pi or Faur

> Historical snapshot of v0.41.1. Superseded for current hosting by the
> [2026-11-19 source-cwd amendment](../mcp-serving.md): native execution now runs
> in the agent source folder; the absolute target is advisory task context.
> Source/workspace separation proposals below are research, not prerequisites.

## Recommendation

**Yes: ship an agent as an installable application embedding Pi's SDK, with local MCP and optionally a one-shot CLI as two front doors to the same execution seam. Consumers need not install Pi or Faur separately. They still run Pi internally.** The current generated MCP bundle already satisfies the first part after `npm ci`; the missing convenience is an executable npm package and explicit reusable-source/consumer-target binding, not another agent runtime. Pi explicitly supports embedding, and Faur already does it. [R1, R2, P1]

Recommended incremental path:

1. **Use the existing generated agent bundle now**, distributed as a reviewed Git checkout or source release archive, with its generated `.faur-mcp` directory and lockfile. Consumer installs dependencies once, then registers a local stdio command. This is already implemented; no global `pi` or Faur needed. [R1, R3]
2. **For genuinely install-and-use delivery, add an opt-in agent application package**, not mandatory packaging for every Faur project. Give it one `bin` with `mcp` and, if needed, `run` subcommands; embed the existing Pi SDK worker and share the canonical `loadAgent`/`invoke` seam. Add a trusted startup `--project` binding independent of installed agent source. None of that executable/subcommand interface exists today. [R2, R4, N1]
3. **Publish exact agent versions with a genuinely controlled runtime tree.** An exact Pi dependency pin is necessary but insufficient to lock all transitives under `npx`. Prefer build-time `npm ci` plus reviewed `bundleDependencies` for a self-contained npm tarball, subject to platform/artifact tests. Until validated, retain the release-bundle + `npm ci` route as the reproducible baseline. Do not promise that an ordinary published `package-lock.json` or universal shrinkwrap solves this. [R5, N2, N3]
4. **Do not promise full interactive-agent parity.** First ship only capabilities demonstrated in the isolated worker. Port individual required skills, delegation or upstream MCP only after a concrete agent needs them and tests prove their trust, credentials and cancellation behavior. [R6, P1]

This fits Faur's declared small maker-only core: Pi is the runtime; ordinary generated projects remain native Pi projects, and consumer distribution is a deliberate extension of the existing opt-in MCP exception, not a new workflow engine, registry, hosted platform or universal harness. [R7]

## Scope and evidence

Inspected Faur `master`, package version **0.41.1**, checkout **`ad34a48`**; repository implementation first, then installed Pi SDK/package/headless documentation and compiled source, then first-party web sources. Installed Pi and generated MCP dependency both resolve **`@earendil-works/pi-coding-agent@1.5.2`**. Retrieved upstream `main` package metadata also says 1.5.2, but `main` URLs are moving references, not immutable proof of future behavior. The local pinned implementation is authoritative for conclusions about this checkout. [R5, P1, P2]

Research only: no implementation, release, package installation, credential access, provider calls, external-project changes or real client registration was performed. Existing integration-test descriptions are repository evidence, not tests rerun for this note. The researcher delivered an isolated output artifact; the parent copied the findings into this repository note at `docs/research/agent-distribution-without-pi.md` and checked the core runtime claims against the implementation.

## What works now

### Current generated MCP is already portable across machines, within stated prerequisites

The generator copies ordinary Faur package assets, including canonical `src`, extension, maker skill and `mcp` code, into `.faur-mcp/faur/`; it excludes `node_modules`, copies `mcp/package.json` and its lockfile to `.faur-mcp/`, emits public config, and adds a developer-only maintenance extension. It does **not** point to a developer checkout. Keep the whole agent source, including authored `.pi/APPEND_SYSTEM.md`, not just `host.mjs`. [R3]

Direct MCP dependencies are Pi **1.5.2**, MCP SDK **1.32.2**, Ajv **8.20.0**, TypeBox **1.1.24**, YAML **2.8.3**. The lockfile includes transitive versions, registry tarball locations and integrity values. Root Faur and `faur-local-mcp` are both `private: true` and neither exposes an agent `bin`; there is no published-consumer CLI implied by these manifests. `private: true` makes npm refuse publication. [R5, N1]

**Prerequisites:** POSIX host, Node **>=22.19.0**, npm, readable trusted agent files, an existing target directory and suitable model authentication. Documentation's shorthand “Node.js 22+” is less precise than the pinned Pi package's actual engine requirement. Windows hosting is explicitly refused. MCP consumers also need a client capable of launching local stdio processes; CLI consumers would not need an MCP client. [R1, R2, R5]

**Implemented install/use example** (substitute real absolute paths; the client command is documented syntax, not a registration tested here):

```sh
# After obtaining the reviewed generated source at /opt/agents/jared:
cd /opt/agents/jared/.faur-mcp
npm ci

# Claude Code, from the consumer's project; local scope is intentional.
claude mcp add --transport stdio --scope local jared -- \
  /absolute/path/to/node /opt/agents/jared/.faur-mcp/faur/mcp/host.mjs
```

Supply declared provider variables through the client's supported local secret/environment mechanism. Do not put key values into committed files or this example. The generated config's `projectRoot` must already identify the intended target; registering from another directory does not change it. Claude Code documents local launch-command registration and configuration scopes; Faur deliberately leaves client registration to the consumer. [R1, C1]

`npm ci` requires a matching lockfile, refuses manifest/lock disagreement rather than updating it, removes existing `node_modules`, and does not rewrite the manifest or lockfile. Initial install generally needs registry/network access or a complete usable cache. This is “install once, use repeatedly,” not “zero install.” Installation can run dependency lifecycle scripts; this is executable supply-chain trust, not merely copying a prompt. The current locked tree includes packages marked `hasInstallScript`. [N4, R5]

### Source independence is not dynamic target reuse yet

The host derives agent source from its own installed location. `loadAgent` resolves `config.projectRoot` relative to that source (absolute values also work), canonicalizes it with `realpathSync`, reads the authored lead prompt and public catalog **once at startup**, and puts the target in each worker's SDK `cwd`. It does not interpret the caller's working directory, an operation argument named `project`, or MCP roots as a new target. The public schema has no target-override field; extra config keys fail validation. [R2, R4]

Consequently:

- One source can be moved to another machine, but an absolute target path must exist there, and relative layout must still be valid.
- Current reuse is sequential rebinding of the source's configuration and restart, or a separately configured generated copy per target. **Independent simultaneous target bindings from one immutable source are not a current CLI/MCP feature.** An embedding caller could construct a different in-memory agent descriptor for exported `invoke`, but that is not a documented shipped executable contract. [R2]
- For the desired product, add a **startup-local target option** to the adapter and pass that resolved target to the existing worker. MCP: separate client registration/process per target, sharing immutable installed agent assets. CLI: explicit target per invocation. Do not make caller-supplied tool arguments silently select arbitrary paths. Require an explicit reviewed target/trust decision; package installation approval and MCP registration are not filesystem sandboxing. This is a recommendation, not implemented behavior. [R2, R4]
- Keep consumer-specific target paths, credentials and any future session data outside the immutable/shared package. A published runtime must also review auth-evidence writes: today's host records evidence under the source's `.faur-mcp`, which is suitable for writable generated projects but not an assumption to carry into shared/read-only npm installs. [R2:58–66, R8]

A **remote** MCP endpoint runs where the server is hosted. It does not acquire a consumer's local checkout just because the client advertises roots or names a local path. Current Faur only implements stdio, which launches the worker locally. Remote operation would require an explicit checkout/upload/mount or a local bridge plus authentication and tenant isolation; none is delivered here. Use local stdio for repo-aware agents. This follows the MCP process/transport model and Faur's actual target binding, not an inferred remote filesystem capability. [M1, R2]

## npm application and shared CLI/MCP seam

### Smallest useful proposal

Publish the **specialized agent application**, with its authored prompt and public operations, plus a thin canonical adapter and pinned Pi SDK dependency. The maker remains Faur. A package `bin` mapping and Node shebang let npm install/link its executable; `npx`/`npm exec` can fetch/cache that package and run it without a global install. Publishing a Pi resource package alone (`pi` manifest / `pi-package` keyword) is different: that distributes resources to an already-running Pi host and does not supply a consumer executable. Pi's own package docs distinguish resources, dependencies and project trust. [N1, N5, P3]

**Illustrative only — package name, binary and flags below do not exist:**

```sh
# One bin, two modes, identical operation execution underneath:
npx --yes @example/jared-agent@1.0.0 mcp --project /work/app-a
npx --yes @example/jared-agent@1.0.0 run audit \
  --project /work/app-b --input-json '{"request":"Review API boundaries"}' --json

# Same npm mechanism with explicit executable selection:
npm exec --yes --package=@example/jared-agent@1.0.0 -- \
  jared-agent mcp --project /work/app-a

# Illustrative Claude Code registration after implementation and publication:
claude mcp add --transport stdio --scope local jared -- \
  npx --yes @example/jared-agent@1.0.0 mcp --project /work/app-a
```

Exact package versions prevent an unreviewed `latest` agent release being selected. `--yes` only suppresses npm's install prompt; it does not confer trust, set credentials or make startup offline. `npx` flags precede the package; `npm exec --` separates npm arguments from application arguments. Cache use can improve repeat startup, but missing cached packages still require fetching; offline mode fails for missing data. Preinstallation with a stable local executable path is preferable for sensitive/air-gapped environments and strict MCP startup budgets. [N5]

The canonical `invoke(agent, operation, input, signal)` already handles operation lookup, JSON Schema validation, worker execution, input/output bounds, timeout, cancellation, secret redaction and fixed error mapping. A CLI can reuse it instead of spawning `pi -p` with separate resource semantics. However, the **MCP server's busy guard and shutdown/broker draining live in `serve`, not `invoke`**; a CLI must explicitly own signals and broker cleanup too. Do not assume merely importing `invoke` provides the server's lifecycle guarantees. [R2:35–146]

### Locking: an important npm-version trap

An application release pin and exact direct dependency versions are not automatically a fully frozen dependency tree. For example, the locked MCP SDK declares ranges for multiple transitives. `package-lock.json` is excluded from ordinary npm publication and is not a nested dependency lock for consumers. npm v11 documents publishable `npm-shrinkwrap.json`, but **npm v12 explicitly no longer reads or writes shrinkwrap, including one inside a dependency tarball**, and recommends `bundleDependencies` to ship a locked tree. Do not recommend shrinkwrap without constraining supported npm versions. [R5, N1, N2, N3]

For a reproducible npx route, evaluate a release built by `npm ci` from reviewed locks with bundled runtime dependencies, then inspect the actual packed artifact and test it on supported architectures/OSes and npm versions. Preserve licenses and audit/update ownership. A lock controls selected bytes; it does not prove their safety. Native/platform-specific dependency behavior and final tarball size need real packaging tests; this research does not certify them. The current checkout/archive route avoids this publish-lock ambiguity by making `.faur-mcp` the root of the consumer's `npm ci`. [N3, N4, R3, R5]

### CLI result contract to decide before implementation

Current public MCP success is `{content:[{type:"text",text:finalAnswer}]}`; errors are text results with `isError:true`. It returns no structured task assessment, tool log, usage record or artifact manifest. The worker's private `{ok,text}` JSON is an IPC envelope, **not an existing consumer CLI API**. Current host CLI options are only serving and `--check-auth [--resolve]`; startup/auth-check errors use process exit code 1. [R2, R6]

Recommended initial consumer CLI contract (**proposal**):

| Aspect | Proposed minimal rule |
|---|---|
| Input | Explicit operation and validated JSON object; reject invalid input before model work. An input-file/stdin alternative avoids shell quoting and command-length limits. |
| Text mode | Only final answer on stdout; diagnostics on stderr. |
| JSON mode | Exactly one versioned result envelope, e.g. `{ok:true,text:"..."}` or `{ok:false,error:{code,message}}`; no stream mixed into it. Do not expose raw provider errors/secrets. |
| Exit | 0 for completed execution, 2 for usage/config/input failure, 1 for execution failure; document separate timeout/cancel codes (e.g. 124/130/143) if adopted. These numeric choices are not current Faur behavior. |
| Semantics | Exit 0 is not “audit passed.” Task-level pass/fail needs an explicitly designed operation-specific structured contract, not inferred prose. |
| Lifecycle | Await cleanup, abort on SIGINT/SIGTERM, close broker, and avoid automatically retrying a write operation after ambiguous failure. |

Resolve the **truncation mismatch** explicitly: current Faur worker accepts both `stop` and `length` and returns success; Pi 1.5.2 print mode prints partial `length` output but warns and exits nonzero. A new CLI should either preserve and document the shared Faur behavior or change the shared seam deliberately (e.g. structured `truncated` status), not accidentally give MCP and CLI different success meanings. Pi JSON mode also does not make an assistant error/abort alone a nonzero process exit; callers inspect events, with `agent_settled` marking completion rather than the earlier `agent_end`. The installed headless docs and source confirm these are different contracts. [R6:62–71, P4]

## Capability, local tooling and security realities

### Shared prompt is not shared whole-agent behavior

The worker supplies a custom resource loader returning **no extensions, skills, prompts, themes or agent context files**. It uses the authored portion of `.pi/APPEND_SYSTEM.md` as its system prompt, excluding generated developer capability text; public operation instructions and serialized JSON arguments become the user prompt. Settings and sessions are in memory; retries and compaction are disabled. Only seven explicitly allowed built-in tool names are available: read, grep, find, ls, write, edit, bash. There is no automatic specialist/package/skill/upstream-MCP composition. [R2:25–27, R4, R6]

Pi's SDK can accept custom or standard resource loaders, settings, sessions and tool selections. Its docs explain that SDK sessions do not automatically get CLI built-in MCP/codemode/tool-search extensions; adding upstream MCP requires explicit extension factories and binding session startup. Thus richer parity is feasible in principle but **not established merely by sharing the lead prompt**. A package must consciously supply each required resource and test how it resolves source assets versus target-project context. Avoid default discovery in an arbitrary consumer checkout just to obtain parity: that would change today's isolation/trust contract. [P1:96–116, P2]

**Provider parity is also bounded.** Faur chooses an exact model from Pi's pinned catalog, disables model-network refresh and `models.json`, and does not discover arbitrary provider extensions. The API-key route only passes declared variables. Environment-backed built-in providers are the simplest consumer onboarding; ambient cloud credentials, proxies, custom catalogs and provider-specific config cannot be assumed to work through this restricted worker. Verify the exact model/provider plus every required variable. [R4:7–38, R6:31–59, P5]

### Flutter / Widgetbook and similar repository tools

Embedding Pi does not install a project's toolchain or dependencies. If a specialized agent must execute Flutter/Widgetbook checks, the target must have the relevant Flutter/Dart SDK, project packages/configuration and any required browser/device/build dependencies; test against that actual project's documented commands. Flutter's official CLI docs describe commands such as `flutter pub get`, `flutter analyze` and `flutter test`; these are external programs/dependencies, not capabilities supplied by Pi or MCP. No Flutter/Widgetbook integration was found in the inspected fixtures/docs; exact Widgetbook prerequisites remain project-specific and unverified here. [F1; inference from R2:43–56, R6:59]

In particular, the worker does **not** inherit the consumer's shell setup: HOME is temporary and PATH is restricted to the Node executable's directory plus `/usr/bin:/bin`. It does not load `.env`. `PATH`, `HOME`, `PI_*` and other execution overrides cannot be granted through `env`. A Flutter SDK in a home-directory/version-manager path may therefore be unavailable even when it works in the user's terminal. First choose an explicit trusted toolchain strategy (e.g. approved absolute executable paths or a narrowly designed host-side binding); packaging alone does not fix it. `bash` is absent unless explicitly allowed and granting it is a substantial authority increase. [R2:45–56, R4:4–28]

### Credentials, sessions, cancellation and concurrency

- **Authentication remains required and separately owned by the consumer.** No MCP-client subscription automatically authenticates the embedded Pi model. Default mode uses declared provider-key environment variables, no global Pi login and no `.env`. Subscription mode currently supports only explicitly declared **openai-codex**, an existing owner-private Pi `auth.json`, and a matching catalog model; it never logs in during a request or falls back to the separately billed OpenAI provider. A consumer without global Pi can use the installed local Pi CLI for an explicit interactive login, but current subscription onboarding still involves Pi's login/store semantics; this is not zero-auth install-and-use. [R1:78–140, R6, R9]
- The long-lived subscription broker parses the shared store through Pi's API; only selected resolved request auth crosses private IPC. The worker does not receive the auth-file path or refresh token. Auth refresh/persistence belongs to the host; graceful shutdown drains it. Existing docs require at least **20 seconds** stop grace for shared-login mode. SIGKILL/disk failures remain outside a loss-free guarantee. API-key mode is the simpler initial distribution default if the consumer can use one. [R1:101–121, R9]
- Each call has a fresh worker, temporary home/agent directory and in-memory session. There is **no conversational memory between MCP calls**, and no resumable session contract. Files modified in the target are real persistent side effects despite ephemeral session state. [R2, R6, P1:36–56]
- One active operation per server; overlaps return busy, not queued. Multiple host processes have no shared target lock, so two registrations or CLI invocations can race on the same repository. Separate per-target processes are a binding design, not write-conflict coordination. Pi credential-store locking discussed in the auth docs is not a repository lock. Start read-only; define caller serialization or a justified target lock before promising safe concurrent mutation. [R1:111–118,184–188, R2:110–146]
- Timeout defaults to 120 seconds, configurable up to one hour; input and output are bounded to 1 MiB. Abort/shutdown terminates the POSIX worker process group, escalates SIGTERM to SIGKILL after 250 ms, and reaps same-group descendants on normal completion. Pi `session.abort()` also participates. Deliberately detached/escaped daemons can survive, cancellation does not roll back filesystem writes, and client stop behavior must be tested. [R2:38–107, R4:41, R6:15–20, R1:214–220]
- **Not a sandbox:** explicit tools and resource/environment filtering enforce configuration isolation, not OS isolation. Read can reach outside target; bash/tools run with the OS user's permissions and can read credential files or exfiltrate data. Declared secret-value redaction is defense in depth, not a confidentiality boundary. Treat callers, projects, package source and operation inputs as trusted; do not sell this as multi-tenant isolation. [R1:199–213]

### MCP stdout and startup constraints

The MCP specification requires stdout to contain only valid MCP messages; logs may go to stderr. Faur captures worker stdout privately, suppresses dependency stdout/stderr inside the worker, and only exposes the MCP SDK transport on host stdout. Keep that discipline in any wrapper: no banners, install instructions, debug logging or JSON CLI envelopes in `mcp` mode. Test npm-launch startup, failure, cancellation and signal propagation end-to-end; do not assume a new executable wrapper preserves process cleanup or client startup deadlines. Slow first install, registry failure, prompting and model-auth failure are distinct stages and should have fixed actionable errors, not a mysterious MCP disconnect. [M1, R2, R6, N5]

## Smallest realistic options compared

| Option | Status | Consumer experience | Fit / limitation |
|---|---|---|---|
| Generated Git/source release + `npm ci` | **Works now** | Obtain source; Node/npm; install once; register absolute Node + host path | Lowest change; locked root install; target config/startup is fixed, not a reusable installed target-selection interface. [R1–R5] |
| Published specialized agent npm app via `npx` | **Proposal** | Node/npm plus credentials, project tools and local MCP client; one pinned launch command | Best fit for install-and-use; needs actual package/bin, target option, publication/security ownership and frozen-tree strategy. [N1–N5] |
| CLI sibling using same invocation seam | **Proposal** | Same package; no MCP client needed; useful for scripts/CI | Small addition if a real caller needs it; input/output/exit/truncation and signal contracts must be designed, not borrowed accidentally from Pi print mode. [R2, R6, P4] |
| Standalone platform executable | **Not demonstrated for this agent** | Potentially removes separate Node/npm | Pi upstream has a binary build script, but that does not prove this host/worker/SDK/native assets can be packaged as one working binary. Current worker explicitly spawns `process.execPath` with an `.mjs` file. Cross-platform assets, distribution, signing, updates and POSIX cleanup require dedicated evidence. Not the smallest first step. [P6, R2:56] |
| Container | **Not implemented here** | Requires container engine, image pull, explicit repo volume and env/secrets | Can pin OS/toolchain for CI, but does not eliminate install prerequisites. Local repo needs an explicit mount; UID/file ownership, toolchain caches and signal handling need design. An unsafely privileged/mounted container is not automatically isolation. Consider only for a concrete reproducible-toolchain need, not default maker scope. [Inference from M1, R2; not a verified Faur capability] |

## Open decisions / verification gates

1. **Consumer product scope:** MCP only initially, or a real one-shot CLI caller too? Prefer one application executable with two modes only when both are requested.
2. **Target/trust contract:** explicit `--project` at startup, process per MCP target, symlink canonicalization and consumer-local binding storage; prohibit remote callers from arbitrary target selection by default.
3. **Package ownership:** agent publisher versus shared adapter package; registry/name/access policy, reviewable releases, supported Node/npm/POSIX versions, bundled dependencies/platform tests and upgrade/audit responsibilities. No package name or publishing workflow is currently established.
4. **Capabilities:** which actual agent requires which skills, specialist package, upstream MCP server, model/provider and local executables? Test a capability matrix; lead-prompt equivalence is not acceptance.
5. **Results:** retain text-only success initially? Handle `length` consistently. Only introduce structured task outcomes or persistent sessions for a proven consumer requirement.
6. **Operational acceptance:** clean-machine install without global Pi/Faur; packed artifact with no checkout references; arbitrary caller cwd; one source bound to two independent targets; Node minimum; install offline/cache failures; stdout framing; startup errors; client cancellation/reuse/stop grace; credential handling without real provider calls; local tool PATH behavior; concurrent writes; source read-only behavior.

**Bottom line:** do not ask consumers to install Faur or Pi globally. Use the current local MCP bundle today; productize an opt-in, versioned agent executable around the same Pi SDK worker next, with explicit local target binding. That provides the requested reusable agent application without inventing a runtime or broadening ordinary Faur projects into a framework.

## Sources

Repository citations are relative to `/home/ops/projects/mightyAgents/faur` at `ad34a48` (v0.41.1). Line references identify the inspected implementation, not the historical architecture described elsewhere.

- **R1:** `docs/mcp-serving.md:44–76,78–151,153–221,223–261` — install, public execution boundary, auth, maintenance, security, distribution and existing test evidence.
- **R2:** `mcp/host.mjs:17–27,35–107,110–146,148–182` — source/target snapshot, exported shared invocation, lifecycle/stdio and existing auth-check CLI.
- **R3:** `src/mcp-project.mjs:12–41,57–88` — copied assets/lock/config, developer extension, generated README and edit protection. Fixture: `test/fixtures/generate/mcp-server/golden/.faur-mcp/config.json:1–49` (explicit relative target, operation schemas, Azure model/env). Subscription fixture: `test/fixtures/generate/mcp-subscription/golden/.faur-mcp/`.
- **R4:** `src/mcp-server.mjs:4–51` — exact built-ins, reserved env, strict config/input validation, target and timeout declarations.
- **R5:** `package.json:1–27`; `mcp/package.json:1–14`; `mcp/package-lock.json:1–17,466–500,609–656` — private manifests, direct pins, transitive resolutions and Node engine. Locked tree also contains `hasInstallScript` at lines 571 and 2171.
- **R6:** `mcp/worker.mjs:8–77` — SDK import, output isolation, model/catalog/auth configuration, explicit empty resources, in-memory settings/session and final-result acceptance.
- **R7:** `docs/product-direction.md:17–35,50–67,195–209`; `docs/architecture-audit.md:1–16` — maker-only core and approved opt-in exception. Historical audit tables must not be read as current runtime behavior.
- **R8:** `src/mcp-auth-status.mjs` and `mcp/host.mjs:58–66,157–166` — source-local historical auth evidence.
- **R9:** `mcp/subscription-auth.mjs:42–121,157–170`; `mcp/subscription-registration.md`; `docs/research/pi-subscription-auth.md` — explicit selected-provider broker, local store and refresh boundaries.

Installed primary Pi sources below use prefix **`/home/ops/.local/lib/node_modules/@earendil-works/pi-coding-agent/`**, package version 1.5.2. Those local docs were read before API/harness conclusions.

- **P1:** installed `docs/sdk.md:3–20,26–70,90–116`; upstream [SDK docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md).
- **P2:** installed `dist/core/sdk.js:69–82,145–160,304–327`; upstream [SDK factory source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts) and [public exports](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/index.ts).
- **P3:** installed `docs/packages.md:3–31,100–116,147–151`; upstream [package docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). Pi's extension peer-dependency guidance is for packages loaded **by Pi**, not a prohibition on an independent executable embedding the SDK as a direct runtime dependency.
- **P4:** installed `docs/cli-integration.md:3–7,20–52,54–78`; `dist/modes/print-mode.js:119–139`; upstream [CLI integration docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli-integration.md).
- **P5:** installed `docs/providers.md:3–29,31–69,86–101`; upstream [provider docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md).
- **P6:** installed `package.json` (`version`, `bin`, `build:binary`, `engines`); retrieved upstream [package metadata/build script](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json). Upstream binary build support is not a verified Faur application-binary release.

Official npm, MCP, client and toolchain sources fetched during research:

- **N1:** [npm v11 package.json: bin, files, private, bundleDependencies](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
- **N2:** [npm v11 npm-shrinkwrap](https://docs.npmjs.com/cli/v11/commands/npm-shrinkwrap/) — older publishable-lock behavior; version-qualified, not universal advice.
- **N3:** [npm v12 package-lock.json: shrinkwrap no longer read/written](https://docs.npmjs.com/cli/v12/configuring-npm/package-lock-json/); [npm v12 package.json](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/) — bundled dependency option.
- **N4:** [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) and [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/) — root lock/install and lifecycle behavior.
- **N5:** [npm exec / npx](https://docs.npmjs.com/cli/v11/commands/npm-exec/) — executable selection, cache install, prompt suppression, argument parsing and offline behavior.
- **M1:** [MCP 2025-11-25 transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio) — local subprocess, JSON-RPC/stdout discipline and contrast with Streamable HTTP. This is a concrete normative transport reference, not a claim that this is the newest protocol version.
- **C1:** [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) — local stdio launch-command registration, npx/argument separator, local/project scope and security approval.
- **F1:** [Flutter CLI reference](https://docs.flutter.dev/reference/flutter-cli) — project package, analyze and test commands. No claim of verified Widgetbook-specific execution is made.
