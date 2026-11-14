'use strict';
// A port that browsers and fetch refuse (6000, 5060, 10080…) is refused with a plain reason by the board and by the
// connector, instead of a board that starts and can never be reached.
const { childEnv } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { start } = require('../server');

test('the board will not start on a port browsers refuse', async () => {
  await assert.rejects(start({ port: 6000, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'sbp-')) }), /browsers refuse to open/);
});

test('the connector says why instead of failing with "bad port"', async () => {
  const c = spawn(process.execPath, [path.join(__dirname, '..', 'mcp.js')], { env: childEnv({ SWITCHBOARD_PORT: '6000', SWITCHBOARD_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'sbp-')) }), stdio: ['pipe', 'pipe', 'inherit'] });
  let out = ''; c.stdout.on('data', (d) => { out += d; });
  c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } } }) + '\n');
  c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_lights', arguments: {} } }) + '\n');
  await new Promise((ok) => { const t = setInterval(() => { if (out.includes('"id":2')) { clearInterval(t); ok(); } }, 20); setTimeout(() => { clearInterval(t); ok(); }, 8000); });
  c.stdin.end();
  const reply = out.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.id === 2);
  assert.ok(reply && reply.result.isError, out);
  assert.match(reply.result.content[0].text, /browsers refuse to open/);
});
