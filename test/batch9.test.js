'use strict';
// Batch 9: what the rerun of every repro still reproduced after batch 8.
require('./fixtures/env'); // the same result whatever SWITCHBOARD_* settings the caller has
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, rev, splitDump, DAY, OUT_HOLD_MS, HOLD_MS, CLAIM_MS } = require('../lib/store');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb9-'));
const T0 = new Date(2026, 10, 16, 10, 0, 0).getTime(), HOLD = OUT_HOLD_MS + 1000;
const msg = (s, extra, now = T0) => s.raise(Object.assign({ area: 'Shop', title: 'Reply to Dale', draft: 'Thursday works.', to: 'Dale', agent: 'bot' }, extra), now);
function promoted(s) {
  s.setting('autonomy', true);
  for (let i = 0; i < 10; i++) { const t = T0 + (i % 3) * DAY + i * 1000, l = s.raise({ area: 'Site', title: 'P' + i, change_from: 'a' + i, change_to: 'b' + i, action_type: 'price', agent: 'bot' }, t); s.act(l.id, 'approve', { rev: rev(l) }, t); }
  s.promote('site|price', true, T0 + 3 * DAY);
  for (let i = 0; i < 26; i++) s.raise({ area: 'Site', title: 'Auto ' + i, change_from: 'x', change_to: 'y' + i, action_type: 'price', agent: 'bot' }, T0 + 4 * DAY + i);
  return s.db.lights.find((l) => l.brake);
}

test('F21 taking back an answer on "Keep going?" puts the rule back as it was', () => {
  const s = open(tmp(), { random: () => 0.99 }); const b = promoted(s), t = T0 + 4 * DAY + 100;
  s.act(b.id, 'answer', { value: 'Keep going' }, t);
  assert.equal(s.db.auto['site|price'].paused, false);
  s.act(b.id, 'undo', {}, t + 1);
  assert.equal(s.db.auto['site|price'].paused, true, 'paused again, the card asks again');
  s.act(b.id, 'answer', { value: 'Turn it off' }, t + 2);
  assert.equal(s.db.auto['site|price'], undefined);
  s.act(b.id, 'undo', {}, t + 3);
  assert.ok(s.db.auto['site|price'], 'the rule is back');
});
test('F25 taking back "Not like this" removes that reason, not the latest one', () => {
  const s = open(tmp());
  const a = msg(s, { title: 'A', key: 'a' }), c = msg(s, { title: 'C', key: 'c' });
  s.act(a.id, 'redo', { why: 'wrong price' }, T0);
  s.act(c.id, 'redo', { why: 'too formal' }, T0 + 1);
  s.act(a.id, 'undo', {}, T0 + 2);
  assert.deepEqual(s.db.reasons.shop.map((r) => r.why), ['too formal']);
});
test('F29 B25 B28 "One more follow-up" is one, keeps "They replied", and uses a prepared text', () => {
  const s = open(tmp());
  const l = msg(s, { state: 'waiting_them', draft: '', outbound: true, follow_up_days: 2 });
  let t = T0;
  for (let i = 0; i < 4 && !l.chase; i++) { t += 3 * DAY; s.tick(t); if (l.chase) break; s.update(l.id, { draft: 'Checking in.' }, 'bot', t); s.act(l.id, 'approve', { rev: rev(l) }, t); const d = s.decisions(t + HOLD, { agent: 'bot' }).decisions[0]; s.complete(l.id, 'sent', '', t + HOLD, d.decision_id); }
  assert.equal(l.chase, true);
  s.update(l.id, { follow_up_draft: 'Last note from me.' }, 'bot', t + 1);
  s.act(l.id, 'answer', { value: 'One more follow-up' }, t + 2);
  assert.equal(l.draft, 'Last note from me.');
  assert.ok(l.followUps > 0, '"They replied" stays available');
  s.act(l.id, 'approve', { rev: rev(l) }, t + 3);
  const d = s.decisions(t + 3 + HOLD, { agent: 'bot' }).decisions[0]; s.complete(l.id, 'sent', '', t + 3 + HOLD, d.decision_id);
  s.tick(t + 10 * DAY);
  assert.equal(l.chase, true, 'the very next silence asks again');
});
test('F13 something new on a thread starts its snooze count again', () => {
  const s = open(tmp()); const l = msg(s, { key: 'k' });
  s.act(l.id, 'snooze', { days: 1 }, T0); s.tick(T0 + 2 * DAY); s.act(l.id, 'snooze', { days: 1 }, T0 + 2 * DAY);
  msg(s, { key: 'k', source: 'Dale: new question', draft: 'Answer.' }, T0 + 4 * DAY);
  s.act(l.id, 'snooze', { days: 1 }, T0 + 4 * DAY + 1);
  assert.equal(l.snoozes, 1);
});
test('F34 the autonomy switch takes only true or false', () => {
  const s = open(tmp());
  for (const v of ['false', 'off', 0, 1, null]) assert.throws(() => s.setting('autonomy', v), /true or false/);
  s.setting('autonomy', false); assert.equal(s.db.settings.autonomy, false);
});
test('F9 once an assistant has the approval, a stale tab cannot drop it', () => {
  const s = open(tmp()); const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  s.decisions(T0 + HOLD, { agent: 'bot' });
  assert.throws(() => s.act(l.id, 'drop', {}, T0 + HOLD + 1), /already has it/);
});
test('F22 "It went out" on a collected message can be taken back', () => {
  const s = open(tmp()); const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  const d = s.decisions(T0 + HOLD, { agent: 'bot' }).decisions[0];
  s.complete(l.id, 'unsure', 'timeout', T0 + HOLD + 1, d.decision_id);
  s.act(l.id, 'answer', { value: 'It went out' }, T0 + HOLD + 2);
  assert.ok(s.view(T0 + HOLD + 3).held.some((x) => x.id === l.id), 'offered on the strip');
  s.act(l.id, 'undo', {}, T0 + HOLD + 3);
  assert.equal(l.unsure, true); assert.equal(l.sent.length, 0);
});
test('B6 a retry is held, so its Take back works; B27 a retried "Not like this" waits for the redraft', () => {
  const s = open(tmp()); const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  const d = s.decisions(T0 + HOLD, { agent: 'bot' }).decisions[0];
  s.complete(l.id, 'failed', 'bounced', T0 + HOLD + 1, d.decision_id);
  s.act(l.id, 'answer', { value: 'Try again' }, T0 + HOLD + 2);
  assert.equal(s.decisions(T0 + HOLD + 3, { agent: 'bot' }).decisions.length, 0, 'not handed at once');
  s.act(l.id, 'undo', {}, T0 + HOLD + 4);
  assert.equal(l.state, 'broken');
  const r = msg(s, { title: 'Other', key: 'other' }); s.act(r.id, 'redo', { why: 'too long' }, T0);
  const rd = s.decisions(T0 + HOLD, { agent: 'bot' }).decisions.find((x) => x.id === r.id);
  s.complete(r.id, 'failed', 'could not redraft', T0 + HOLD + 1, rd.decision_id);
  s.act(r.id, 'answer', { value: 'Try again' }, T0 + HOLD + 2);
  assert.equal(r.state, 'queued');
});
test('K16 a failure or "not sure" must say what happened', () => {
  const s = open(tmp()); const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  const d = s.decisions(T0 + HOLD, { agent: 'bot' }).decisions[0];
  assert.throws(() => s.complete(l.id, 'failed', '', T0 + HOLD + 1, d.decision_id), /Say what happened/);
});
test('F26 an untold "I sent it" is kept until told; B16 an answer nobody collects leaves after 90 days', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Text Sam', draft: 'On my way', phone: '+15555550100', agent: 'bot' }, T0);
  s.act(l.id, 'approve', { rev: rev(l) }, T0);
  s.tick(T0 + 40 * DAY); assert.ok(s.db.lights.includes(l), 'still there after 40 days');
  const q = s.raise({ area: 'Shop', title: 'Pick', kind: 'decide', options: ['a', 'b'] }, T0);
  s.act(q.id, 'answer', { value: 'a' }, T0);
  s.tick(T0 + 91 * DAY); assert.ok(!s.db.lights.includes(q));
});
test('F4 F5 notes: thirty things kept, a very long one refused; short forms do not split', () => {
  const many = Array.from({ length: 15 }, (_, i) => 'email person' + i + ' the quote').join('; ');
  assert.equal(splitDump(many).length, 15);
  assert.throws(() => splitDump('x '.repeat(2100)), /Split it/);
  assert.equal(splitDump('Meet Dana at 5 p.m. Tuesday').length, 1);
  assert.equal(splitDump('Ask Prof. Lee for an extension').length, 1);
  assert.equal(splitDump('Pick up 2 lbs. Roma tomatoes').length, 1);
  assert.equal(splitDump('Call the bank. Email Sam the invoice').length, 2);
});
test('K20 loading the examples never changes a real container', () => {
  const s = open(tmp()); const f = s.addArea({ name: 'Family', note: 'Our real note' }, T0);
  s.seedDemo(T0);
  assert.equal(f.note, 'Our real note'); assert.equal(f.wakeAt, null);
  const sd = s.addArea({ name: 'Someday' }, T0); s.clearDemo();
  assert.ok(s.db.areas.includes(sd));
});
test('K3 the same key from another assistant says so; C8 a light can be raised asleep until a date', () => {
  const s = open(tmp());
  msg(s, { key: 'thread-9', agent: 'claude:a' });
  msg(s, { key: 'thread-9', agent: 'claude:b' });
  assert.ok(s.warnings.some((w) => /another assistant/.test(w)));
  const l = msg(s, { title: 'Renew the domain', key: 'dom', sleep_until: '2026-12-01' });
  assert.ok(!s.view(T0).queue.includes(l.id));
});
test('D25 a missing data file with its log present refuses to start empty; D26 old reason tables are read; T28 a folder of another account is refused', () => {
  const dir = tmp(); const s = open(dir); msg(s); s.save();
  fs.unlinkSync(path.join(dir, 'data.json'));
  assert.throws(() => open(dir), /is missing, but its log/);
  const d2 = tmp(); fs.writeFileSync(path.join(d2, 'data.json'), JSON.stringify({ version: 3, areas: [{ id: 'shop', name: 'Shop', color: '#fff' }], lights: [], reasons: { shop: ['too long', 'too long'] } }));
  const s2 = open(d2); assert.doesNotThrow(() => s2.view(T0));
});
test('H5 a refused call on a board never saved leaves it empty', async () => {
  const { start } = require('../server');
  const a = await start({ port: 0, dir: tmp() });
  try {
    const r = await fetch(a.url + '/api/lights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ area: 'Second Typo', title: 't', draft: 'x'.repeat(5000) }) });
    assert.equal(r.status, 400);
    assert.equal(a.store.db.areas.length, 0);
  } finally { a.close(); }
});
test('B12 dates written other ways are whole days; a 2019 bare date is refused; d5 a file saying null is refused', () => {
  const s = open(tmp()); const l = msg(s);
  for (const v of ['11/20/2026', 'Nov 20, 2026', '2026/11/20']) { s.update(l.id, { due: v }, 'bot', T0); assert.equal(new Date(l.due).getHours(), 23, v); }
  s.update(l.id, { due: '2019-12-31' }, 'bot', T0); assert.ok(s.warnings.some((w) => /not a date/.test(w)));
  const d = tmp(); fs.writeFileSync(path.join(d, 'data.json'), 'null');
  assert.throws(() => open(d), /holds no board/);
});

test('#10 a rule that runs by itself never covers a money amount or a removal, and its offer shows real examples', () => {
  const s = open(tmp(), { random: () => 0.99 }); s.setting('autonomy', true);
  for (let i = 0; i < 10; i++) { const t = T0 + (i % 3) * DAY + i * 1000, l = s.raise({ area: 'Parks', title: 'Season ' + i, change_from: 'Open year-round', change_to: 'Closed Dec-Mar ' + i, action_type: 'park-update', agent: 'bot' }, t); s.act(l.id, 'approve', { rev: rev(l) }, t); }
  const offer = s.view(T0 + 3 * DAY).promote[0];
  assert.equal(offer.samples.length, 3); assert.match(offer.samples[0], /Open year-round/);
  s.promote('parks|park-update', true, T0 + 3 * DAY);
  const t = T0 + 4 * DAY;
  const fee = s.raise({ area: 'Parks', title: 'Fee', change_from: '$5', change_to: '$7', action_type: 'park-update', agent: 'bot' }, t);
  const gone = s.raise({ area: 'Parks', title: 'Remove trail', change_from: 'Bear Creek trail', change_to: '', action_type: 'park-update', agent: 'bot' }, t);
  const ok = s.raise({ area: 'Parks', title: 'Season again', change_from: 'Open year-round', change_to: 'Closed Jan-Feb', action_type: 'park-update', agent: 'bot' }, t);
  assert.equal(fee.decision, null, 'a price still asks');
  assert.equal(gone.decision, null, 'a removal still asks');
  assert.ok(ok.decision && ok.decision.by === 'auto');
});
test('Ask for changes: the assistant gets the draft it is about; its changed line and question are shown and do not replace the note; a redraft closes the request', () => {
  const s = open(tmp());
  const l = msg(s, { note: 'Job J-2291, installed Aug 22. He is upset.' });
  s.act(l.id, 'redo', { why: 'Mention the old controller model' }, T0);
  const d = s.decisions(T0 + HOLD_MS, { agent: 'bot' }).decisions[0];
  assert.equal(d.original_draft, 'Thursday works.'); assert.equal(d.draft_now, 'Thursday works.');
  s.update(l.id, { draft: 'Thursday works. We will swap the LC-200 controller for free.', changed: 'Named the LC-200 controller and the free swap', state: 'need_you', agent: 'bot' }, 'bot', T0 + HOLD_MS + 1);
  assert.equal(l.note, 'Job J-2291, installed Aug 22. He is upset.');
  assert.equal(l.changed, 'Named the LC-200 controller and the free swap');
  s.complete(l.id, 'done', '', T0 + HOLD_MS + 2, d.decision_id);
  assert.ok(s.warnings.some((w) => /already closed/.test(w)), 'a late report of the request is fine');
  s.act(l.id, 'approve', { rev: rev(l) }, T0 + HOLD_MS + 3);
  assert.equal(l.changed, '', 'cleared once the person decides');
});
