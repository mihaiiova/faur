// Authored source extension for generated-project tests. No network model requests.
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export default async pi => {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const subscription = fs.existsSync(path.join(source, 'subscription-fixture'));
  let child = process.env.PI_SUBAGENT_CHILD === '1';
  const provider = subscription ? 'openai-codex' : 'native-fixture';
  const id = subscription ? 'gpt-6-sol' : 'test';
  const faux = createFauxCore({ api: 'native-fixture-api', provider, models: [{ id }] });
  let target, cwd, startup, scripted = false;
  const log = value => fs.appendFileSync(path.join(target, 'native-events.jsonl'), JSON.stringify({ child, ...value }) + '\n');
  pi.registerTool({ name: 'source_marker', label: 'Source marker', description: 'Exercise authored extension cwd', parameters: Type.Object({ target: Type.String() }),
    async execute(_id, args, _signal, _update, ctx) {
      fs.writeFileSync(path.join(args.target, child ? 'child-extension' : 'lead-extension'), ctx.cwd);
      const result = await pi.exec(process.execPath, ['-e', 'process.stdout.write(process.cwd())']);
      log({ extensionExec: result.stdout });
      return { content: [{ type: 'text', text: result.stdout }], details: {} };
    },
  });
  pi.on('session_start', (_event, ctx) => {
    cwd = ctx.cwd;
    const credentialPath = subscription ? path.join(process.env.PI_CODING_AGENT_DIR, 'auth.json') : undefined;
    startup = { selectedStore: credentialPath ? fs.realpathSync(credentialPath) : undefined,
      directStoreAccess: credentialPath ? Boolean(JSON.parse(fs.readFileSync(credentialPath, 'utf8'))['fixture-unrelated']) : undefined,
      selectorEnvVisible: Boolean(process.env.FIXTURE_AUTH_FILE), startup: { cwd: ctx.cwd }, prompt: ctx.getSystemPrompt() };
  });
  pi.on('agent_end', event => { if (target) log({ ended: event.messages?.filter(message => message.role === 'assistant').at(-1)?.stopReason }); });
  const streamSimple = (model, context, options) => {
    if (!scripted) {
      child ||= JSON.stringify(context).includes('SOURCE_SPECIALIST_INSTRUCTIONS');
      const text = JSON.stringify(context).replaceAll('\\"', '"');
      const match = /Target project \(absolute path\): "([^"\n]+)"/.exec(text);
      if (!match) throw new Error('Absolute target missing from operation/delegation task');
      target = match[1]; scripted = true; log(startup);
      const calls = child && fs.existsSync(path.join(source, 'hang-child')) ? [
        ['bash', { command: `cd ${JSON.stringify(target)}; while :; do printf x >> child-heartbeat; sleep 0.02; done` }],
      ] : child ? [
        ['source_marker', { target }], ['cli_marker', { target }], ['mcp__upstream__pwd', { target }],
        ['read', { path: path.join(target, 'target-context') }], ['write', { path: path.join(target, 'child-write'), content: 'native child write' }],
      ] : [
        ['source_marker', { target }], ['cli_marker', { target }], ['mcp__upstream__pwd', { target }],
        ['read', { path: path.join(target, 'target-context') }], ['write', { path: path.join(target, 'lead-write'), content: 'native lead write' }],
        ...(subscription ? [['subagents_enable', {}]] : []),
        ['subagent', { agent: 'specialist', task: `/skill:source-skill execute source specialist. Target project (absolute path): ${JSON.stringify(target)}`, async: false }],
      ];
      faux.setResponses([...calls.map(([name, args]) => fauxAssistantMessage([fauxToolCall(name, args)])), fauxAssistantMessage(child ? 'child done' : 'lead done')]);
    }
    log({ context, tools: pi.getActiveTools(), authenticated: subscription ? ['fixture-access-fresh', 'fixture-access-rotated'].includes(options.apiKey) : undefined });
    if (fs.existsSync(path.join(source, 'length-answer'))) faux.setResponses([fauxAssistantMessage('incomplete private answer', { stopReason: 'length' })]);
    if (child && !JSON.stringify(context).includes('SOURCE_SPECIALIST_INSTRUCTIONS')) throw new Error('Native specialist prompt was not applied');
    return faux.streamSimple(model, context, options);
  };
  if (subscription) {
    const { openaiCodexProvider } = await import(pathToFileURL(path.join(source, '.faur-mcp/node_modules/@earendil-works/pi-ai/dist/providers/openai-codex.js')).href);
    const native = openaiCodexProvider();
    pi.registerProvider({ ...native, streamSimple, auth: { oauth: {
      ...native.auth.oauth,
      login: async () => { throw new Error('Interactive login must never run'); },
      async refresh(credential, signal) {
        const response = await fetch(process.env.FIXTURE_REFRESH_URL, { method: 'POST', body: JSON.stringify({ refresh: credential.refresh }), signal });
        if (!response.ok) throw new Error('PRIVATE_REFRESH_ERROR');
        return response.json();
      },
      toAuth: async credential => ({ apiKey: credential.access }),
    } } });
  } else pi.registerProvider(provider, { baseUrl: 'http://localhost:0', apiKey: 'fake-only', api: 'native-fixture-api', streamSimple,
    models: [{ type: 'chat', id, name: 'fake', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }],
  });
};
