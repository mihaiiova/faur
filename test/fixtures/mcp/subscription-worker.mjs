import { runWorker } from './faur/mcp/worker.mjs';
import { fixtureSdk } from './subscription-sdk.mjs';
await runWorker({ loadSdk: async () => fixtureSdk({ worker: true }) });
