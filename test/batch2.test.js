'use strict';
// Review batch 2: "approved" stays true until the message is sent.
require('./fixtures/env'); // the same result whatever SWITCHBOARD_* settings the caller has
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, DAY, HOLD_MS } = require('../lib/store');
const { start } = require('../server');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-b2-'));
const T0 = Date.UTC(2026, 10, 13, 15), HOLD = require('../lib/store').OUT_HOLD_MS + 1000, MIN = 60000;
const quote = (s, extra) => s.raise(Object.assign({ area: 'Shop', title: 'Send the HOA quote', draft: 'Hi Priya, $8,900 installed.', outbound: true, follow_up_days: 3, value: 8900, agent: 'shop-bot' }, extra), T0);

test('2.1 each assistant gets only the decisions on lights it raised', () => {
  const s = open(tmp());
  const a = s.raise({ area: 'A', title: 'fix a', change_from: 'x', change_to: 'y', agent: 'alpha' }, T0);
  const b = s.raise({ area: 'B', title: 'fix b', change_from: 'x', change_to: 'y', agent: 'beta' }, T0);
  s.act(a.id, 'approve', {}, T0); s.act(b.id, 'approve', {}, T0);
  assert.deepEqual(s.decisions(T0 + HOLD, { agent: 'alpha' }).decisions.map((d) => d.title), ['fix a']);
  assert.deepEqual(s.decisions(T0 + HOLD, { agent: 'beta' }).decisions.map((d) => d.title), ['fix b']);
  const t = open(tmp());
  ['alpha', 'beta'].forEach((n) => t.act(t.raise({ area: 'A', title: 'fix ' + n, change_from: 'x', change_to: 'y', agent: n }, T0).id, 'approve', {}, T0));
  assert.equal(t.decisions(T0 + HOLD, { all: true }).decisions.length, 2);
});

test('2.2 (N1) fetching collects: undo is refused after that, and a retry sees the same decision id', () => {
  const s = open(tmp());
  const l = quote(s);
  s.act(l.id, 'approve', {}, T0);
  const first = s.decisions(T0 + HOLD, { agent: 'shop-bot' }).decisions[0];
  assert.ok(first.decision_id);
  assert.equal(first.collected_before, false);
  assert.throws(() => s.act(l.id, 'undo', {}, T0 + HOLD + 2000), /Too late: your assistant already has it\./);
  assert.equal(s.decisions(T0 + HOLD + 3000, { agent: 'shop-bot' }).decisions.length, 0, 'claimed: not handed out twice');
  const CLAIM = require('../lib/store').CLAIM_MS;
  const again = s.decisions(T0 + HOLD + CLAIM + 1, { agent: 'shop-bot' }).decisions[0];
  assert.equal(again.decision_id, first.decision_id, 'the same decision, so a retry can tell');
  assert.equal(again.collected_before, true);
  assert.equal(s.ack([l.id]), 0, 'a message to a person cannot be waved through as handled');
  s.complete(l.id, 'sent', '', T0 + HOLD + CLAIM + 2, first.decision_id);
  assert.equal(s.decisions(T0 + HOLD + 2 * CLAIM + 2, { agent: 'shop-bot' }).decisions.length, 0);
});

test('2.3 complete reports sent, done or failed; a failure turns the light red with the reason', () => {
  const s = open(tmp());
  const l = quote(s); s.act(l.id, 'approve', {}, T0); s.decisions(T0 + HOLD, { all: true });
  s.complete(l.id, 'failed', 'The mail server refused the message.', T0 + HOLD + 1000);
  assert.equal(l.state, 'broken');
  assert.match(s.view(T0 + HOLD + 2000).lights[0].failure, /refused/);
  s.act(l.id, 'answer', { value: 'Try again' }, T0 + HOLD + 3000);
  assert.equal(l.state, 'approved');
  s.decisions(T0 + 2 * HOLD + 3000, { all: true });
  s.complete(l.id, 'sent', '', T0 + 2 * HOLD + 4000);
  assert.equal(l.state, 'waiting_them');
  assert.throws(() => s.complete(l.id, 'vanished'), /sent, done or failed/);
});

test('2.4 (P3) approved is not sent: it turns blue only on delivery, and red when nobody collects it', () => {
  const s = open(tmp());
  const l = quote(s);
  s.act(l.id, 'approve', {}, T0);
  assert.equal(l.state, 'approved');
  assert.equal(s.view(T0).counts.approved, 1);
  assert.equal(s.view(T0).counts.waiting_them, 0);
  assert.equal(s.tick(T0 + 15 * MIN), false, 'the 15 minutes run from when an assistant could first have taken it');
  assert.equal(s.tick(T0 + 17 * MIN), true);
  s.tick(T0 + 3 * DAY + 1);
  const v = s.view(T0 + 3 * DAY + 1), shown = v.lights[0];
  assert.equal(shown.state, 'broken');
  assert.equal(shown.title, 'Send the HOA quote');
  assert.match(shown.draft, /\$8,900/);
  assert.match(shown.alert, /No assistant has collected it/);
  assert.equal(s.decisions(T0 + 4 * DAY, { all: true }).decisions.length, 1, 'still there for an assistant that shows up late');
  s.complete(l.id, 'sent', '', T0 + 4 * DAY + 1000);
  assert.equal(l.state, 'waiting_them');
  assert.equal(l.followUpAt, T0 + 4 * DAY + 1000 + 3 * DAY, 'the follow-up clock starts at delivery');
});

test('2.5 nothing is erased: the approved text survives the follow-up and is found in history', () => {
  const s = open(tmp());
  const l = quote(s);
  s.act(l.id, 'approve', {}, T0); s.decisions(T0 + HOLD, { all: true }); s.complete(l.id, 'sent', '', T0 + HOLD + 1);
  s.tick(T0 + 4 * DAY);
  assert.match(l.title, /^Follow up: /);
  assert.equal(l.sent.length, 1);
  assert.match(l.sent[0].text, /\$8,900/);
  assert.equal(s.history('HOA').length, 1);
  assert.match(s.history('HOA')[0].text, /\$8,900/);
  s.save();
  const lines = fs.readFileSync(path.join(s.dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(lines.length >= 4);
  assert.ok(lines.some((e) => e.type === 'decided') && lines.some((e) => e.type === 'completed'));
  assert.equal(open(s.dir).history('HOA').length, 1, 'history is read back from the log');
});

test('2.6 (N2) an assistant cannot wipe an approval nobody has collected', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Reply to Dale', draft: 'v1', outbound: true, agent: 'bot' }, T0);
  s.act(l.id, 'approve', {}, T0);
  assert.throws(() => s.update(l.id, { state: 'need_you', draft: 'v2', reason: 'new info' }, 'agent', T0 + 5000), /already approved/);
  assert.equal(l.draft, 'v1');
  assert.equal(s.decisions(T0 + HOLD + 5000, { all: true }).decisions.length, 1);
});

test('2.7 key, payload, to and attachments', () => {
  const s = open(tmp());
  const a = s.raise({ area: 'Shop', title: 'Reply to Dale', draft: 'v1', outbound: true, key: 'thread-88', to: 'Dale Henderson', payload: { thread: 88, mailbox: 'sales' }, attachments: [{ name: 'Quote.pdf', link: 'https://example.com/q.pdf' }], agent: 'bot' }, T0);
  const b = s.raise({ area: 'Shop', title: 'Reply to Dale', draft: 'v2', outbound: true, key: 'thread-88', agent: 'bot' }, T0 + 1000);
  assert.equal(b.id, a.id);
  assert.equal(s.view(T0 + 2000).lights.length, 1);
  assert.equal(a.draft, 'v2');
  s.act(a.id, 'approve', { rev: s.view(T0 + 2000).lights[0].rev }, T0 + 2000);
  const d = s.decisions(T0 + 2000 + HOLD, { agent: 'bot' }).decisions[0];
  assert.deepEqual(d.payload, { thread: 88, mailbox: 'sales' });
  assert.equal(d.to, 'Dale Henderson');
  assert.equal(a.attachments[0].name, 'Quote.pdf');
  assert.throws(() => s.raise({ area: 'A', title: 'big', payload: 'x'.repeat(5000) }, T0), /4 KB/);
});

test('2.8 (P12) the person can say they replied or stop the chasing, and follow-ups end by themselves', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Text the supplier', draft: 'Is the order shipping Thursday?', phone: '+15555550142', follow_up_days: 1 }, T0);
  let now = T0, n = 0;
  for (let i = 0; i < 30; i++) { try { s.act(l.id, 'approve', { text: 'nudge ' + i }, now); } catch (e) { break; } now += DAY + 1; if (s.tick(now)) n++; }
  assert.ok(n <= 3, 'follow-ups stop, got ' + n);
  assert.match(l.title, /^Keep chasing\?/);
  s.act(l.id, 'answer', { value: 'Stop following up' }, now);
  assert.equal(l.state, 'done');

  const b = s.raise({ area: 'Shop', title: 'Quote to the Parkers', state: 'waiting_them', follow_up_days: 2 }, T0);
  s.act(b.id, 'stop_followups', {}, T0 + 1000);
  assert.equal(b.followUpAt, null);
  assert.equal(s.tick(T0 + 9 * DAY), false);
  const c = s.raise({ area: 'Shop', title: 'Quote to the Lees', state: 'waiting_them', follow_up_days: 2, agent: 'bot' }, T0);
  s.act(c.id, 'replied', {}, T0 + 1000);
  assert.equal(c.state, 'done');
  assert.equal(s.decisions(T0 + HOLD + 1000, { agent: 'bot' }).decisions[0].action, 'replied');
});

test('2.9 wrong input is refused or reported', () => {
  const s = open(tmp());
  assert.throws(() => s.raise({ area: 'A', title: 'x', state: 'needs_you' }, T0), /state must be one of/);
  assert.throws(() => s.raise({ area: 'A', title: 'x', kind: 'aprove' }, T0), /kind must be one of/);
  const l = s.raise({ area: 'A', title: 'x', draft: 'See you Saturday at 10.', follow_up_days: 400, link: 'ftp://nope', options: 'Yes,No', colour: 'red' }, T0);
  const w = s.warnings.join(' | ');
  assert.match(w, /follow_up_days/); assert.match(w, /link/); assert.match(w, /options/); assert.match(w, /colour/); assert.match(w, /due/);
  assert.throws(() => s.update(l.id, { kind: 'nope' }, 'agent', T0), /kind must be one of/);
  s.update(l.id, { phone: '+15555550100' }, 'agent', T0);
  assert.match(s.warnings.join(' | '), /phone/);
});

test('2.10 a green light that goes quiet past its expected time turns amber', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'App', title: 'Nightly test run', state: 'auto', progress: 10, expect_by: T0 + 3600e3 }, T0);
  assert.equal(s.view(T0 + 1800e3).lights[0].late, false);
  s.tick(T0 + 3700e3);
  assert.equal(s.view(T0 + 3700e3).lights[0].late, true);
  assert.equal(s.view(T0 + 3700e3).counts.late, 1);
  s.update(l.id, { progress: 60, expect_by: T0 + 3 * 3600e3 }, 'agent', T0 + 3800e3);
  assert.equal(s.view(T0 + 3900e3).lights[0].late, false);
});

test('2.10 wait_for_decision returns as soon as the person decides', async () => {
  const dir = tmp();
  const a = await start({ port: 0, dir, holdMs: 60 });
  const post = (p, body) => fetch(a.url + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-switchboard-key': a.key }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const l = await post('/api/lights', { area: 'A', title: 'Pick one', kind: 'decide', options: ['Yes', 'No'], agent: 'bot' });
    assert.equal((await post('/api/wait', { id: l.id, seconds: 1, agent: 'bot' })).decided, false);
    const waiting = post('/api/wait', { id: l.id, seconds: 5, agent: 'bot' });
    setTimeout(() => post(`/api/lights/${l.id}/act`, { action: 'answer', value: 'Yes' }), 150);
    const t0 = Date.now(), got = await waiting;
    assert.equal(got.decided, true);
    assert.equal(got.decision.value, 'Yes');
    assert.ok(Date.now() - t0 < 3000);
    const c = await post('/api/complete', { id: l.id, outcome: 'done', decision_id: got.decision.decision_id });
    assert.equal(c.state, 'done');
    const bad = await post('/api/lights', { area: 'A', title: 'x', follow_up_days: 400 });
    assert.match(bad.warnings.join(' '), /follow_up_days/);
  } finally { a.close(); }
});
