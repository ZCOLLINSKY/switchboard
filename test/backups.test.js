'use strict';
// The board keeps a copy of its data file once a day in backups/, the last 14 days, so a damaged or mistaken data file
// can be put back. A copy is made the first time the board saves on a new day, and never written over that day.
const { childEnv, freePort } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { open, listBackups, restore, checkBoard } = require('../lib/store');
const { start } = require('../server');
const ROOT = path.join(__dirname, '..');

const day = (d) => `data-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;

test('a daily copy of the data file, the last 14 days, private to this user', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbb-')), b = path.join(dir, 'backups');
  fs.mkdirSync(b, { mode: 0o700 });
  for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(b, `data-2025-01-${String(i).padStart(2, '0')}.json`), '{}');
  fs.writeFileSync(path.join(b, 'notes.txt'), 'not a backup: left alone');
  const s = open(dir, {});
  s.raise({ area: 'Shop', title: 'First', kind: 'todo' }); s.save();
  const today = path.join(b, day(new Date()));
  assert.ok(fs.existsSync(today), 'today has a copy');
  assert.equal(JSON.parse(fs.readFileSync(today, 'utf8')).lights.length, 1);
  assert.equal(fs.statSync(today).mode & 0o777, 0o600);
  s.raise({ area: 'Shop', title: 'Second', kind: 'todo' }); s.save();
  assert.equal(JSON.parse(fs.readFileSync(today, 'utf8')).lights.length, 1, 'the day\'s copy is not written over');
  const kept = fs.readdirSync(b).filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  assert.equal(kept.length, 14, 'the newest 14 days are kept');
  assert.equal(kept[kept.length - 1], day(new Date()));
  assert.ok(fs.existsSync(path.join(b, 'notes.txt')), 'other files in the folder are not touched');
});

// A data folder with a board in data.json and copies in backups/, each with its own time.
const H = new Date(2026, 10, 15, 9, 0, 0).getTime();
const board = (n) => JSON.stringify({ version: 3, areas: [{ id: 'a1', name: 'Acme Lighting' }], lights: Array.from({ length: n }, (_, i) => ({ id: 'l' + i, area: 'a1', title: `Call Pat Lee ${i}`, state: 'need_you', kind: 'todo' })) });
function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbr-')), b = path.join(dir, 'backups');
  fs.mkdirSync(b, { mode: 0o700 });
  for (const [name, text, hoursAgo] of files) {
    const f = name === 'data.json' ? path.join(dir, name) : path.join(b, name);
    fs.writeFileSync(f, text, { mode: 0o600 });
    if (hoursAgo != null) fs.utimesSync(f, (H - hoursAgo * 36e5) / 1000, (H - hoursAgo * 36e5) / 1000);
  }
  return dir;
}
const run = (file, args, env) => new Promise((ok) => {
  const c = spawn(process.execPath, [path.join(ROOT, file)].concat(args), { env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
  const t = setTimeout(() => c.kill('SIGKILL'), 15000); c.on('close', (code) => { clearTimeout(t); ok({ code, out, err }); });
});

test('what can be put back: it parses, has a version number and a list of lights', () => {
  assert.deepEqual(checkBoard(board(2)), { ok: true, lights: 2 });
  for (const [text, why] of [['{"version":3,"lights":[', /does not parse/], ['null', /holds no board/], ['[]', /holds no board/],
    ['{"lights":[]}', /no version number/], ['{"version":3,"lights":{}}', /no list of lights/], ['{"version":3}', /no list of lights/],
    ['{"version":3,"lights":[],"areas":"Acme"}', /areas are not a list/]]) {
    const c = checkBoard(text); assert.equal(c.ok, false, text); assert.match(c.why, why);
  }
});

test('the list of backups: newest first, with when, size and light count; a damaged one is said, never offered as good', () => {
  const dir = folder([['data-2026-11-13.json', board(3), 48], ['data-2026-11-15T083000-before-0.4.0.json', board(5), 0.5], ['data-2026-11-14.json', '{"version":3,"lights":[', 24]]);
  fs.writeFileSync(path.join(dir, 'backups', 'notes.txt'), 'not a backup');
  const l = listBackups(dir);
  assert.deepEqual(l.map((b) => b.name), ['data-2026-11-15T083000-before-0.4.0.json', 'data-2026-11-14.json', 'data-2026-11-13.json']);
  assert.deepEqual(l.map((b) => b.lights), [5, null, 3]);
  assert.deepEqual(l.map((b) => b.ok), [true, false, true]);
  assert.equal(l[0].size, Buffer.byteLength(board(5)));
  assert.equal(l[0].at, H - 0.5 * 36e5);
  assert.match(l[1].why, /does not parse/);
  assert.deepEqual(listBackups(fs.mkdtempSync(path.join(os.tmpdir(), 'sbr-'))), [], 'no backups folder: an empty list');
});

test('restore keeps the data file as it is (damaged or not) in backups/, then puts the backup back; a bad file changes nothing', () => {
  const dir = folder([['data.json', '{"version":3,"lights":[{"id":"x"', null], ['data-2026-11-14.json', board(4), 24], ['data-2026-11-13.json', '{"lights":[]}', 48]]);
  fs.writeFileSync(path.join(dir, 'damaged.seen'), '1:2');
  const before = fs.readFileSync(path.join(dir, 'data.json'), 'utf8');
  // Refused: not a board, missing, or the data file itself. Nothing changes.
  assert.throws(() => restore(dir, 'data-2026-11-13.json'), /cannot be put back: it has no version number\. Nothing was changed/);
  assert.throws(() => restore(dir, 'data-2026-01-01.json'), /There is no file data-2026-01-01\.json/);
  assert.throws(() => restore(dir, path.join(dir, 'data.json')), /cannot be put back|data file itself/);
  assert.equal(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'), before);
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).filter((f) => /before-restore/.test(f)).length, 0, 'no copy made for a refused restore');
  // A bare name is looked for in backups/.
  const r = restore(dir, 'data-2026-11-14.json', H);
  assert.equal(r.lights, 4);
  assert.equal(r.from, path.join(dir, 'backups', 'data-2026-11-14.json'));
  assert.equal(path.basename(r.kept), 'data-2026-11-15T090000-before-restore.json');
  assert.equal(fs.readFileSync(r.kept, 'utf8'), before, 'the damaged file is kept byte for byte');
  assert.equal(fs.statSync(r.kept).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'), board(4));
  assert.equal(fs.statSync(path.join(dir, 'data.json')).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(path.join(dir, 'damaged.seen')), 'the next damaged file is said again');
  assert.equal(open(dir, {}).db.lights.length, 4, 'the board opens what was put back');
  // A second restore the same second keeps both copies.
  const r2 = restore(dir, 'data-2026-11-14.json', H);
  assert.equal(path.basename(r2.kept), 'data-2026-11-15T090000-before-restore-2.json');
});

test('restore from the command line: --list, refused while the board runs (and says how to stop it), then done and says how to start', async () => {
  const dir = folder([['data.json', board(1), null], ['data-2026-11-14.json', board(6), 24], ['data-2026-11-12.json', 'oops', 72]]);
  const port = await freePort(), env = { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port };
  const list = await run('cli.js', ['restore', '--list'], env);
  assert.equal(list.code, 0, list.err);
  const rows = list.out.split('\n').filter((x) => /data-/.test(x) && !/Put one back/.test(x));
  assert.match(rows[0], /6 lights\s+data-2026-11-14\.json$/);
  assert.match(rows[0], /Nov 14, 2026/);
  assert.match(rows[0], /\d+(\.\d)? (B|KB)/);
  assert.match(rows[1], /damaged\s+data-2026-11-12\.json \(cannot be put back: it does not parse/);
  assert.match(list.out, /Put one back \(with the board stopped\): .*cli\.js" restore <name>/);

  const s = await start({ dir, port, host: '127.0.0.1' });
  try {
    const busy = await run('cli.js', ['restore', 'data-2026-11-14.json'], env);
    assert.equal(busy.code, 1);
    assert.match(busy.err, new RegExp(`Switchboard is running at http://127\\.0\\.0\\.1:${port}, so nothing was changed\\. Stop it first: .*cli\\.js" stop --port ${port}\\. Then run this again\\.`));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).lights.length, 1, 'untouched while it runs');
  } finally { s.close(); }
  // A lock whose process is still alive (a board starting up) is refused too.
  fs.writeFileSync(path.join(dir, 'server.lock'), JSON.stringify({ pid: process.pid, id: 'x', url: '', host: os.hostname(), at: Date.now() }));
  const starting = await run('cli.js', ['restore', 'data-2026-11-14.json'], env);
  assert.match(starting.err, /Switchboard is starting or running \(process \d+\), so nothing was changed\..*If nothing is running, delete .*server\.lock/);
  fs.unlinkSync(path.join(dir, 'server.lock'));

  const bad = await run('cli.js', ['restore', 'data-2026-11-12.json'], env);
  assert.equal(bad.code, 1); assert.match(bad.err, /cannot be put back: it does not parse/);
  const ok = await run('cli.js', ['restore', 'data-2026-11-14.json'], env);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /Put back .*data-2026-11-14\.json \(6 lights\)/);
  assert.match(ok.out, /The data file as it was is kept at .*before-restore\.json/);
  assert.match(ok.out, new RegExp(`Start the board: SWITCHBOARD_HOME=".*" node ".*cli\\.js" start --port ${port}`));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).lights.length, 6);
});

test('a damaged data file stops the board with one plain line naming the newest good backup, said once however often it is started', async () => {
  const dir = folder([['data.json', '{"version":3,"lights":[{"id"', null], ['data-2026-11-15T080000.json', '{"version":3', 1], ['data-2026-11-14.json', board(7), 24], ['data-2026-11-13.json', board(2), 48]]);
  const port = await freePort(), env = { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port };
  const first = await run('server.js', [], env);
  assert.equal(first.code, 1);
  const lines = first.err.trim().split('\n');
  assert.equal(lines.length, 1, first.err);
  assert.match(lines[0], /^Switchboard did not start\. Cannot read .*data\.json: .*it was not changed\. .* Newest good backup: .*data-2026-11-14\.json \(.*, 7 lights\)\. Put it back with: SWITCHBOARD_HOME=".*" node ".*cli\.js" restore ".*data-2026-11-14\.json" \(it keeps the damaged file in backups\/ first\)\. See them all: .* restore --list$/);
  assert.doesNotMatch(first.err, /\n\s+at /, 'no stack trace');
  // A login item starts it again and again: the same damaged file is not said again.
  for (let i = 0; i < 2; i++) { const again = await run('server.js', [], env); assert.equal(again.code, 1); assert.equal(again.err, ''); }
  // The command line's start says it too, every time (a person is reading).
  const cliStart = await run('cli.js', ['start'], env);
  assert.equal(cliStart.code, 1); assert.match(cliStart.err, /Newest good backup: .*data-2026-11-14\.json/);
  // Put back, it starts, and a later damaged file is said again.
  const put = await run('cli.js', ['restore', path.join(dir, 'backups', 'data-2026-11-14.json')], env);
  assert.equal(put.code, 0, put.err);
  const s = await start({ dir, port, host: '127.0.0.1' });
  try { assert.equal(s.store.db.lights.length, 7); } finally { s.close(); }
  fs.writeFileSync(path.join(dir, 'data.json'), 'null');
  const later = await run('server.js', [], env);
  assert.match(later.err, /data\.json holds no board \(it says null\)/);
  // No good backup at all: says how to start empty instead.
  const none = folder([['data.json', '{"lights":"x"}', null]]);
  const n = await run('server.js', [], { SWITCHBOARD_HOME: none, SWITCHBOARD_PORT: port });
  assert.match(n.err, /is not a Switchboard board \(no list of lights\)\. It was not changed\. Move it away to start a fresh board\. There is no good backup in .*backups\.$/m);
});
