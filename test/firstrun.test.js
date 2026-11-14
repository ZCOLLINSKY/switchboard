'use strict';
// A new person's first hours: approvals on a board no assistant has checked in on yet wait for one instead of turning
// red, the board shows how to connect an assistant until the first light comes in through one, and Claude Desktop
// users are told to start a chat with "check my Switchboard".
const { childEnv } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { start } = require('../server');
const root = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbfr-'));
const post = (a, route, body, headers) => fetch(a.url + route, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(body) }).then((r) => r.json());
const state = (a) => fetch(a.url + '/api/state').then((r) => r.json());

function mcp(env) {
  const c = spawn(process.execPath, [path.join(root, 'mcp.js')], { env: childEnv(env), stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '', id = 0; const waiting = new Map();
  c.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, n)); buf = buf.slice(n + 1); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const req = (method, params) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const call = async (name, args) => { const r = (await req('tools/call', { name, arguments: args || {} })).result; if (r.isError) throw new Error(r.content[0].text); return JSON.parse(r.content[0].text); };
  return { req, call, hello: () => req('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 't' } }), close: () => c.kill() };
}

test('an assistant asking for decisions is a check-in the board keeps', async () => {
  const dir = tmp(), a = await start({ port: 0, dir });
  try {
    assert.equal((await state(a)).lastCheckIn, null, 'a new board: no assistant yet');
    const t0 = Date.now();
    await post(a, '/api/decisions', { agent: 'bot' });
    const seen = (await state(a)).lastCheckIn;
    assert.ok(seen >= t0, 'the state says when');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).seen.checkIn, seen, 'and it is saved');
  } finally { a.close(); }
});

test('setup_guide tells Claude Desktop users to start a chat with "check my Switchboard"', async () => {
  const m = mcp({ SWITCHBOARD_HOME: tmp() });
  try {
    await m.hello();
    const g = await m.call('setup_guide');
    assert.match(g.note, /Claude Desktop/);
    assert.match(g.note, /check my Switchboard/);
  } finally { m.close(); }
});
