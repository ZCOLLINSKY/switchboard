'use strict';
// Batch 6: the medium and low findings left open by the first adversarial run (docs/ADVERSARIAL-2026-11-13.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open, rev, DAY, FLAG } = require('../lib/store');
const { start } = require('../server');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb6-'));
const T0 = new Date(2026, 10, 16, 10, 0, 0).getTime();
const fix = (s, extra) => s.raise(Object.assign({ area: 'Site', title: 'Fix typo', change_from: 'teh', change_to: 'the', action_type: 'typo', agent: 'bot' }, extra), T0);
function trusted(s) { // ten single approvals on three days, then promoted
  s.setting('autonomy', true);
  for (let i = 0; i < 10; i++) { const t = T0 + (i % 3) * DAY + i * 1000, l = s.raise({ area: 'Site', title: 'Fix typo ' + i, change_from: 'a' + i, change_to: 'b' + i, action_type: 'typo', agent: 'bot' }, t); s.act(l.id, 'approve', { rev: rev(l) }, t); }
  s.promote('site|typo', true, T0 + 3 * DAY);
}

test('A7 the fingerprint is the whole hash, not a short one that two texts can share', () => {
  const s = open(tmp()); const l = fix(s);
  assert.ok(rev(l).length >= 40);
  assert.equal(s.view(T0).lights[0].rev, rev(l));
});

test('S2 taking back a snooze does not roll back a newer draft', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Reply', draft: 'first', agent: 'bot' }, T0);
  s.act(l.id, 'snooze', { days: 1 }, T0);
  s.update(l.id, { draft: 'second, better' }, 'bot', T0 + 1000);
  s.act(l.id, 'undo', {}, T0 + 2000);
  assert.equal(l.draft, 'second, better');
  assert.equal(l.snoozeUntil, null);
  assert.equal(l.snoozes, 0);
});

test('S2 a slip on a spot check can be taken back, and "Flag it" then still switches the rule off', () => {
  const s = open(tmp(), { random: () => 0.99 }); trusted(s);
  const t = T0 + 4 * DAY, l = fix(s, { title: 'Auto one' }); // first runs all come back for a look
  assert.equal(l.spot, true);
  s.act(l.id, 'answer', { value: 'Looks right' }, t);
  s.act(l.id, 'undo', {}, t + 1000);
  assert.equal(l.spot, true, 'the look is open again');
  assert.deepEqual(l.options, ['Looks right', FLAG]);
  s.act(l.id, 'answer', { value: FLAG }, t + 2000);
  assert.equal(s.db.auto['site|typo'], undefined, 'the rule is off');
  // and a flag by mistake can itself be taken back, rule and all
  s.act(l.id, 'undo', {}, t + 3000);
  assert.ok(s.db.auto['site|typo'], 'the rule is back');
});

test('S2 "Take it back" then undo: the approval is in the record again', () => {
  const s = open(tmp(), { collectMs: 1000 });
  const l = s.raise({ area: 'Shop', title: 'Text Sam', draft: 'Hello Sam', outbound: true, agent: 'bot' }, T0);
  s.act(l.id, 'approve', { rev: rev(l) }, T0);
  s.tick(T0 + 120000); assert.equal(l.stuck, true);
  s.act(l.id, 'answer', { value: 'Take it back' }, T0 + 121000);
  assert.equal(s.history('sam').length, 0);
  s.act(l.id, 'undo', {}, T0 + 122000);
  assert.ok(l.decision, 'the approval stands again');
  assert.equal(s.history('sam').length, 1, 'and history shows it');
});

test('A4 a failure found out later wins over "sent"; a repeat says it changed nothing', () => {
  const s = open(tmp(), { holdMs: 0 });
  const l = s.raise({ area: 'Shop', title: 'Text Sam', draft: 'Hello', outbound: true, agent: 'bot' }, T0);
  s.act(l.id, 'approve', { rev: rev(l) }, T0);
  const d = s.decisions(T0 + 1, { agent: 'bot' }).decisions[0];
  assert.throws(() => s.complete(l.id, 'done', '', T0 + 2, d.decision_id), /message to a person/);
  s.complete(l.id, 'sent', '', T0 + 2, d.decision_id);
  assert.equal(l.sent.length, 1);
  s.complete(l.id, 'sent', '', T0 + 3, d.decision_id);
  assert.deepEqual(s.warnings, []);
  s.complete(l.id, 'failed', 'bounced', T0 + 4, d.decision_id);
  assert.equal(l.state, 'broken');
  assert.equal(l.sent.length, 0, 'it did not go: not listed as sent');
  assert.match(s.view(T0 + 5).lights[0].alert, /bounced/);
});
test('A4 ack does not wave a message through; "approved" cannot be set by an update', () => {
  const s = open(tmp(), { holdMs: 0 });
  const l = s.raise({ area: 'Shop', title: 'Text Sam', draft: 'Hello', outbound: true, agent: 'bot' }, T0);
  assert.throws(() => s.update(l.id, { state: 'approved' }, 'bot', T0), /Only the person can approve/);
  s.act(l.id, 'approve', { rev: rev(l) }, T0); s.decisions(T0 + 1, { agent: 'bot' });
  assert.equal(s.ack([l.id], T0 + 2), 0);
  assert.match(s.warnings[0], /not acknowledged/);
  assert.equal(l.state, 'approved');
});

test('A5 a light that ran by itself is frozen until it is reported, and the look cannot be closed by an assistant', () => {
  const s = open(tmp(), { random: () => 0.99 }); trusted(s);
  const t = T0 + 4 * DAY, l = fix(s, { title: 'Auto one' });
  for (const patch of [{ title: 'Other' }, { draft: 'Dear customer' }, { to: 'sam@example.com' }, { options: ['Looks right'] }, { area: 'Elsewhere' }, { state: 'done' }, { change_to: 'x' }])
    assert.throws(() => s.update(l.id, patch, 'bot', t), /ran by itself/, JSON.stringify(patch));
  s.update(l.id, { progress: 50 }, 'bot', t); // notes about the work are fine
  // the flag turns off the rule that ran, even if the light has since been filed elsewhere by the person
  s.act(l.id, 'move', { area: 'Elsewhere' }, t + 1);
  s.act(l.id, 'answer', { value: FLAG }, t + 2);
  assert.equal(s.db.auto['site|typo'], undefined);
});

test('A6 a light with someone to send to is a message, whether or not the assistant said outbound', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Email Sam', draft: 'Hi Sam, the quote is attached.', to: 'sam@example.com', agent: 'bot' }, T0);
  assert.equal(l.outbound, true);
  assert.ok(s.warnings.some((w) => /message to a person/.test(w)));
  s.act(l.id, 'approve', { rev: rev(l) }, T0);
  assert.equal(s.decisions(T0 + 30000, { agent: 'bot' }).decisions.length, 0, 'held for the full minute like any message');
  const b = s.raise({ area: 'Shop', title: 'Email Ann', draft: 'Hi', to: 'ann@example.com', agent: 'bot' }, T0);
  assert.throws(() => s.bulk([b.id], 'approve', { revs: { [b.id]: rev(b) } }, T0), /one at a time/);
});

test('N5 a snooze date that cannot be honoured is refused, not quietly replaced', () => {
  const s = open(tmp()); const l = fix(s);
  assert.throws(() => s.act(l.id, 'snooze', { until: T0 + 500 * DAY }, T0), /within the next year/);
  assert.throws(() => s.act(l.id, 'snooze', { until: T0 - DAY }, T0), /not passed/);
  assert.throws(() => s.act(l.id, 'snooze', { until: 'soon' }, T0), /not a date/);
  assert.throws(() => s.act(l.id, 'snooze', { days: 400 }, T0), /1 to 60/);
  assert.equal(l.snoozes, 0);
  s.act(l.id, 'snooze', { until: T0 + 120 * DAY }, T0);
  assert.equal(l.snoozeUntil, T0 + 120 * DAY);
});

test('N6 changing follow_up_days on a waiting light moves its timer; 0 stops it', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Quote sent', state: 'waiting_them', follow_up_days: 3, agent: 'bot' }, T0);
  s.update(l.id, { follow_up_days: 10 }, 'bot', T0 + DAY);
  assert.equal(l.followUpAt, T0 + 10 * DAY);
  s.update(l.id, { follow_up_days: 0 }, 'bot', T0 + DAY);
  assert.equal(l.followUpAt, null);
  assert.equal(s.tick(T0 + 30 * DAY), false);
});

test('S7 a refused call changes nothing (bulk stops half way, oversized payload)', async () => {
  const a = await start({ port: 0, dir: tmp() });
  const post = (p, body, key) => fetch(a.url + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, key ? { 'x-switchboard-key': a.key } : {}), body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const one = (await post('/api/lights', { area: 'A', title: 'one', change_from: 'a', change_to: 'b', agent: 'bot' })).body;
    const two = (await post('/api/lights', { area: 'A', title: 'two', kind: 'decide', options: ['x', 'y'], agent: 'bot' })).body; // cannot be approved
    const st = async () => (await (await fetch(a.url + '/api/state')).json());
    const revs = {}; (await st()).lights.forEach((l) => { revs[l.id] = l.rev; });
    const r = await post('/api/bulk', { ids: [one.id, two.id], action: 'approve', revs }, true);
    assert.equal(r.status, 400);
    assert.equal((await st()).lights.find((l) => l.id === one.id).state, 'need_you', 'the first light was not left approved');
    const big = await post(`/api/lights/${one.id}`, { draft: 'swapped', payload: { x: 'y'.repeat(5000) } });
    assert.equal(big.status, 400);
    assert.equal((await st()).lights.find((l) => l.id === one.id).draft, '');
    const bad = await post('/api/lights', { area: 'Brand new container', title: 't', payload: { x: 'y'.repeat(5000) } });
    assert.equal(bad.status, 400);
    assert.ok(!(await st()).areas.some((x) => x.name === 'Brand new container'));
  } finally { a.close(); }
});

test('A4 nobody can sign as the person: "by" from a caller is ignored', async () => {
  const a = await start({ port: 0, dir: tmp() });
  const post = (p, body) => fetch(a.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const l = await post('/api/lights', { area: 'A', title: 'mine?', by: 'you', agent: 'bot' });
    assert.equal(a.store.db.lights[0].own, false);
    await post(`/api/lights/${l.id}`, { state: 'done', by: 'you', agent: 'bot' });
    assert.equal(a.store.db.lights[0].history.pop().by, 'bot');
  } finally { a.close(); }
});

test('X7 a lock left by a dead or unrelated process is taken over; a live board still refuses a second writer', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'server.lock'), JSON.stringify({ pid: process.pid, id: 'stale', url: 'http://127.0.0.1:9', live: true, host: os.hostname() }));
  const a = await start({ port: 0, dir }); // this pid is alive, but nothing answers at that address: stale
  try {
    await assert.rejects(start({ port: 0, dir }), /already running/);
    assert.equal((await (await fetch(a.url + '/api/health')).json()).lock, JSON.parse(fs.readFileSync(path.join(dir, 'server.lock'), 'utf8')).id);
  } finally { a.close(); }
  assert.equal(fs.existsSync(path.join(dir, 'server.lock')), false);
});
test('X7 a real stop (SIGTERM) removes the lock', async () => {
  const dir = tmp(), { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'switchboard.js'), 'start', '--port', '0'], { env: Object.assign({}, process.env, { SWITCHBOARD_HOME: dir }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok) => child.stdout.once('data', ok));
  assert.equal(fs.existsSync(path.join(dir, 'server.lock')), true);
  child.kill('SIGTERM'); await new Promise((ok) => child.once('exit', ok));
  assert.equal(fs.existsSync(path.join(dir, 'server.lock')), false);
});

test('N8 one meaning for "need you": rows, in the counts and the queue', () => {
  const s = open(tmp());
  s.raise({ area: 'Site', title: 'Forty changes', change_from: 'a', change_to: 'b', batch: 40, agent: 'bot' }, T0);
  s.raise({ area: 'Site', title: 'One more', kind: 'decide', options: ['a', 'b'], agent: 'bot' }, T0);
  const v = s.view(T0);
  assert.equal(v.counts.need_you, 2);
  assert.equal(v.queue.length, 2);
});

test('A8 what the tools say is what the server does: cut text warns, unknown update fields warn, waiting is for the raiser, dump is the person\'s', async () => {
  const s = open(tmp(), { holdMs: 0 });
  assert.throws(() => s.raise({ area: 'A', title: 'M', draft: 'x'.repeat(4100), agent: 'bot' }, T0), /Nothing is cut from a message/);
  const l = s.raise({ area: 'A', title: 'T'.repeat(250), options: ['1', '2', '3', '4', '5', '6', '7'], kind: 'decide', agent: 'bot' }, T0);
  assert.ok(s.warnings.some((w) => /title is longer than 200/.test(w)));
  assert.ok(s.warnings.some((w) => /first 6 options/.test(w)));
  s.update(l.id, { colour: 'red' }, 'bot', T0);
  assert.ok(s.warnings.some((w) => /unknown field "colour"/.test(w)));
  s.act(l.id, 'answer', { value: '1' }, T0);
  assert.equal(s.decisionFor(l.id, T0 + 1, { agent: 'someone-else' }), null);
  assert.ok(s.decisionFor(l.id, T0 + 1, { agent: 'bot' }));
  const a = await start({ port: 0, dir: tmp() });
  const post = (p, body) => fetch(a.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  try {
    assert.equal(await post('/api/dump', { text: 'call the bank' }), 403);
    assert.equal(await post('/api/demo', {}), 403);
    assert.equal(await post('/api/demo', { clear: true }), 200);
  } finally { a.close(); }
});

test('A5 a rule belongs to the assistant that earned it: another assistant using the same label still asks', () => {
  const s = open(tmp(), { random: () => 0.99 }); trusted(s);
  const t = T0 + 4 * DAY;
  const other = s.raise({ area: 'Site', title: 'Fix typo', change_from: 'x', change_to: 'y', action_type: 'typo', agent: 'stranger' }, t);
  assert.equal(other.decision, null, 'not approved automatically');
  assert.equal(other.state, 'need_you');
  const own = fix(s, { title: 'Own one' });
  assert.ok(own.decision && own.decision.by === 'auto');
});
