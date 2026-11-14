'use strict';
// Batch 7: the deep dig (ten lanes, Nov 13-14). Ids are the lanes' own: F fuzzing, B newest code, U a day of use, G page, K docs.
require('./fixtures/env'); // the same result whatever SWITCHBOARD_* settings the caller has
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, rev, DAY, OUT_HOLD_MS, CLAIM_MS } = require('../lib/store');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb7-'));
const T0 = new Date(2026, 10, 16, 10, 0, 0).getTime(), HOLD = OUT_HOLD_MS + 1000;
const msg = (s, extra, now = T0) => s.raise(Object.assign({ area: 'Shop', title: 'Reply to Dale', draft: 'The total is $1,450.', to: 'dale@old.example', key: 'thread-1', follow_up_days: 3, agent: 'bot' }, extra), now);
const sendFails = (s, outcome = 'failed') => {
  const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  const d = s.decisions(T0 + HOLD, { agent: 'bot' }).decisions[0];
  s.complete(l.id, outcome, 'mailbox full', T0 + HOLD + 1000, d.decision_id);
  return { l, d };
};

test('F1 a typed answer on "Keep going?" does not switch automatic approval back on', () => {
  const s = open(tmp(), { random: () => 0.99 }); s.setting('autonomy', true);
  for (let i = 0; i < 10; i++) { const t = T0 + (i % 3) * DAY + i * 1000, l = s.raise({ area: 'Site', title: 'Price ' + i, change_from: '$' + i, change_to: '$' + (i + 1), action_type: 'price', agent: 'bot' }, t); s.act(l.id, 'approve', { rev: rev(l) }, t); }
  s.promote('site|price', true, T0 + 3 * DAY);
  let t = T0 + 4 * DAY; for (let i = 0; i < 26; i++) s.raise({ area: 'Site', title: 'Auto ' + i, change_from: 'a', change_to: 'b' + i, action_type: 'price', agent: 'bot' }, t + i);
  const brake = s.db.lights.find((l) => l.brake);
  assert.ok(brake && s.db.auto['site|price'].paused);
  assert.throws(() => s.act(brake.id, 'answer', { text: 'no, stop this' }, t + 100), /Pick one of the buttons/);
  assert.throws(() => s.act(brake.id, 'answer', { value: 'turn it off' }, t + 100), /Pick one of the buttons/);
  assert.equal(s.db.auto['site|price'].paused, true, 'still paused');
  const next = s.raise({ area: 'Site', title: 'After', change_from: '$10', change_to: '$99', action_type: 'price', agent: 'bot' }, t + 200);
  assert.equal(next.decision, null, 'waits for the person');
});

test('F3 typed answers on "not sure it went out" and "keep chasing?" are refused, not read as a button', () => {
  const s = open(tmp());
  const { l } = sendFails(s, 'unsure');
  assert.throws(() => s.act(l.id, 'answer', { text: 'yes it went out, I can see it in Sent' }, T0 + 2 * HOLD), /Pick one of the buttons: It went out, It did not go out/);
  assert.equal(l.state, 'broken');
  s.act(l.id, 'answer', { value: 'It went out' }, T0 + 2 * HOLD);
  assert.equal(l.state, 'waiting_them');
});

test('F2 the approved change travels with the decision and stays frozen until it is reported', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Site', title: 'Opening hours', change_from: 'Opens 9 am', change_to: 'Opens 10 am', key: 'hours', agent: 'bot' }, T0);
  s.act(l.id, 'approve', { rev: rev(l) }, T0);
  const d = s.decisions(T0 + 30000, { agent: 'bot' }).decisions[0];
  assert.deepEqual([d.change_from, d.change_to], ['Opens 9 am', 'Opens 10 am']);
  assert.throws(() => s.raise({ area: 'Site', title: 'Opening hours', change_to: 'Opens 11 am', key: 'hours', agent: 'bot' }, T0 + 31000), /has not reported back/);
  assert.equal(l.changeTo, 'Opens 10 am');
  assert.match(s.history('hours')[0].text, /Opens 9 am → Opens 10 am/);
  s.complete(l.id, 'done', '', T0 + 32000, d.decision_id);
  assert.equal(l.state, 'done');
});

test('B3 a customer message that arrives mid-send is refused until the send is reported, then comes back to the person', () => {
  const s = open(tmp());
  const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  const d = s.decisions(T0 + HOLD, { agent: 'bot' }).decisions[0];
  assert.throws(() => msg(s, { source: 'Dale: actually, cancel it', draft: 'Understood, cancelled.' }, T0 + HOLD + 1000), /Report it with complete_decision first/);
  s.complete(l.id, 'sent', '', T0 + HOLD + 2000, d.decision_id);
  assert.equal(l.state, 'waiting_them');
  msg(s, { source: 'Dale: actually, cancel it', draft: 'Understood, cancelled.' }, T0 + HOLD + 3000);
  assert.equal(l.state, 'need_you', 'the reply is in front of the person');
  assert.equal(l.draft, 'Understood, cancelled.');
});

test('B21 a corrected draft or address on a failed card makes a new request; "Try again" can never send words the card no longer shows', () => {
  const s = open(tmp());
  const { l, d } = sendFails(s);
  assert.equal(l.state, 'broken');
  msg(s, { draft: 'The total is $1,850.', to: 'dale@new.example' }, T0 + 2 * HOLD);
  assert.ok(s.warnings.some((w) => /new request/.test(w)));
  assert.equal(l.state, 'need_you');
  assert.equal(l.failure, '');
  assert.equal(l.decision, null);
  assert.throws(() => s.act(l.id, 'answer', { value: 'Try again' }, T0 + 2 * HOLD + 1), /needs an approval, not an answer/);
  s.act(l.id, 'approve', { rev: rev(l) }, T0 + 2 * HOLD + 2);
  const again = s.decisions(T0 + 4 * HOLD, { agent: 'bot' }).decisions[0];
  assert.notEqual(again.decision_id, d.decision_id);
  assert.deepEqual([again.text, again.to], ['The total is $1,850.', 'dale@new.example']);
});
test('B21 while the person is asked "did it go out?", the thread waits for their answer', () => {
  const s = open(tmp());
  const { l } = sendFails(s, 'unsure');
  assert.throws(() => msg(s, { draft: 'Second try' }, T0 + 2 * HOLD), /Wait for their answer/);
  assert.equal(l.unsure, true);
});

test('B4 a question asked on a failed card replaces the failure, and the answer reaches the assistant', () => {
  const s = open(tmp());
  const { l } = sendFails(s);
  msg(s, { title: 'Which address is right?', kind: 'decide', options: ['dale@old.example', 'dale@new.example'], draft: '' }, T0 + 2 * HOLD);
  assert.deepEqual(l.options, ['dale@old.example', 'dale@new.example']);
  s.act(l.id, 'answer', { value: 'dale@new.example' }, T0 + 2 * HOLD + 1);
  const got = s.decisions(T0 + 3 * HOLD, { agent: 'bot' }).decisions[0];
  assert.equal(got.value, 'dale@new.example');
});

test('B2 a reply on a "Keep chasing?" card becomes something to approve, not an erased draft', () => {
  const s = open(tmp());
  const l = msg(s, { state: 'waiting_them', draft: '' });
  for (let i = 1; i <= 3; i++) {
    s.tick(T0 + i * 4 * DAY);
    if (l.chase) break;
    s.update(l.id, { draft: 'Just checking in.' }, 'bot', T0 + i * 4 * DAY + 1);
    s.act(l.id, 'approve', { rev: rev(l) }, T0 + i * 4 * DAY + 2);
    const d = s.decisions(T0 + i * 4 * DAY + HOLD, { agent: 'bot' }).decisions[0];
    s.complete(l.id, 'sent', '', T0 + i * 4 * DAY + HOLD + 1, d.decision_id);
  }
  assert.equal(l.chase, true);
  msg(s, { source: 'Dale: yes, go ahead', draft: 'Great, booking you in.' }, T0 + 20 * DAY);
  assert.equal(l.chase, false);
  assert.equal(l.kind, 'approve');
  assert.doesNotMatch(l.title, /Keep chasing/);
  s.act(l.id, 'approve', { rev: rev(l) }, T0 + 20 * DAY + 1);
  assert.equal(s.decisions(T0 + 20 * DAY + HOLD, { agent: 'bot' }).decisions[0].text, 'Great, booking you in.');
});

test('K4 the person\'s own note, drafted by an assistant, is handed to that assistant once approved', () => {
  const s = open(tmp());
  const [n] = s.dump('email the landlord about the leak', T0);
  s.update(n.id, { draft: 'Hi, the kitchen tap is leaking again.', to: 'Landlord', agent: 'bot' }, 'bot', T0 + 1000);
  assert.equal(n.own, false);
  s.act(n.id, 'approve', { rev: rev(n) }, T0 + 2000);
  const d = s.decisions(T0 + 2000 + HOLD, { agent: 'bot' }).decisions[0];
  assert.equal(d && d.text, 'Hi, the kitchen tap is leaking again.');
});
