'use strict';
// Batch 5: the Nov 13 adversarial run (docs/ADVERSARIAL-2026-11-13.md) and the five residual risks from the re-review.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, DAY, OUT_HOLD_MS, CLAIM_MS } = require('../lib/store');
const { start } = require('../server');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-b5-'));
const T0 = new Date(2026, 10, 13, 10, 0, 0).getTime(), HOLD = OUT_HOLD_MS + 1000, MIN = 60000;
const revOf = (s, id, now) => s.view(now).lights.find((l) => l.id === id).rev;
const msg = (s, extra, now = T0) => s.raise(Object.assign({ area: 'Shop', title: 'Send the quote', draft: 'Attached is the quote.', outbound: true, follow_up_days: 3, to: 'Priya', agent: 'bot' }, extra), now);
const collect = (s, now, who = { agent: 'bot' }) => s.decisions(now, who).decisions;

test('R1 "I sent it" closes the decision; the assistant is told, never asked to send', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Text the supplier', draft: 'Is it shipping Thursday?', phone: '+15555550142', follow_up_days: 1, agent: 'bot' }, T0);
  s.act(l.id, 'approve', {}, T0);
  const out = s.decisions(T0 + HOLD, { agent: 'bot' });
  assert.equal(out.decisions.length, 0, 'nothing to execute');
  assert.deepEqual(out.sent_by_you.map((x) => [x.title, x.text]), [['Text the supplier', 'Is it shipping Thursday?']]);
  assert.equal(s.decisions(T0 + HOLD + 1, { agent: 'bot' }).sent_by_you.length, 0, 'told once');
});

test('R2 (A2, S6) what was approved is frozen: attachments and payload are in the fingerprint, and nothing can change before collection', () => {
  const s = open(tmp());
  const l = msg(s, { attachments: [{ name: 'Quote-8900.pdf', link: 'https://example.com/a.pdf' }], payload: { thread: 1 } });
  const shown = revOf(s, l.id, T0);
  s.update(l.id, { attachments: [{ name: 'Quote-450.pdf', link: 'https://example.com/b.pdf' }] }, 'bot', T0 + 1000);
  assert.throws(() => s.act(l.id, 'approve', { rev: shown }, T0 + 2000), /This changed/);
  s.act(l.id, 'approve', { rev: revOf(s, l.id, T0 + 2000) }, T0 + 2000);
  for (const patch of [{ to: 'Someone Else' }, { payload: { thread: 5 } }, { attachments: [] }, { changeTo: 'x' }, { change_from: 'x' }, { options: ['a'] }, { state: 'broken' }, { state: 'done' }, { link: 'https://example.com/x' }, { source: 'new' }])
    assert.throws(() => s.update(l.id, patch, 'bot', T0 + 3000), /already approved/, JSON.stringify(patch));
  s.update(l.id, { note: 'still queued on my side' }, 'bot', T0 + 3000);
  const d = collect(s, T0 + 2000 + HOLD)[0];
  assert.deepEqual([d.to, d.payload, d.attachments[0].name], ['Priya', { thread: 1 }, 'Quote-450.pdf']);
  assert.throws(() => s.update(l.id, { to: 'Changed after collection' }, 'bot', T0 + 3 * HOLD), /has not reported back/, 'frozen until reported (deep dig F2, B3)');
  assert.equal(s.decisions(T0 + 3 * HOLD + CLAIM_MS, { agent: 'bot' }).decisions[0].to, 'Priya', 'the decision keeps what was approved');
});

test('R3 (S5, X2) a report names its decision, and cannot arrive before the hold ends', () => {
  const s = open(tmp());
  const l = msg(s); s.act(l.id, 'approve', {}, T0);
  assert.throws(() => s.complete(l.id, 'sent', '', T0 + 5000), /not been released/);
  const first = collect(s, T0 + HOLD)[0];
  s.complete(l.id, 'failed', 'timeout', T0 + HOLD + 1000, first.decision_id);
  s.act(l.id, 'answer', { value: 'Try again' }, T0 + HOLD + 2000);
  assert.throws(() => s.complete(l.id, 'sent', '', T0 + HOLD + 3000, first.decision_id), /earlier decision/);
  assert.equal(l.state, 'approved');
  assert.equal(l.sent.length, 0);
});

test('R4 (X5) collecting is a claim: a second caller gets nothing until it lapses', () => {
  const s = open(tmp());
  const l = msg(s); s.act(l.id, 'approve', {}, T0);
  const a = collect(s, T0 + HOLD);
  assert.equal(a.length, 1);
  assert.equal(a[0].collected_before, false);
  assert.equal(collect(s, T0 + HOLD + 500).length, 0, 'same name, half a second later');
  assert.equal(collect(s, T0 + HOLD + 600, { all: true, agent: 'other' }).length, 0);
  assert.equal(s.decisionFor(l.id, T0 + HOLD + 700, { agent: 'someone' }), null);
  const late = collect(s, T0 + HOLD + CLAIM_MS + 1000);
  assert.deepEqual([late[0].decision_id, late[0].collected_before, late[0].needs_check], [a[0].decision_id, true, true]);
});

test('R5 an uncertain send is never retried blind', () => {
  const s = open(tmp());
  const l = msg(s); s.act(l.id, 'approve', {}, T0);
  const d = collect(s, T0 + HOLD)[0];                       // collected; the assistant dies before reporting
  assert.equal(s.tick(T0 + HOLD + CLAIM_MS + MIN), true);
  const v = s.view(T0 + HOLD + CLAIM_MS + MIN);
  assert.match(v.lights[0].alert, /never reported/);
  assert.equal(v.counts.unreported, 1);
  const t = open(tmp());
  const m = msg(t); t.act(m.id, 'approve', {}, T0);
  const first = collect(t, T0 + HOLD)[0];
  t.complete(m.id, 'unsure', 'timed out waiting for the mail server', T0 + HOLD + 1, first.decision_id);
  const row = t.view(T0 + HOLD + 2).lights[0];
  assert.deepEqual([row.state, row.options], ['broken', ['It went out', 'It did not go out']]);
  t.act(m.id, 'answer', { value: 'It did not go out' }, T0 + HOLD + 3);
  const retry = collect(t, T0 + 2 * HOLD + 3)[0];
  assert.equal(retry.retry_of, first.decision_id);
  const u = open(tmp());
  const n = msg(u); u.act(n.id, 'approve', {}, T0);
  const f = collect(u, T0 + HOLD)[0]; u.complete(n.id, 'unsure', 'connection dropped', T0 + HOLD + 1, f.decision_id);
  u.act(n.id, 'answer', { value: 'It went out' }, T0 + HOLD + 2);
  assert.deepEqual([n.state, n.sent.length, collect(u, T0 + 3 * HOLD).length], ['waiting_them', 1, 0]);
});

test('S1 "Try again" re-issues the same decision, not a fresh approval', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'App', title: 'Which one stays?', kind: 'decide', options: ['Keep the first', 'Keep the second'], agent: 'bot' }, T0);
  s.act(l.id, 'answer', { value: 'Keep the second' }, T0);
  const a = collect(s, T0 + HOLD)[0]; s.complete(l.id, 'failed', 'API timeout', T0 + HOLD + 1, a.decision_id);
  s.act(l.id, 'answer', { value: 'Try again' }, T0 + HOLD + 2);
  const b = collect(s, T0 + 2 * HOLD + 2)[0];
  assert.deepEqual([b.action, b.value, b.retry_of], ['answer', 'Keep the second', a.decision_id]);
  const n = s.raise({ area: 'App', title: 'Change price', change_from: '$40', change_to: '$45', agent: 'bot' }, T0);
  s.act(n.id, 'no', {}, T0);
  const c = collect(s, T0 + HOLD).find((x) => x.id === n.id); s.complete(n.id, 'failed', 'x', T0 + HOLD + 1, c.decision_id);
  s.act(n.id, 'answer', { value: 'Try again' }, T0 + HOLD + 2);
  assert.equal(collect(s, T0 + 2 * HOLD + 2).find((x) => x.id === n.id).action, 'no', 'a declined change never comes back as a yes');
  const m = msg(s, { title: 'Hi Dale' }); s.act(m.id, 'approve', {}, T0);
  const d1 = collect(s, T0 + HOLD).find((x) => x.id === m.id); s.complete(m.id, 'failed', 'x', T0 + HOLD + 1, d1.decision_id);
  s.act(m.id, 'answer', { value: 'Try again' }, T0 + HOLD + 2);
  const d2 = collect(s, T0 + 2 * HOLD + 2).find((x) => x.id === m.id); s.complete(m.id, 'sent', '', T0 + 2 * HOLD + 3, d2.decision_id);
  assert.match(s.history('Hi Dale')[0].what, /sent/);
  assert.doesNotMatch(s.history('Hi Dale')[0].what, /failed/);
});

test('S3 (A3) raising again with the same key brings a reply back to gold, and says what it ignored', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Quote to Dale', state: 'waiting_them', outbound: true, follow_up_days: 3, key: 'thread-9', agent: 'bot' }, T0);
  const again = s.raise({ area: 'Elsewhere', title: 'Dale replied: yes', draft: 'Great, Saturday at 10?', source: 'Dale: "Let\'s do it."', key: 'thread-9', agent: 'bot', phone: '+15555550100' }, T0 + DAY);
  assert.equal(again.id, l.id);
  assert.equal(l.state, 'need_you');
  assert.equal(s.view(T0 + DAY).queue.length, 1);
  assert.match(s.warnings.join(' | '), /area/);
  assert.match(s.warnings.join(' | '), /phone/);
  s.tick(T0 + 5 * DAY);
  assert.equal(l.draft, 'Great, Saturday at 10?', 'the timer does not erase the reply');
});

test('S4 a redrafted light is clean: no stale failure, and it can be approved', () => {
  const s = open(tmp());
  const l = msg(s); s.act(l.id, 'approve', {}, T0);
  const d = collect(s, T0 + HOLD)[0]; s.complete(l.id, 'failed', 'bounced', T0 + HOLD + 1, d.decision_id);
  s.update(l.id, { state: 'need_you', draft: 'Second try.' }, 'bot', T0 + HOLD + 2);
  const v = s.view(T0 + HOLD + 3).lights[0];
  assert.deepEqual([v.kind, v.options, v.alert, v.failure], ['approve', [], '', '']);
  s.act(l.id, 'approve', { rev: v.rev }, T0 + HOLD + 4);
  assert.equal(l.state, 'approved');
});

test('N1 a date-only due means the end of that local day', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'A', title: 'Form', kind: 'todo', due: '2026-11-20' }, T0);
  const d = new Date(l.due);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 20, 23, 59]);
  assert.match(s.raise({ area: 'A', title: 'Old', kind: 'todo', due: '12/13' }, T0) && s.warnings.join(' '), /due/);
});

test('N3 an exact estimate stays exact; only paired samples correct it', () => {
  const s = open(tmp());
  for (let i = 0; i < 6; i++) s.act(s.raise({ area: 'A', title: 'untimed ' + i, draft: 'x', action_type: 'reply' }, T0).id, 'approve', { tookMs: 90000 }, T0);
  for (let i = 0; i < 3; i++) s.act(s.raise({ area: 'A', title: 'stated ' + i, draft: 'x', action_type: 'reply', seconds: 10 }, T0).id, 'approve', { tookMs: 10000 }, T0);
  const l = s.raise({ area: 'A', title: 'two minutes', draft: 'x', action_type: 'reply', seconds: 120 }, T0);
  const v = s.view(T0).lights.find((x) => x.id === l.id);
  assert.deepEqual([v.est, v.chore], [120, false]);
});

test('X4 a container can be called anything', () => {
  const s = open(tmp());
  for (const name of ['Constructor', 'toString', '__proto__', 'hasOwnProperty']) { const l = s.raise({ area: name, title: 'x', draft: 'Hi', outbound: true, to: name }, T0); s.act(l.id, 'redo', { why: 'shorter' }, T0); }
  assert.equal(s.view(T0).areas.length, 4);
  s.save(); assert.equal(open(s.dir).view(T0).areas.length, 4);
});

test('S8 a light raised with no name can be collected by a named caller', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Reply', draft: 'Hi', outbound: true }, T0);
  s.act(l.id, 'approve', {}, T0);
  assert.equal(s.decisions(T0 + HOLD, { agent: 'my-script' }).decisions.length, 1);
});

test('X3 collecting is a JSON POST, so another website cannot do it; the wait reports the first collection correctly', async () => {
  const a = await start({ port: 0, dir: tmp(), holdMs: 60 });
  const post = (p, body, cookie) => fetch(a.url + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { 'x-switchboard-key': a.key } : {}), body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const l = (await post('/api/lights', { area: 'A', title: 'Pick', kind: 'decide', options: ['Yes', 'No'], agent: 'bot' })).body;
    assert.equal((await fetch(a.url + '/api/decisions?all=1')).status, 405);
    assert.equal((await fetch(`${a.url}/api/wait?id=${l.id}&seconds=1`)).status, 405);
    const waiting = post('/api/wait', { id: l.id, seconds: 5, agent: 'bot' });
    setTimeout(() => post(`/api/lights/${l.id}/act`, { action: 'answer', value: 'Yes' }, true), 150);
    const got = (await waiting).body;
    assert.deepEqual([got.decided, got.decision.value, got.decision.collected_before], [true, 'Yes', false]);
    assert.equal((await post('/api/complete', { id: l.id, outcome: 'done' })).status, 400, 'a report must name its decision');
    assert.equal((await post('/api/complete', { id: l.id, outcome: 'done', decision_id: got.decision.decision_id })).body.state, 'done');
    assert.equal((await post('/api/decisions', { agent: 'bot' })).body.decisions.length, 0);
  } finally { a.close(); }
});
