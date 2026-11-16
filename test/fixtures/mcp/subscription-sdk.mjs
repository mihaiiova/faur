// Test-only public SDK composition. Never included in generated runtime assets.
import * as sdk from '@earendil-works/pi-coding-agent';
import { createFauxCore, fauxAssistantMessage } from '@earendil-works/pi-ai';

export function fixtureSubscriptionProvider(native, onRefresh = () => {}) {
  return { ...native, auth: { oauth: {
    ...native.auth.oauth,
    login: async () => { throw new Error('Interactive login must never run'); },
    async refresh(credential, signal) {
      onRefresh();
      const response = await fetch(process.env.FIXTURE_REFRESH_URL, { method: 'POST', body: JSON.stringify({ refresh: credential.refresh }), signal });
      if (!response.ok) throw new Error('PRIVATE_REFRESH_DIAGNOSTIC ' + credential.refresh);
      return response.json();
    },
    toAuth: async credential => ({ apiKey: credential.access }),
  } } };
}

export function fixtureSdk({ worker = false, onRefresh = () => {} } = {}) {
  let activeTools;
  return { ...sdk, createAgentSession: async options => {
    const result = await sdk.createAgentSession(options);
    activeTools = result.session.getActiveToolNames();
    return result;
  }, ModelRuntime: { async create(options) {
    const runtime = await sdk.ModelRuntime.create(options);
    const native = runtime.getProvider('openai-codex');
    if (options.authPath) runtime.registerNativeProvider(fixtureSubscriptionProvider(native, onRefresh));
    if (worker) {
      const faux = createFauxCore({ api: 'subscription-fixture', provider: 'openai-codex', models: [{ id: 'gpt-6-sol' }] });
      runtime.registerNativeProvider({ ...native, streamSimple(model, context, callOptions) {
        const transcript = JSON.stringify(context);
        const isolation = {
          tools: activeTools,
          subscriptionBearerUsed: ['fixture-access-fresh', 'fixture-access-rotated'].includes(callOptions.apiKey),
          sourceVisible: Object.keys(process.env).some(key => key.endsWith('_PI_AUTH_FILE')),
          ambientVisible: Boolean(process.env.DEVELOPER_ONLY_SECRET),
          privateInstructionsVisible: /PARENT_PRIVATE_INSTRUCTIONS|GLOBAL_POISON/.test(transcript),
          credentialInPrompt: /fixture-access|fixture-refresh|UNRELATED_|DO_NOT_USE_BILLED/.test(transcript),
        };
        // Deliberately echo resolved bearer to prove host-side redaction.
        faux.setResponses([fauxAssistantMessage(JSON.stringify({ isolation, bearer: callOptions.apiKey, cwd: process.cwd() }))]);
        return faux.streamSimple(model, context, callOptions);
      } });
    }
    return runtime;
  } } };
}
