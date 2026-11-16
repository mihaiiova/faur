// Separate-process fixture: HOME/auth paths are disposable and all tokens fake.
import { loadAgent, invoke, checkAuthentication } from './faur/mcp/host.mjs';
import { createSubscriptionBroker } from './faur/mcp/subscription-auth.mjs';
import { fixtureSdk } from './subscription-sdk.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const mode = process.argv[2];
const source = resolve('..');
const model = process.env.FIXTURE_MODEL ?? 'openai-codex/gpt-6-sol';
const auth = { mode: 'pi-subscription', provider: 'openai-codex', authFileEnv: 'JARED_PI_AUTH_FILE' };
const controller = new AbortController();
process.on('message', message => { if (message === 'cancel') controller.abort(); });
const loadSdk = async () => fixtureSdk({ onRefresh: () => process.send?.({ event: 'refresh-started' }) });
let broker;
try {
  let result;
  if (mode === 'native-resolve') {
    const sdk = await loadSdk();
    const runtime = await sdk.ModelRuntime.create({ authPath: process.env.JARED_PI_AUTH_FILE, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    try { await runtime.getAuth('openai-codex'); result = { ok: true }; }
    finally { await runtime.settleCredentialWrites(); }
  } else if (mode === 'resolve' || mode === 'inspect') {
    broker = createSubscriptionBroker(auth, model, { loadSdk });
    result = mode === 'inspect' ? await broker.inspect() : await broker.resolve(controller.signal).then(() => ({ ok: true }), error => ({ errorCode: error.code }));
  } else if (mode === 'check-real' || mode === 'check-real-resolve') result = await checkAuthentication(source, { resolveAuth: mode === 'check-real-resolve' });
  else {
    const agent = loadAgent(source, { loadSdk }); broker = agent.authBroker;
    result = await invoke(agent, 'audit', { request: 'audit' }, controller.signal, { workerPath: pathToFileURL(resolve('subscription-worker.mjs')) });
    process.send?.({ event: 'invocation-returned' });
  }
  await broker?.close();
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) { process.stdout.write(JSON.stringify({ failed: true, errorCode: error.code ?? 'fixture-failed' }) + '\n'); }
finally { await broker?.close(); if (process.connected) process.disconnect(); }
