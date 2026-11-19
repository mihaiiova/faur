/** Fresh native Pi session: source owns configuration and cwd; target paths are advisory task context. */
import { join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authError, authErrorCode, createSelectedAuthStore } from './subscription-auth.mjs';

const failure = code => Object.assign(new Error(code), { code });

// loadSdk is a development test seam, never generated configuration or public input.
export async function runWorker({ loadSdk = () => import('@earendil-works/pi-coding-agent') } = {}) {
  const write = process.stdout.write.bind(process.stdout);
  // Neither native diagnostics nor trusted extension logs belong on MCP stdout.
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  let session, store, runtime, lastAssistant, subscription = false, authenticated = false, stopping = false, shutdown;
  const controller = new AbortController();
  const secrets = new Set();
  const redact = text => [...secrets].filter(Boolean).sort((a, b) => b.length - a.length).reduce((value, secret) => value.split(secret).join('[REDACTED]'), text);
  async function stop() {
    stopping = true;
    controller.abort();
    if (!shutdown) shutdown = (async () => {
      await session?.abort();
      await session?.extensionRunner?.emit({ type: 'session_shutdown', reason: 'quit' });
      session?.dispose();
      await runtime?.settleCredentialWrites();
      await store?.close();
    })();
    await shutdown;
  }
  const signalStop = () => { stopping = true; controller.abort(); if (session) void stop().catch(() => {}); };
  process.once('SIGTERM', signalStop);
  process.once('SIGINT', signalStop);
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 1024 * 1024) throw failure('native-input');
    }
    const request = JSON.parse(input);
    subscription = request.auth?.mode === 'pi-subscription';
    const sdk = await loadSdk();
    const identity = { cwd: request.source, agentDir: process.env.PI_CODING_AGENT_DIR };
    process.env.FAUR_MCP_RUNTIME = '1'; // Bundled maker opt-out only, not a security boundary.
    const settingsManager = sdk.SettingsManager.create(request.source, identity.agentDir, { projectTrusted: true });
    const mcp = sdk.createMcpExtension();
    const loader = new sdk.DefaultResourceLoader({ ...identity, settingsManager, extensionFactories: [
      { name: 'codemode', factory: sdk.createCodemodeExtension(), builtin: true, replaceable: true },
      { name: 'tool_search', factory: sdk.createToolSearchExtension(), builtin: true, replaceable: true },
      { name: 'mcp', factory: mcp, builtin: true, replaceable: true },
      pi => pi.on('before_agent_start', () => ({ message: { customType: 'faur-operation', content: request.taskContext, display: false } })),
    ] });
    // Pi normally installs missing packages while resolving. Calls must never acquire code.
    const packages = new sdk.DefaultPackageManager({ cwd: request.source, agentDir: identity.agentDir, settingsManager });
    for (const pkg of packages.listConfiguredPackages()) {
      if (!pkg.installedPath) throw failure('native-packages');
      try { realpathSync(pkg.installedPath); } catch { throw failure('native-packages'); }
    }
    // The native missing-source hook checks pinned-version mismatches as well. Offline mode
    // normally skips them silently, so preflight it with acquisition explicitly refused.
    delete process.env.PI_OFFLINE;
    try { await packages.resolve(async () => { throw failure('native-packages'); }); }
    finally { process.env.PI_OFFLINE = '1'; }
    await loader.reload();
    if (!loader.getExtensions().extensions.some(extension => extension.path === 'builtin:mcp')) throw failure('native-mcp');
    if (loader.getExtensions().errors.length || [loader.getSkills(), loader.getPrompts(), loader.getThemes()].some(result => result.diagnostics.some(d => d.type === 'error')) || settingsManager.drainErrors().length) throw failure('native-resources');
    runtime = await sdk.ModelRuntime.create({ authPath: join(identity.agentDir, 'auth.json'), modelsPath: join(request.source, '.pi/models.json'), modelsStorePath: join(identity.agentDir, 'models-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
    // Apply source registrations to resolve the explicitly declared model before SDK startup.
    // The native runner applies the same queues when binding; no model is auto-selected.
    for (const registration of loader.getExtensions().runtime.pendingProviderRegistrations) runtime.registerProvider(registration.name, registration.config);
    for (const registration of loader.getExtensions().runtime.pendingNativeProviderRegistrations) runtime.registerNativeProvider(registration.provider);
    for (const registration of loader.getExtensions().runtime.pendingVirtualModelRegistrations) runtime.registerVirtualModel(registration.definition);
    await runtime.refresh({ allowNetwork: false });
    if (runtime.getError()) throw failure('native-model');
    const slash = request.model.indexOf('/');
    const model = runtime.getModel(request.model.slice(0, slash), request.model.slice(slash + 1));
    if (!model) throw subscription ? authError('auth-catalog-incompatible') : failure('native-model');
    if (subscription) {
      store = createSelectedAuthStore(request.auth, request.model, { env: { [request.auth.authFileEnv]: request.authPath }, runtime, loadSdk: async () => sdk });
      const status = await store.inspect();
      if (status.errorCode) throw authError(status.errorCode);
      store.collectSecrets(secrets);
    }
    if (stopping) throw failure('native-cancelled');
    ({ session } = await sdk.createAgentSession({ ...identity, modelRuntime: runtime, model, thinkingLevel: request.thinking ?? 'off', resourceLoader: loader, settingsManager, sessionManager: sdk.SessionManager.inMemory(request.source) }));
    let extensionFailed = false;
    await session.bindExtensions({ onError: () => { extensionFailed = true; } });
    // Published native MCP connects on session_start; direct/deferred waits belong to Pi.
    if (extensionFailed) throw failure('native-resources');
    if (stopping) throw failure('native-cancelled');
    if (subscription) {
      await store.resolve(controller.signal, secret => secrets.add(secret));
      authenticated = true;
    }
    // Incomplete/error turns need not enter finalized native session context.
    session.subscribe(event => { if (event.type === 'message_end' && event.message.role === 'assistant') lastAssistant = event.message; });
    await session.prompt(request.prompt);
    const last = lastAssistant ?? session.messages.filter(message => message.role === 'assistant').at(-1);
    if (extensionFailed) throw failure('native-resources');
    if (last?.stopReason === 'length') throw failure('native-length');
    if (!last || last.stopReason !== 'stop') throw subscription ? authError('auth-execution-failed') : failure('native-execution');
    const text = session.getLastAssistantText();
    if (typeof text !== 'string') throw failure('native-execution');
    store?.collectSecrets(secrets);
    await stop();
    write(JSON.stringify({ ok: true, text: redact(text), authenticated }));
  } catch (error) {
    await stop();
    const errorCode = lastAssistant?.stopReason === 'length' ? 'native-length' : typeof error?.code === 'string' && error.code.startsWith('native-') ? error.code : subscription ? authErrorCode(error) : 'native-execution';
    write(JSON.stringify({ ok: false, errorCode }));
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGTERM', signalStop);
    process.removeListener('SIGINT', signalStop);
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) await runWorker();
