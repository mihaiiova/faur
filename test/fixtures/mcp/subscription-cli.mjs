import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { fixtureSubscriptionProvider } from './subscription-sdk.mjs';
export default pi => {
  pi.registerProvider(fixtureSubscriptionProvider(openaiCodexProvider()));
  pi.registerCommand('fixture-auth', { description: 'Resolve fake-only auth, never call a model', handler: async (_args, ctx) => {
    const auth = await ctx.modelRegistry.getProviderAuth('openai-codex');
    process.stdout.write(JSON.stringify({ ok: auth?.source === 'OAuth' }) + '\n');
  } });
};
