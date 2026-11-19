// Deterministic process-boundary fixture, never part of generated projects.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
request.prompt += request.taskContext;
if (request.prompt.includes('fixture-malformed')) {
  process.stdout.write('PRIVATE_INVALID_JSON_DIAGNOSTIC');
} else if (request.prompt.includes('fixture-oversized')) {
  process.stdout.write('x'.repeat(1024 * 1024 + 1));
} else if (request.prompt.includes('fixture-hang')) {
  spawn(process.execPath, ['-e', `const fs = require('fs'); setInterval(() => fs.appendFileSync(process.argv[1], '.'), 20);`, join(request.target, 'heartbeat')], { stdio: 'ignore' });
  process.on('SIGTERM', () => {}); // Prove the bounded SIGKILL escalation path.
  writeFileSync(join(request.target, 'worker-ready'), 'ready');
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(JSON.stringify({ ok: true, text: JSON.stringify({ cwd: process.cwd(), tools: request.tools, env: process.env }) }));
}
