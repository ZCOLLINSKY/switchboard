'use strict';
// Packaging: the connector works where Claude Desktop runs it, and the board's key reaches the person's browser
// without ever reaching the assistant.
const { childEnv, freePort } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { start } = require('../server');
const root = path.join(__dirname, '..');
const json = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbpk-'));

// The connector, spoken to over stdio as a client would. `pre` goes before mcp.js on the node command line.
function mcp(env, pre = []) {
  const c = spawn(process.execPath, pre.concat([path.join(root, 'mcp.js')]), { env: childEnv(env), stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '', id = 0; const waiting = new Map(), lines = [];
  c.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); lines.push(line); const m = JSON.parse(line); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const req = (method, params) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const call = async (name, args) => { const r = (await req('tools/call', { name, arguments: args || {} })).result; return { error: !!r.isError, text: r.content[0].text }; };
  return { c, req, call, lines, close: () => c.kill(), ended: () => new Promise((ok) => { c.stdin.end(); c.on('close', ok); }) };
}
const hello = (m) => m.req('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 't' } });

test('the connector reports the version in package.json', async () => {
  const m = mcp({ SWITCHBOARD_HOME: tmp() }); // initialize never contacts a board
  try { assert.equal((await hello(m)).result.serverInfo.version, json('package.json').version); } finally { m.close(); }
});

test('open_board hands the key link to the browser and never to the assistant', async () => {
  const dir = tmp(), a = await start({ port: 0, dir }), seen = path.join(dir, 'opened.txt'), browser = path.join(tmp(), 'browser.sh');
  fs.writeFileSync(browser, `#!/bin/sh\nprintf '%s' "$1" > "${seen}"\n`, { mode: 0o755 });
  const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port, BROWSER: browser });
  try {
    await hello(m);
    const r = await m.call('open_board');
    assert.ok(!r.error, r.text);
    assert.ok(!r.text.includes(a.key) && !/[a-f0-9]{32}/.test(r.text), 'the key is not in what the assistant reads');
    assert.ok(!m.lines.some((l) => l.includes(a.key)), 'the key is nowhere in what the connector wrote');
    for (let i = 0; i < 50 && !fs.existsSync(seen); i++) await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(fs.readFileSync(seen, 'utf8'), a.link);
  } finally { m.close(); a.close(); }
});

test('setup_guide gives the first-run steps from SETUP.md without touching a board', async () => {
  const m = mcp({ SWITCHBOARD_HOME: tmp() }); // port 1: any call to a board would fail
  try {
    await hello(m);
    const r = await m.call('setup_guide');
    assert.ok(!r.error, r.text);
    const g = JSON.parse(r.text);
    assert.match(g.guide, /^## 5\. Put their real life on it/);
    assert.match(g.guide, /## 6\. Prove the loop/);
    assert.match(g.guide, /## Rules that always apply/);
    assert.doesNotMatch(g.guide, /## [1-47]\./, 'not the install steps, and not the optional ones');
    assert.match(g.note, /open_board/);
  } finally { m.close(); }
});

test('a setting the launcher left unfilled counts as not set', async () => {
  // Claude Desktop passes "${user_config.x}" as written when a setting has no value.
  const a = await start({ port: 0, dir: tmp() });
  const m = mcp({ SWITCHBOARD_URL: a.url, SWITCHBOARD_HOME: '${user_config.data_folder}', SWITCHBOARD_AGENT: '${user_config.agent}' });
  try {
    await hello(m);
    const r = await m.call('raise_light', { area: 'Shop', title: 'Order more boxes', kind: 'todo' });
    assert.ok(!r.error, r.text);
    assert.match(a.store.db.lights[0].agent, /^t:[^$]+~[a-f0-9]{4}$/, 'named the usual way, not "${user_config.agent}"');
  } finally { m.close(); a.close(); }
});

test('where Node cannot start Node (Claude Desktop\'s built-in runtime), the board runs inside the connector', async () => {
  const dir = tmp(), port = await freePort();
  const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port }, ['-r', path.join(__dirname, 'fixtures', 'refuse-self-spawn.js')]);
  try {
    await hello(m);
    const r = await m.call('list_lights');
    assert.ok(!r.error, r.text);
    assert.equal(JSON.parse(r.text).board, `http://127.0.0.1:${port}`);
    assert.ok(fs.existsSync(path.join(dir, 'server.lock')), 'the board is running on this data');
  } finally { await m.ended(); }
  assert.ok(!fs.existsSync(path.join(dir, 'server.lock')), 'the board stopped with the connector and left no lock');
});
