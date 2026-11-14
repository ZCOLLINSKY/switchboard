'use strict';
// The connector and the board it talks to: it never falls back to another board or another program without saying so,
// the key goes only to the board that holds this connector's own data folder, a browser that did not open is reported,
// and a board it runs in its own process leaves no lock behind.
const { childEnv, freePort, HOME } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const { start } = require('../server');
const root = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbcn-'));
const fixture = (f) => path.join(__dirname, 'fixtures', f);
const guarded = (env) => { const log = path.join(tmp(), 'guard.log'); return { log, env: Object.assign({ NODE_OPTIONS: `--require "${fixture('guard-usual-port.js')}"`, GUARD_LOG: log }, env) }; };
const guardSaw = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');

function mcp(env, pre = []) {
  const c = spawn(process.execPath, pre.concat([path.join(root, 'mcp.js')]), { env: childEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', id = 0, err = ''; const waiting = new Map(), lines = [];
  c.stderr.on('data', (d) => { err += d; });
  c.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); lines.push(line); const m = JSON.parse(line); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const req = (method, params) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const call = async (name, args) => { const r = (await req('tools/call', { name, arguments: args || {} })).result; return { error: !!r.isError, text: r.content[0].text }; };
  return { c, req, call, lines, stderr: () => err, hello: () => req('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 't' } }), close: () => c.kill(), ended: () => new Promise((ok) => { if (c.exitCode != null) return ok(); c.on('close', ok); c.stdin.end(); }) };
}
// A plain HTTP server that is not Switchboard. It writes down every request it gets.
function other(answer) {
  const seen = [];
  const s = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { seen.push({ method: req.method, url: req.url, body: b }); answer(req, res); }); });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok({ seen, port: s.address().port, url: `http://127.0.0.1:${s.address().port}`, close: () => { s.closeAllConnections(); s.close(); } })));
}
const notFound = (req, res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); };
const browserThat = (exit) => { const f = path.join(tmp(), 'browser.sh'), seen = f + '.seen'; fs.writeFileSync(f, `#!/bin/sh\nprintf '%s' "$1" > "${seen}"\nexit ${exit}\n`, { mode: 0o755 }); return { f, seen }; };

test('a SWITCHBOARD_PORT that is not a port number is an error, never the usual board', async () => {
  const g = guarded({ SWITCHBOARD_HOME: tmp(), SWITCHBOARD_PORT: '5937x' }), m = mcp(g.env);
  try {
    await m.hello();
    for (const tool of ['list_lights', 'raise_light']) {
      const r = await m.call(tool, { area: 'Shop', title: 'Order boxes', kind: 'todo' });
      assert.ok(r.error, r.text); assert.match(r.text, /SWITCHBOARD_PORT "5937x" is not a port number/);
    }
    assert.equal(guardSaw(g.log), '', 'nothing went to port 4747');
  } finally { m.close(); }
});

test('a port written as a whole number with a decimal point is that port', async () => {
  const dir = tmp(), a = await start({ port: 0, dir }), port = new URL(a.url).port;
  const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: `${port}.0` });
  try {
    await m.hello();
    const r = await m.call('list_lights');
    assert.ok(!r.error, r.text); assert.equal(JSON.parse(r.text).board, a.url);
  } finally { m.close(); a.close(); }
});

test('another program on the board\'s port is named as such, not as "HTTP 404"', async () => {
  const o = await other(notFound);
  try {
    for (const pre of [[], ['-r', fixture('refuse-self-spawn.js')]]) {
      const m = mcp({ SWITCHBOARD_HOME: tmp(), SWITCHBOARD_PORT: o.port }, pre);
      try {
        await m.hello();
        for (const tool of ['list_lights', 'open_board']) {
          const r = await m.call(tool);
          assert.ok(r.error, r.text);
          assert.match(r.text, new RegExp(`Another program \\(not Switchboard\\) answers at ${o.url}\\. Pick another port`), `${pre.length ? 'in-process' : 'plain'} ${tool}: ${r.text}`);
        }
      } finally { m.close(); }
    }
    assert.ok(!o.seen.some((r) => r.method === 'POST'), 'nothing was sent to it');
  } finally { o.close(); }
});

test('when Node cannot be started for another reason (an upgrade removed it), the board is not run inside the session', async () => {
  const dir = tmp(), port = await freePort();
  const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port }, ['-r', fixture('node-gone.js')]);
  try {
    await m.hello();
    const r = await m.call('list_lights');
    assert.ok(r.error, r.text);
    assert.match(r.text, /Switchboard could not start: ENOENT/);
    assert.match(r.text, /restart this session/i);
    assert.ok(!fs.existsSync(path.join(dir, 'server.lock')), 'no board runs inside the connector');
  } finally { m.close(); }
});

test('a board run inside the connector removes its lock when the connector is stopped', { skip: process.platform === 'win32' && 'no SIGTERM on Windows' }, async () => {
  const dir = tmp(), port = await freePort();
  const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port }, ['-r', fixture('refuse-self-spawn.js')]);
  await m.hello();
  const r = await m.call('list_lights');
  assert.ok(!r.error, r.text);
  assert.ok(fs.existsSync(path.join(dir, 'server.lock')));
  await new Promise((ok) => { m.c.on('close', ok); m.c.kill('SIGTERM'); });
  assert.ok(!fs.existsSync(path.join(dir, 'server.lock')), 'the lock went with it');
});

test('a lock left behind is believed only when the board at its address proves it holds that lock', async () => {
  const dir = tmp(), port = await freePort(), o = await other(notFound);
  fs.writeFileSync(path.join(dir, 'server.lock'), JSON.stringify({ pid: 999999, id: 'aaaaaaaaaaaa', url: o.url, live: true, host: os.hostname(), at: Date.now() - 60e3 }));
  const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port });
  try {
    await m.hello();
    const r = await m.call('raise_light', { area: 'Shop', title: 'Reply to Dale', draft: 'SECRET-DRAFT-123', kind: 'approve' });
    assert.ok(!r.error, r.text);
    assert.ok(!o.seen.some((x) => x.body.includes('SECRET-DRAFT-123')), 'the draft never went to what now listens at the old address');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'server.lock'), 'utf8')).url, `http://127.0.0.1:${port}`, 'its own board was started instead');
  } finally { await m.ended(); o.close(); spawn(process.execPath, [path.join(root, 'cli.js'), 'stop'], { env: childEnv({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port }), stdio: 'ignore' }); }
  for (let i = 0; i < 40 && fs.existsSync(path.join(dir, 'server.lock')); i++) await new Promise((ok) => setTimeout(ok, 100));
});

test('open_board takes the key only from its own data folder, for the board that holds that folder\'s lock', async () => {
  // The real board keeps its data where the connector looks by default. A program on another port says it is that board.
  const dir = path.join(HOME, '.local', 'share', 'switchboard'), a = await start({ port: 0, dir });
  const fake = await other((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, name: 'switchboard', lock: 'bbbbbbbbbbbb', data: path.join(dir, 'data.json') })); });
  const b = browserThat(0), m = mcp({ SWITCHBOARD_PORT: fake.port, BROWSER: b.f });
  try {
    await m.hello();
    const r = await m.call('open_board');
    assert.ok(r.error, r.text);
    assert.ok(!r.text.includes(a.key), 'the key is not in what the assistant reads');
    await new Promise((ok) => setTimeout(ok, 300));
    assert.ok(!fs.existsSync(b.seen), 'no browser was opened');
    assert.ok(!fake.seen.some((x) => x.url.includes(a.key)), 'the fake board never got the key');
  } finally { m.close(); fake.close(); a.close(); }
});

test('open_board says so when the browser did not open, and offers a way that needs no terminal', async () => {
  const dir = tmp(), a = await start({ port: 0, dir }), b = browserThat(1);
  const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port, BROWSER: b.f });
  try {
    await m.hello();
    const r = await m.call('open_board');
    assert.ok(r.error, 'a browser that exits with an error did not open: ' + r.text);
    assert.ok(!r.text.includes(a.key) && !/[a-f0-9]{32}/.test(r.text), 'the key is not in what the assistant reads');
    const file = path.join(dir, 'open-switchboard.html');
    assert.ok(r.text.includes(file), r.text);
    assert.ok(fs.readFileSync(file, 'utf8').includes(a.link), 'the file opens the key link');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'only the person can read it');
  } finally { m.close(); a.close(); }
});
