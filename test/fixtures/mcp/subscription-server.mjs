import { serve } from './faur/mcp/host.mjs';
import { fixtureSdk } from './subscription-sdk.mjs';
import { resolve } from 'node:path';
await serve(resolve(import.meta.dirname, '..'), {
  brokerOptions: { loadSdk: async () => fixtureSdk() },
  workerPath: new URL('./subscription-worker.mjs', import.meta.url),
});
