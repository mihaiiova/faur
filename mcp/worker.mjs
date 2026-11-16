/** Fresh Pi SDK process. No native/global discovery and no developer extensions. */
import { join } from 'node:path';

const write = process.stdout.write.bind(process.stdout);
// Pi/dependency diagnostics must never become either MCP protocol or tool output.
process.stdout.write = () => true;
process.stderr.write = () => true;

let session;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  // Pi owns cancellation of active tools (including its detached shell group).
  // The host still enforces a bounded SIGKILL fallback for a stuck SDK/provider.
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
  const { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, modelsStorePath: join(agentDir, 'models-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
  const slash = request.model.indexOf('/');
  const model = modelRuntime.getModel(request.model.slice(0, slash), request.model.slice(slash + 1));
  if (!model) throw new Error('Model unavailable');
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
} catch {
  write(JSON.stringify({ ok: false }));
  process.exitCode = 1;
} finally {
  process.removeListener('SIGTERM', stop);
  process.removeListener('SIGINT', stop);
}
