'use strict';
// Review batch 1: a tap approves exactly what was on screen, once.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, HOLD_MS } = require('../lib/store');
const { start } = require('../server');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-b1-'));
const T0 = Date.UTC(2026, 10, 13, 15), HOLD = require('../lib/store').OUT_HOLD_MS + 1000;
const revOf = (s, id, now) => s.view(now).lights.find((l) => l.id === id).rev;

test('1.1 (P1) a second approve on a handled light is refused and the streak stays at 1', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Reply to Dale', draft: 'Hi Dale', outbound: true, follow_up_days: 3, action_type: 'customer-reply' }, T0);
  s.act(l.id, 'approve', {}, T0);
  assert.throws(() => s.act(l.id, 'approve', {}, T0 + 60000), /already handled/);
  assert.throws(() => s.act(l.id, 'no', {}, T0 + 60000), /already handled/);
  assert.equal(s.decisions(T0 + HOLD, { all: true }).decisions.length, 1, 'one decision, not two');
});

test('1.2 (P2) a message to a person with no text cannot be approved', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Email the HOA manager', outbound: true, follow_up_days: 2 }, T0);
  assert.throws(() => s.act(l.id, 'approve', {}, T0), /no message/i);
  assert.equal(l.state, 'need_you');
});

test('1.3 (P4) an approval is refused when the draft changed after it was shown', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Reply to Dale', draft: 'Six fixtures: $1,450 installed.', outbound: true }, T0);
  const shown = revOf(s, l.id, T0);
  s.update(l.id, { draft: 'Six fixtures: $450 installed.' }, 'agent', T0 + 5000);
  assert.throws(() => s.act(l.id, 'approve', {}, T0 + 6000), /This changed\. Look again\./);
  assert.throws(() => s.act(l.id, 'approve', { rev: shown }, T0 + 6000), /This changed\. Look again\./);
  assert.throws(() => s.bulk([l.id], 'approve', { revs: { [l.id]: shown } }, T0 + 6000), /one at a time|This changed/);
  s.act(l.id, 'approve', { rev: revOf(s, l.id, T0 + 6000) }, T0 + 6000);
  assert.match(s.decisions(T0 + 6000 + HOLD).decisions[0].text, /\$450/);
});

test('1.3 bulk approve needs the rev of every light', () => {
  const s = open(tmp());
  const ls = [1, 2, 3].map((i) => s.raise({ area: 'A', title: 'fix ' + i, change_from: 'a', change_to: 'b', action_type: 'fix' }, T0));
  const revs = {}; ls.forEach((l) => { revs[l.id] = revOf(s, l.id, T0); });
  s.update(ls[2].id, { change_to: 'delete everything' }, 'agent', T0 + 1000);
  assert.throws(() => s.bulk(ls.map((l) => l.id), 'approve', { revs }, T0 + 2000), /This changed/);
  assert.equal(s.view(T0 + 2000).queue.length, 3, 'nothing was approved');
});

test('1.5 the board lists every decision still inside its hold', () => {
  const s = open(tmp());
  const a = s.raise({ area: 'A', title: 'one', draft: 'x' }, T0), b = s.raise({ area: 'A', title: 'two', kind: 'todo' }, T0);
  s.act(a.id, 'approve', {}, T0); s.act(b.id, 'done', {}, T0 + 1000);
  assert.deepEqual(s.view(T0 + 2000).held.map((h) => h.title), ['two', 'one']);
  s.act(a.id, 'undo', {}, T0 + 3000);
  assert.deepEqual(s.view(T0 + 3000).held.map((h) => h.title), ['two']);
  assert.equal(s.view(T0 + HOLD + 1000).held.length, 0);
  assert.equal(HOLD_MS, 20000);
});

test('1.6 (N3) undo right after a quick note removes the note', () => {
  const s = open(tmp());
  const l = s.dump('call the school', T0)[0];
  assert.equal(s.view(T0 + 1000).held.length, 1);
  s.act(l.id, 'undo', {}, T0 + 2000);
  assert.equal(s.view(T0 + 3000).queue.length, 0);
});

test('1.10 data is private to the user', () => {
  const s = open(tmp());
  s.raise({ area: 'A', title: 'x' }, T0); s.save();
  assert.equal(fs.statSync(s.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(s.file).mode & 0o777, 0o600);
});

test('1.10 the page cannot be framed, and a second server on the same data refuses to start', async () => {
  const dir = tmp();
  const a = await start({ port: 0, dir });
  try {
    const res = await fetch(a.url + '/');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await fetch(a.url + '/api/state')).headers.get('x-frame-options'), 'DENY');
    await assert.rejects(start({ port: 0, dir }), new RegExp('already running.*' + a.url.replace(/[/.]/g, '.')));
  } finally { a.close(); }
  const b = await start({ port: 0, dir }); b.close();
});

test('1.3 over HTTP an approve must carry the rev that was shown', async () => {
  const dir = tmp();
  const a = await start({ port: 0, dir });
  const post = (p, body) => fetch(a.url + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-switchboard-key': a.key }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const l = (await post('/api/lights', { area: 'A', title: 'fix', change_from: 'a', change_to: 'b' })).body;
    assert.equal((await post(`/api/lights/${l.id}/act`, { action: 'approve' })).status, 400);
    const rev = (await (await fetch(a.url + '/api/state')).json()).lights[0].rev;
    assert.equal((await post(`/api/lights/${l.id}/act`, { action: 'approve', rev })).status, 200);
  } finally { a.close(); }
});
