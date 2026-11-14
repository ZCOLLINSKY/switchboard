'use strict';
// Review batch 4: trust.
require('./fixtures/env'); // the same result whatever SWITCHBOARD_* settings the caller has
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, DAY, OUT_HOLD_MS, FLAG } = require('../lib/store');
const { start } = require('../server');
const { scenarios } = require('../scenarios');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-b4-'));
const T0 = new Date(2026, 10, 13, 10, 0, 0).getTime();
const revOf = (s, id, now) => s.view(now).lights.find((l) => l.id === id).rev;
const fix = (s, now, extra) => s.raise(Object.assign({ area: 'Site', title: 'Fix a listing', change_from: 'Open year-round', change_to: 'Closed Dec to Mar', action_type: 'listing-fix', agent: 'bot' }, extra), now);
// Ten single approvals with the change on screen, spread over `days` different days.
const earn = (s, days) => { for (let i = 0; i < 10; i++) { const now = T0 + (i % days) * DAY + i * 1000; const l = fix(s, now); s.act(l.id, 'approve', { rev: revOf(s, l.id, now) }, now); } };

test('4.1 the "run by themselves" offer is off until it is switched on; streaks still count', () => {
  const s = open(tmp());
  earn(s, 3);
  assert.equal(s.view(T0 + 3 * DAY).promote.length, 0);
  assert.equal(s.view(T0 + 3 * DAY).autonomy.enabled, false);
  assert.throws(() => s.promote('site|listing-fix', true), /switched off/);
  s.setting('autonomy', true);
  assert.deepEqual(s.view(T0 + 3 * DAY).promote.map((p) => [p.area, p.type, p.streak]), [['Site', 'listing-fix', 10]]);
  const t = open(tmp()); scenarios.trusted.build(t, T0);
  assert.equal(t.view(T0).promote.length, 0, 'the Earning trust day shows no offer by default');
});

test('4.3 (P5, P5b) only typed changes, one container and type, single taps on three different days', () => {
  const a = open(tmp()); a.setting('autonomy', true);
  earn(a, 2);
  assert.equal(a.view(T0 + 3 * DAY).promote.length, 0, 'two days is not three');
  const b = open(tmp()); b.setting('autonomy', true);
  const ids = [], revs = {}; for (let i = 0; i < 8; i++) { const l = fix(b, T0); ids.push(l.id); revs[l.id] = revOf(b, l.id, T0); }
  b.bulk(ids, 'approve', { revs }, T0);
  [1, 2].forEach((d) => { const l = fix(b, T0 + d * DAY); b.act(l.id, 'approve', { rev: revOf(b, l.id, T0 + d * DAY) }, T0 + d * DAY); });
  assert.equal(b.view(T0 + 3 * DAY).promote.length, 0, 'bulk taps do not count');
  assert.throws(() => b.promote('site|refund', true), /real streak/);

  const s = open(tmp()); s.setting('autonomy', true); earn(s, 3); s.promote('site|listing-fix', true);
  const big = s.raise({ area: 'Site', title: 'Delete all 4,000 listings and email every customer', draft: 'delete listings; email price list', action_type: 'listing-fix' }, T0 + 4 * DAY);
  assert.equal(big.state, 'need_you', 'free text is never automatic, whatever its label');
  const other = s.raise({ area: 'Shop', title: 'Fix', change_from: 'a', change_to: 'b', action_type: 'listing-fix' }, T0 + 4 * DAY);
  assert.equal(other.state, 'need_you', 'the rule belongs to one container');
  const person = s.raise({ area: 'Site', title: 'Fix', change_from: 'a', change_to: 'b', action_type: 'listing-fix', to: 'Dale' }, T0 + 4 * DAY);
  assert.equal(person.state, 'need_you', 'nothing with a recipient');
  const m = open(tmp()); m.setting('autonomy', true);
  for (let i = 0; i < 12; i++) { const now = T0 + i * DAY; const l = m.raise({ area: 'Shop', title: 'Reply', draft: 'Hi', outbound: true, action_type: 'customer-reply' }, now); m.act(l.id, 'approve', { rev: revOf(m, l.id, now) }, now); }
  assert.equal(m.view(T0 + 13 * DAY).promote.length, 0, 'messages never earn it');
});

test('4.4 (P5) the first five automatic runs all come back, then a random one in twenty; there is a panel, a switch and a brake', () => {
  let roll = 0.99;
  const s = open(tmp(), { random: () => roll }); s.setting('autonomy', true); earn(s, 3); s.promote('site|listing-fix', true);
  const runs = []; for (let i = 1; i <= 12; i++) runs.push(fix(s, T0 + 4 * DAY + i * 400e3));
  assert.deepEqual(runs.map((l) => l.spot), [true, true, true, true, true, false, false, false, false, false, false, false]);
  assert.equal(runs[5].decision.by, 'auto');
  roll = 0.01; assert.equal(fix(s, T0 + 6 * DAY).spot, true);
  const rule = s.view(T0 + 6 * DAY).autonomy.rules[0];
  assert.deepEqual([rule.area, rule.type, rule.runs, rule.paused], ['Site', 'listing-fix', 13, false]);
  assert.ok(rule.recent.length >= 5);
  roll = 0.99;
  let last; for (let i = 0; i < 25; i++) last = fix(s, T0 + 7 * DAY + i * 1000);
  assert.equal(last.state, 'need_you', 'a spike pauses the rule');
  const v = s.view(T0 + 7 * DAY + 30000);
  assert.equal(v.autonomy.rules[0].paused, true);
  const brake = v.lights.find((l) => /Keep going\?/.test(l.title));
  s.act(brake.id, 'answer', { value: 'Turn it off' }, T0 + 7 * DAY + 31000);
  assert.equal(s.view(T0 + 7 * DAY + 32000).autonomy.rules.length, 0);
  // flagging a spot check ends it too
  const f = open(tmp()); f.setting('autonomy', true); earn(f, 3); f.promote('site|listing-fix', true);
  const spot = fix(f, T0 + 4 * DAY); f.act(spot.id, 'answer', { value: FLAG }, T0 + 4 * DAY + 1000);
  assert.equal(f.view(T0 + 4 * DAY + 2000).autonomy.rules.length, 0);
});

test('4.5 a message approved faster than it can be read is held twice as long, and says so', () => {
  const s = open(tmp());
  const draft = Array.from({ length: 40 }, (_, i) => 'word' + i).join(' ');
  const l = s.raise({ area: 'Shop', title: 'Reply', draft, outbound: true, agent: 'bot' }, T0);
  s.act(l.id, 'approve', { tookMs: 800 }, T0);
  const h = s.view(T0 + 1000).held[0];
  assert.equal(h.until, T0 + 2 * OUT_HOLD_MS);
  assert.equal(h.fast, true);
  const slow = s.raise({ area: 'Shop', title: 'Reply 2', draft, outbound: true, agent: 'bot' }, T0);
  s.act(slow.id, 'approve', { tookMs: 9000 }, T0);
  assert.equal(s.view(T0 + 1000).held.find((x) => x.id === slow.id).fast, false);
});

test('4.6 a first-time recipient is marked', () => {
  const s = open(tmp());
  const a = s.raise({ area: 'Shop', title: 'Reply', draft: 'Hi', outbound: true, to: 'Dale Henderson', agent: 'bot' }, T0);
  assert.equal(s.view(T0).lights[0].firstTime, true);
  s.act(a.id, 'approve', {}, T0); s.decisions(T0 + OUT_HOLD_MS, { all: true }); s.complete(a.id, 'sent', '', T0 + OUT_HOLD_MS);
  const b = s.raise({ area: 'Shop', title: 'Reply again', draft: 'Hi', outbound: true, to: 'dale henderson ', agent: 'bot' }, T0 + DAY);
  assert.equal(s.view(T0 + DAY).lights.find((l) => l.id === b.id).firstTime, false);
  assert.equal(s.view(T0 + DAY).lights.find((l) => l.id === b.id).est > 0, true);
});

test('4.7 "Not like this" sends the reason to the assistant, and a repeated reason becomes a standing rule', () => {
  const s = open(tmp());
  const ask = (now) => s.raise({ area: 'Shop', title: 'Reply', draft: 'Dear Sir or Madam, …', outbound: true, agent: 'bot' }, now);
  const a = ask(T0);
  assert.throws(() => s.act(a.id, 'redo', {}, T0), /short note/i);
  s.act(a.id, 'redo', { why: 'Too formal. First names.' }, T0);
  assert.equal(s.view(T0).queue.length, 0);
  const d = s.decisions(T0 + OUT_HOLD_MS, { agent: 'bot' }).decisions[0];
  assert.deepEqual([d.action, d.text], ['redo', 'Too formal. First names.']);
  s.update(a.id, { state: 'need_you', draft: 'Hi Dale, …' }, 'bot', T0 + OUT_HOLD_MS + 1000);
  assert.equal(s.view(T0 + OUT_HOLD_MS + 2000).queue.length, 1);
  assert.equal(s.view(T0 + OUT_HOLD_MS + 2000).suggest.length, 0);
  const b = ask(T0 + DAY); s.act(b.id, 'redo', { why: 'too formal, first names' }, T0 + DAY);
  const sug = s.view(T0 + DAY).suggest;
  assert.equal(sug.length, 1);
  assert.equal(sug[0].name, 'Shop');
  s.learn(sug[0].area, sug[0].why, true);
  assert.ok((s.db.areas[0].rules || []).some((r) => /first names/i.test(r)), 'kept as a standing rule');
  assert.equal(s.view(T0 + DAY).suggest.length, 0);
});

test('4.2 only the person\'s own page can approve, undo, or promote', async () => {
  const a = await start({ port: 0, dir: tmp() });
  const call = (p, body, key) => fetch(a.url + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, key ? { 'x-switchboard-key': key } : {}), body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const l = (await call('/api/lights', { area: 'A', title: 'fix', change_from: 'a', change_to: 'b', agent: 'bot' })).body;
    const rev = (await (await fetch(a.url + '/api/state')).json()).lights[0].rev;
    const no = await call(`/api/lights/${l.id}/act`, { action: 'approve', rev });
    assert.equal(no.status, 403);
    assert.equal((await call('/api/bulk', { ids: [l.id], action: 'approve', revs: { [l.id]: rev } })).status, 403);
    assert.equal((await call('/api/promote', { key: 'a|x', yes: true })).status, 403);
    assert.equal((await (await fetch(a.url + '/api/state')).json()).canAct, false);
    // the printed link serves the page, which keeps the key itself: no cookie (a cookie on 127.0.0.1 is shared across ports)
    const opened = await fetch(a.link, { redirect: 'manual' });
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get('set-cookie'), null);
    assert.equal(opened.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await fetch(a.url + '/?key=wrong')).status, 403);
    assert.equal((await (await fetch(a.url + '/api/state', { headers: { 'x-switchboard-key': a.key } })).json()).canAct, true);
    assert.equal((await (await fetch(a.url + '/api/state', { headers: { cookie: 'sb_page=' + a.key } })).json()).canAct, false, 'the old cookie is no longer a key');
    assert.equal((await call(`/api/lights/${l.id}/act`, { action: 'approve', rev }, a.key)).status, 200);
    assert.equal((await call(`/api/lights/${l.id}/act`, { action: 'undo' }, 'wrong')).status, 403);
  } finally { a.close(); }
});
