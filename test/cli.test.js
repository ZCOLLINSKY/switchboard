'use strict';
// The command line's printed hints point at the board that is really in use: the key link after loading examples, and a
// --port on every start, stop or link hint whenever the port is not 4747, whatever set it. A simulation follows
// SWITCHBOARD_PORT and keeps its data next to SWITCHBOARD_HOME.
const { childEnv, freePort } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { start } = require('../server');
const cli = path.join(__dirname, '..', 'cli.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbcli-'));

// Runs a command to its end, without blocking this process (a board in this process must keep answering).
const run = (args, env) => new Promise((ok) => {
  const c = spawn(process.execPath, [cli].concat(args), { env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; }); c.on('close', (code) => ok({ code, out }));
});
// Starts a long-running command and waits for its first words.
const launch = (args, env) => new Promise((ok, fail) => {
  const c = spawn(process.execPath, [cli].concat(args), { env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; const t = setTimeout(() => { c.kill('SIGKILL'); fail(new Error('no output: ' + out)); }, 10000);
  c.stdout.on('data', (d) => { out += d; if (/\n.*\n/.test(out)) { clearTimeout(t); setTimeout(() => ok({ c, out }), 100); } });
  c.stderr.on('data', (d) => { out += d; }); c.on('exit', () => { clearTimeout(t); fail(new Error('it stopped: ' + out)); });
});
const stop = (c) => new Promise((ok) => { if (c.exitCode != null) return ok(); c.removeAllListeners('exit'); c.once('exit', ok); c.kill('SIGTERM'); });

// What a command prints into a pipe is what an assistant's shell reads, or what lands in a log file: the key link is the
// person's, so it is printed only to a terminal. These tests run every command into a pipe.
test('link, demo and start never print the key link into a pipe, and say how to open the board instead', async () => {
  const dir = tmp(), a = await start({ port: 0, dir }), port = new URL(a.url).port, env = { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port };
  try {
    const link = await run(['link'], env);
    assert.equal(link.code, 0, 'running: the check in SETUP.md still works by its exit code');
    assert.ok(!link.out.includes(a.key), link.out);
    assert.match(link.out, new RegExp(`running at ${a.url.replace(/[.]/g, '\\.')}`), link.out);
    assert.match(link.out, new RegExp(`cli\\.js" link --open --port ${port}`), link.out);
    const demo = await run(['demo'], env);
    assert.equal(demo.code, 0, demo.out);
    assert.match(demo.out, /Examples added/);
    assert.ok(!demo.out.includes(a.key), demo.out);
    assert.match(demo.out, /link --open/, 'the way to open the examples, not a view-only address');
    const again = await run(['start'], { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: await freePort() });
    assert.match(again.out, /already running/);
    assert.ok(!again.out.includes(a.key), again.out);
  } finally { a.close(); }
  const dir2 = tmp(), port2 = await freePort(), s = await launch(['start'], { SWITCHBOARD_HOME: dir2, SWITCHBOARD_PORT: port2 });
  try {
    const key = fs.readFileSync(path.join(dir2, 'page.key'), 'utf8').trim();
    assert.ok(!s.out.includes(key), s.out);
    assert.match(s.out, /link --open/);
  } finally { await stop(s.c); }
});

test('link --open hands the key link to the browser and prints no key', async () => {
  const dir = tmp(), a = await start({ port: 0, dir }), seen = path.join(tmp(), 'opened.txt'), browser = path.join(tmp(), 'browser.sh');
  fs.writeFileSync(browser, `#!/bin/sh\nprintf '%s' "$1" > "${seen}"\n`, { mode: 0o755 });
  try {
    const r = await run(['link', '--open'], { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port, BROWSER: browser });
    assert.equal(r.code, 0, r.out);
    assert.ok(!r.out.includes(a.key), r.out);
    for (let i = 0; i < 50 && !fs.existsSync(seen); i++) await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(fs.readFileSync(seen, 'utf8'), a.link);
  } finally { a.close(); }
});

test('"not running" hints name the port that was looked at, and the data folder', async () => {
  const port = await freePort();
  for (const cmd of [['list'], ['stop'], ['link'], ['demo']]) {
    const r = await run(cmd, { SWITCHBOARD_PORT: port });
    assert.match(r.out, new RegExp(`cli\\.js" start --port ${port}\\b`), cmd + ': ' + r.out);
  }
  const home = tmp(), r = await run(['list'], { SWITCHBOARD_PORT: port, SWITCHBOARD_HOME: home });
  assert.ok(r.out.includes(process.platform === 'win32' ? `set "SWITCHBOARD_HOME=${home}" && ` : `SWITCHBOARD_HOME="${home}" `), r.out);
  assert.match((await run(['list', '--port', String(port)], {})).out, new RegExp(`start --port ${port}\\b`), 'a typed --port too');
});

test('start says how to stop it on its own port; a second start says where the first one is', async () => {
  const dir = tmp(), port = await freePort();
  const s = await launch(['start'], { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port });
  try {
    assert.match(s.out, new RegExp(`stop --port ${port}\\b`), s.out);
    const again = await run(['start'], { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: await freePort() });
    assert.match(again.out, /already running/);
    assert.match(again.out, new RegExp(`stop --port ${port}\\b`), again.out);
  } finally { await stop(s.c); }
});

test('sim follows SWITCHBOARD_PORT and keeps its data next to SWITCHBOARD_HOME', async () => {
  const base = tmp(), home = path.join(base, 'data'), port = await freePort();
  const s = await launch(['sim', '--no-live'], { SWITCHBOARD_HOME: home, SWITCHBOARD_PORT: port });
  try {
    assert.match(s.out, new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?key=[a-f0-9]{32}`), s.out);
    const simDir = path.join(base, 'data-sim', String(port));
    assert.ok(fs.existsSync(path.join(simDir, 'page.key')), 'its data is next to the named data folder');
    assert.ok(!fs.existsSync(path.join(os.homedir(), '.local', 'share', 'switchboard-sim')), 'not in the home folder');
    const link = await run(['link', '--sim'], { SWITCHBOARD_HOME: home, SWITCHBOARD_PORT: port });
    assert.equal(link.out.trim(), s.out.match(/http:\S+/)[0]);
  } finally { await stop(s.c); }
});

// A phone or a second computer reaches the board through a private network at another address. `link --copy --at` puts
// that address's key link on the clipboard (Universal Clipboard carries it to an iPhone), and prints no key, so it is
// safe from an assistant's shell too.
test('link --copy --at puts the other device\'s key link on the clipboard and prints no key', async () => {
  const dir = tmp(), bin = tmp(), clip = path.join(bin, 'clip.txt');
  for (const name of ['pbcopy', 'wl-copy', 'xclip', 'clip']) { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\ncat > "${clip}"\n`); fs.chmodSync(path.join(bin, name), 0o755); }
  const a = await start({ port: 0, dir });
  try {
    const port = new URL(a.url).port, key = fs.readFileSync(path.join(dir, 'page.key'), 'utf8').trim();
    const env = { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port, PATH: `${bin}:${process.env.PATH}` };
    const r = await run(['link', '--copy', '--at', 'https://box.tailnet.ts.net:8443'], env);
    assert.equal(r.code, 0, r.out);
    assert.equal(fs.readFileSync(clip, 'utf8'), `https://box.tailnet.ts.net:8443/?key=${key}`);
    assert.ok(!r.out.includes(key), 'the key is never printed');
    assert.match(r.out, /clipboard/);
    const plain = await run(['link', '--copy'], env);
    assert.equal(fs.readFileSync(clip, 'utf8'), `${a.url}/?key=${key}`, 'without --at it is this computer\'s link');
    assert.ok(!plain.out.includes(key));
    const bad = await run(['link', '--copy', '--at', 'box.tailnet.ts.net'], env);
    assert.notEqual(bad.code, 0); assert.match(bad.out, /https:\/\//);
  } finally { a.close(); }
});

test('raise from the command line still makes a message to a customer: it is owned by "command-line"', async () => {
  const dir = tmp(), a = await start({ port: 0, dir }), port = new URL(a.url).port;
  try {
    const r = await run(['raise', '--area', 'Shop', '--title', 'Reply to Dale', '--draft', 'Hi Dale', '--to', 'Dale', '--outbound'], { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port });
    assert.equal(r.code, 0, r.out); assert.match(r.out, /Light \w+ is on: Reply to Dale/);
    const l = a.store.db.lights.find((x) => x.title === 'Reply to Dale');
    assert.deepEqual([l.outbound, l.agent], [true, 'command-line']);
  } finally { a.close(); }
});

test('rotate-key writes a new private page key; after a restart every old link can only look', async () => {
  const dir = tmp();
  // Not running: the key is replaced, and the board uses it when it starts.
  fs.writeFileSync(path.join(dir, 'page.key'), 'a'.repeat(32) + '\n', { mode: 0o644 });
  const off = await run(['rotate-key'], { SWITCHBOARD_HOME: dir });
  assert.equal(off.code, 0, off.out);
  const k1 = fs.readFileSync(path.join(dir, 'page.key'), 'utf8').trim();
  assert.match(k1, /^[a-f0-9]{32}$/); assert.notEqual(k1, 'a'.repeat(32));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'page.key')).mode & 0o777, 0o600);
  assert.match(off.out, /The board is not running; it uses the new key when it starts/); assert.match(off.out, /link/);
  assert.doesNotMatch(off.out, new RegExp(k1), 'the key itself is never printed into a pipe');
  // Running: it says to restart, and how to get the new link. The running board keeps its old key until then.
  const a = await start({ port: 0, dir }), port = new URL(a.url).port, old = fs.readFileSync(path.join(dir, 'page.key'), 'utf8').trim();
  const on = await run(['rotate-key'], { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port });
  assert.equal(on.code, 0, on.out);
  const k2 = fs.readFileSync(path.join(dir, 'page.key'), 'utf8').trim();
  assert.notEqual(k2, old); assert.doesNotMatch(on.out, new RegExp(k2));
  assert.match(on.out, /still uses the old key until it restarts\. Restart it now: .*stop --port \d+, then .*start --port \d+/);
  assert.match(on.out, /links opened before can only look/);
  // A login item for the usual board (its own folder, port 4747) is not this practice board: nothing is stopped, and
  // it is told to restart the board whose key changed.
  if (process.platform === 'darwin') {
    const fake = tmp(); fs.mkdirSync(path.join(fake, 'Library', 'LaunchAgents'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'Library', 'LaunchAgents', 'com.switchboard.plist'), '<plist><dict><key>Label</key><string>com.switchboard</string><key>ProgramArguments</key><array><string>/usr/local/bin/node</string><string>/x/cli.js</string><string>start</string></array></dict></plist>');
    const other = await run(['rotate-key'], { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port, HOME: fake });
    assert.equal(other.code, 0, other.out);
    assert.match(other.out, /still uses the old key until it restarts\. Restart it now/); assert.doesNotMatch(other.out, /login item|launchctl/);
    assert.ok(await (await fetch(a.url + '/api/health')).json(), 'the practice board was not stopped');
  }
  a.close();
  const b = await start({ port: 0, dir });
  try {
    const l = b.store.raise({ area: 'Shop', title: 'Go?', kind: 'decide', options: ['Yes', 'No'] });
    const act = (key) => fetch(`${b.url}/api/lights/${l.id}/act`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-switchboard-key': key }, body: JSON.stringify({ action: 'answer', value: 'Yes' }) });
    assert.equal((await act(old)).status, 403, 'the old link can no longer act');
    assert.equal((await act(fs.readFileSync(path.join(dir, 'page.key'), 'utf8').trim())).status, 200, 'the new one can');
  } finally { b.close(); }
});
