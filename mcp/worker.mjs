/** Fresh Pi SDK process. No native/global discovery and no developer extensions. */
import { join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authError, authErrorCode, emptyCredentials, installSubscriptionResolver, workerAuthClient } from './subscription-auth.mjs';

// loadSdk is an executable test seam, never configuration or a public MCP argument.
export async function runWorker({ loadSdk = () => import('@earendil-works/pi-coding-agent') } = {}) {
  const write = process.stdout.write.bind(process.stdout);
  // Pi/dependency diagnostics must never become either MCP protocol or tool output.
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  let session, client, subscription = false, lastAuthError;
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    // The host (not this killable worker) owns any pending credential refresh.
    try { await session?.abort(); } finally { session?.dispose(); }
  }
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Input too large');
    }
    const request = JSON.parse(input);
    subscription = request.auth?.mode === 'pi-subscription';
    const { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager } = await loadSdk();
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    const modelRuntime = await ModelRuntime.create({ ...(subscription ? { credentials: emptyCredentials } : { authPath: join(agentDir, 'auth.json') }), modelsPath: null, modelsStorePath: join(agentDir, 'models-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
    const slash = request.model.indexOf('/');
    const model = modelRuntime.getModel(request.model.slice(0, slash), request.model.slice(slash + 1));
    if (!model) throw authError('auth-catalog-incompatible');
    if (subscription) {
      if (request.auth.provider !== model.provider) throw authError('auth-provider-mismatch');
      client = workerAuthClient();
      installSubscriptionResolver(modelRuntime, request.auth.provider, async signal => {
        try { return await client.resolve(signal); }
        catch (error) { lastAuthError = authErrorCode(error); throw authError(lastAuthError); }
      });
    }
    const resourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => request.systemPrompt,
      getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [],
      getAppendSystemPromptSources: () => [],
      extendResources: () => {},
      reload: async () => {},
    };
    if (stopping) throw new Error('Cancelled during startup');
    ({ session } = await createAgentSession({ cwd: request.target, agentDir, modelRuntime, model, thinkingLevel: request.thinking ?? 'off', resourceLoader, tools: request.tools, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }), sessionManager: SessionManager.inMemory(request.target) }));
    try {
      if (stopping) throw new Error('Cancelled during startup');
      await session.prompt(request.prompt);
      const last = session.messages.filter(message => message.role === 'assistant').at(-1);
      if (!last || !['stop', 'length'].includes(last.stopReason)) throw new Error('Execution failed');
      const text = session.getLastAssistantText();
      if (typeof text !== 'string') throw new Error('No answer');
      write(JSON.stringify({ ok: true, text }));
    } finally { session.dispose(); }
  } catch (error) {
    write(JSON.stringify({ ok: false, ...(subscription ? { errorCode: lastAuthError ?? (error?.code ? authErrorCode(error) : 'auth-execution-failed') } : {}) }));
    process.exitCode = 1;
  } finally {
    client?.close();
    if (subscription && process.connected) process.disconnect();
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) await runWorker();
