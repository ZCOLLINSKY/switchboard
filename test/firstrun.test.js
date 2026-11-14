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

test('the state carries how to connect an assistant: the plugin lines, the terminal line for this board, the Desktop file', async () => {
  const dir = tmp(), a = await start({ port: 0, dir });
  try {
    const c = (await state(a)).connect, port = new URL(a.url).port;
    assert.equal(c.folder, root);
    assert.deepEqual(c.plugin, ['/plugin marketplace add ZCOLLINSKY/switchboard', '/plugin install switchboard@zcollinsky']);
    // This board's own folder and port go in, after the server's name and before "--".
    assert.equal(c.mcp, `claude mcp add --scope user switchboard -e SWITCHBOARD_HOME="${dir}" -e SWITCHBOARD_PORT=${port} -- node "${path.join(root, 'mcp.js')}"`);
    assert.match(c.desktop, /^https:\/\/github\.com\/ZCOLLINSKY\/switchboard\/releases\/latest$/);
  } finally { a.close(); }
  const sim = await start({ port: 0, dir: tmp(), sim: true, live: false });
  try { assert.equal((await state(sim)).connect, null, 'a simulation is never connected to'); } finally { sim.close(); }
});

test('"connected" turns on with the first light raised through the connector, not through a script', async () => {
  const dir = tmp(), a = await start({ port: 0, dir });
  const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port });
  try {
    assert.equal((await state(a)).connected, false);
    await post(a, '/api/lights', { area: 'Shop', title: 'From a script', agent: 'cron' });
    assert.equal((await state(a)).connected, false, 'a script is not an assistant connector');
    await m.hello();
    await m.call('raise_light', { area: 'Shop', title: 'From an assistant', kind: 'todo' });
    assert.equal((await state(a)).connected, true);
  } finally { m.close(); a.close(); }
});

test('the page offers to connect an assistant until one is connected, with copy buttons, and its script is sound', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const code = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new (require('vm').Script)(code), 'the page script parses');
  assert.match(code, /Connect an assistant/);
  assert.match(code, /S\.connected/);
  assert.match(code, /if \(S\.connect\.mcp\)/, 'the terminal line only when there is one');
  assert.match(code, /navigator\.clipboard\.writeText/);
});

test('the button that ends a hold does not suggest the board sends anything', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /Send now/);
  assert.match(html, /B\('Skip the wait'/);
  for (const f of ['README.md', 'docs/API.md', 'lib/store.js']) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /Send now|Release now/, f);
});

test('"connected" turns on with any call through the connector: opening the board, or asking for decisions', async () => {
  for (const first of [['open_board'], ['get_decisions']]) {
    const dir = tmp(), a = await start({ port: 0, dir }), browser = path.join(tmp(), 'browser.sh');
    fs.writeFileSync(browser, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port, BROWSER: browser });
    try {
      await m.hello();
      await m.call(first[0]);
      assert.equal((await state(a)).connected, true, first[0]);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).seen.mcp > 0, true, 'and it is saved');
    } finally { m.close(); a.close(); }
  }
  // A plain request that names no connector is not one.
  const a = await start({ port: 0, dir: tmp() });
  try { await fetch(a.url + '/api/health'); await post(a, '/api/decisions', { agent: 'cron' }); assert.equal((await state(a)).connected, false); } finally { a.close(); }
});

test('the terminal line is never offered from a plugin or Desktop extension folder, which updates replace', async () => {
  for (const where of [['.claude', 'plugins', 'cache', 'zcollinsky', 'switchboard', '0.2.0'], ['Library', 'Application Support', 'Claude', 'Claude Extensions', 'local.mcpb.zach.switchboard']]) {
    const copy = path.join(tmp(), ...where);
    for (const f of ['server.js', 'lib', 'public']) fs.cpSync(path.join(root, f), path.join(copy, f), { recursive: true });
    const a = await require(path.join(copy, 'server.js')).start({ port: 0, dir: tmp() });
    try {
      const c = (await state(a)).connect;
      assert.equal(c.mcp, null, where.join('/'));
      assert.equal(c.plugin.length, 2); assert.match(c.desktop, /^https:/);
    } finally { a.close(); }
  }
});
