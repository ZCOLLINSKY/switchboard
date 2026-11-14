'use strict';
require('./fixtures/env'); // the same result whatever SWITCHBOARD_* settings the caller has
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open, DAY, PROMOTE_STREAK } = require('../lib/store');
const HOLD_MS = require('../lib/store').OUT_HOLD_MS; // the longest hold: messages to people

const fresh = () => open(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')));
const T0 = Date.UTC(2026, 0, 5, 15);

test('a new light needs you and is counted with a time', () => {
  const s = fresh();
  s.raise({ area: 'Shop', title: 'Reply to a customer', draft: 'Hi', seconds: 30 }, T0);
  const v = s.view(T0);
  assert.equal(v.counts.need_you, 1);
  assert.equal(v.seconds, 30);
  assert.equal(v.areas[0].name, 'Shop');
});

test('approving an outbound message turns it blue, and silence brings it back gold', () => {
  const s = fresh();
  const l = s.raise({ area: 'Shop', title: 'Text the lead', draft: 'Hello', outbound: true, follow_up_days: 3 }, T0);
  s.act(l.id, 'approve', {}, T0);
  assert.equal(s.view(T0).counts.approved, 1, 'approved, not yet sent');
  s.decisions(T0 + HOLD_MS, { all: true }); s.complete(l.id, 'sent', '', T0 + HOLD_MS);
  assert.equal(s.view(T0 + HOLD_MS).counts.waiting_them, 1);
  assert.equal(s.view(T0 + HOLD_MS).counts.need_you, 0);
  assert.equal(s.tick(T0 + 2 * DAY), false);
  assert.equal(s.tick(T0 + HOLD_MS + 3 * DAY + 1), true);
  const v = s.view(T0 + HOLD_MS + 3 * DAY + 1);
  assert.equal(v.counts.need_you, 1);
  assert.match(v.lights[0].title, /^Follow up: /);
  assert.equal(s.decisions().need_drafts.length, 1);
});

test('decisions are handed to agents once', () => {
  const s = fresh();
  const l = s.raise({ area: 'Shop', title: 'Fix typo', draft: 'Monthly' }, T0);
  s.act(l.id, 'approve', { text: 'Monthly plan' }, T0);
  const d = s.decisions().decisions;
  assert.equal(d.length, 1);
  assert.equal(d[0].edited, true);
  assert.equal(d[0].text, 'Monthly plan');
  assert.equal(d[0].original_draft, 'Monthly');
  assert.equal(s.ack([l.id]), 1);
  assert.equal(s.decisions().decisions.length, 0);
});

test('an edit resets the streak', () => {
  const s = fresh();
  const fix = () => s.raise({ area: 'Site', title: 'Fix', change_from: 'a', change_to: 'b', action_type: 't' }, T0);
  for (let i = 0; i < 5; i++) { const l = fix(); s.act(l.id, 'approve', { rev: s.view(T0).lights.find((x) => x.id === l.id).rev }, T0); }
  assert.equal(s.db.streaks['site|t'].n, 5);
  s.act(fix().id, 'no', {}, T0);
  assert.equal(s.db.streaks['site|t'], undefined);
});

test('snoozed lights leave the queue and come back; old gold lights are flagged stale', () => {
  const s = fresh();
  const l = s.raise({ area: 'Home', title: 'Call the dentist', kind: 'todo' }, T0);
  s.act(l.id, 'snooze', { days: 2 }, T0);
  assert.equal(s.view(T0).queue.length, 0);
  s.tick(T0 + 2 * DAY + 1);
  assert.equal(s.view(T0 + 2 * DAY + 1).queue.length, 1);
  assert.equal(s.view(T0 + 5 * DAY).lights[0].stale, true);
});

test('counts are rows (a batch is one row); broken lights are counted apart', () => {
  const s = fresh();
  s.raise({ area: 'Site', title: 'Outreach', state: 'waiting_them', batch: 6 }, T0);
  s.raise({ area: 'Site', title: 'Job failed', state: 'broken' }, T0);
  const v = s.view(T0);
  assert.equal(v.counts.waiting_them, 1);
  assert.equal(v.counts.broken, 1);
  assert.equal(v.queue.length, 1);
});

test('a sleeping area wakes with one light', () => {
  const s = fresh();
  s.addArea({ name: 'Someday', wake_at: T0 + DAY }, T0);
  assert.equal(s.tick(T0), false);
  assert.equal(s.tick(T0 + DAY + 1), true);
  assert.equal(s.view(T0 + DAY + 1).queue.length, 1);
});

test('a brain dump is filed under a matching area, else Inbox', () => {
  const s = fresh();
  s.addArea({ name: 'School' }, T0);
  assert.equal(s.dump('paper for school due Tuesday', T0)[0].area, 'school');
  assert.equal(s.dump('buy milk', T0)[0].area, 'inbox');
  assert.equal(s.decisions().unsorted.length, 2);
});

test('measured time replaces the default estimate', () => {
  const s = fresh();
  s.act(s.raise({ area: 'A', title: 'one', draft: 'x' }, T0).id, 'approve', { tookMs: 8000 }, T0);
  s.raise({ area: 'A', title: 'two', draft: 'x' }, T0);
  assert.equal(s.view(T0).seconds, 8);
});

test('data survives a restart and examples can be cleared', () => {
  const s = fresh();
  s.seedDemo(T0); s.raise({ area: 'Real', title: 'Mine' }, T0); s.save();
  const again = open(s.dir);
  assert.ok(again.view(T0).hasDemo);
  again.clearDemo();
  const v = again.view(T0);
  assert.equal(v.hasDemo, false);
  assert.equal(v.lights.length, 1);
  assert.deepEqual(v.areas.map((a) => a.name), ['Real']);
});

test('a damaged data file is reported, not overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  fs.writeFileSync(path.join(dir, 'data.json'), '{broken');
  assert.throws(() => open(dir), /Cannot read/);
  assert.equal(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'), '{broken');
});

const { splitDump } = require('../lib/store');

test('a fresh decision is held back, and can be undone until it is picked up', () => {
  const s = fresh();
  const l = s.raise({ area: 'Shop', title: 'Reply', draft: 'Hi', outbound: true, follow_up_days: 3, action_type: 'reply' }, T0);
  s.act(l.id, 'approve', {}, T0);
  assert.equal(s.decisions(T0 + 1000).decisions.length, 0, 'held back');
  s.act(l.id, 'undo', {}, T0 + 2000);
  assert.equal(s.view(T0 + 2000).queue.length, 1);
  assert.equal(s.decisions(T0 + HOLD_MS).decisions.length, 0, 'an undone decision never reaches an assistant');
  s.act(l.id, 'approve', {}, T0 + 3000);
  assert.equal(s.decisions(T0 + 3000 + HOLD_MS).decisions.length, 1);
  assert.throws(() => s.act(l.id, 'undo', {}, T0 + 3000 + HOLD_MS + 1), /Too late/);
});

test('the queue puts deadlines first, then people waiting, then the rest by age, then background failures', () => {
  const s = fresh();
  s.raise({ area: 'A', title: 'old chore', kind: 'todo' }, T0 - 5 * DAY);
  s.raise({ area: 'A', title: 'reply to a person', draft: 'x', outbound: true }, T0 - DAY);
  s.raise({ area: 'A', title: 'small quote', draft: 'x', value: 500 }, T0);
  s.raise({ area: 'A', title: 'big quote', draft: 'x', value: 9000 }, T0);
  s.raise({ area: 'A', title: 'job failed', state: 'broken' }, T0);
  s.raise({ area: 'A', title: 'form due tonight', kind: 'todo', due: T0 + 3600e3 }, T0);
  const v = s.view(T0);
  assert.deepEqual(v.queue.map((id) => v.lights.find((l) => l.id === id).title), ['form due tonight', 'reply to a person', 'old chore', 'small quote', 'big quote', 'job failed']);
});

test('bulk approve works for changes and refuses messages to people', () => {
  const s = fresh();
  const ids = [1, 2, 3].map((i) => s.raise({ area: 'A', title: 'fix ' + i, draft: 'x', action_type: 'fix' }, T0).id);
  assert.equal(s.bulk(ids, 'approve', { tookMs: 9000 }, T0).length, 3);
  assert.equal(s.view(T0).queue.length, 0);
  assert.equal(s.db.streaks['a|fix'], undefined, 'bulk taps earn no trust');
  const msg = s.raise({ area: 'A', title: 'email', draft: 'x', outbound: true }, T0);
  assert.throws(() => s.bulk([msg.id], 'approve', {}, T0), /one at a time/);
});

test('a dump with several things in it becomes several lights', () => {
  assert.deepEqual(splitDump('Text Ben back about the transformer, pay the tuition fee, and fix the landing page bug'),
    ['Text Ben back about the transformer', 'Pay the tuition fee', 'Fix the landing page bug']);
  assert.deepEqual(splitDump('salt and pepper for the party'), ['Salt and pepper for the party']);
  assert.deepEqual(splitDump('order lights\ncall the school'), ['Order lights', 'Call the school']);
  const s = fresh();
  assert.equal(s.dump('pay the bill and book the dentist', T0).length, 2);
});

test('snooze can target a time', () => {
  const s = fresh();
  const l = s.raise({ area: 'A', title: 'later', kind: 'todo' }, T0);
  s.act(l.id, 'snooze', { until: T0 + 5 * 3600e3 }, T0);
  assert.equal(s.view(T0 + 4 * 3600e3).queue.length, 0);
  s.tick(T0 + 5 * 3600e3 + 1);
  assert.equal(s.view(T0 + 5 * 3600e3 + 1).queue.length, 1);
});

test('an automatic approval that breaks loses its autonomy', () => {
  const s = open(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')), { random: () => 0.99 });
  s.setting('autonomy', true);
  s.db.auto['a|fix'] = { since: T0, runs: 10, paused: false, recent: [], hour: [] };
  const l = s.raise({ area: 'A', title: 'fix', change_from: 'a', change_to: 'b', action_type: 'fix' }, T0);
  assert.equal(l.decision.by, 'auto');
  s.update(l.id, { state: 'broken', reason: 'the change failed' }, 'agent', T0);
  assert.equal(s.view(T0).autonomy.rules.length, 0);
});

test('history answers "did I ever do that?"', () => {
  const s = fresh();
  s.act(s.raise({ area: 'House', title: 'Renew the insurance policy', kind: 'decide', options: ['Accept'] }, T0).id, 'answer', { value: 'Accept' }, T0);
  s.act(s.raise({ area: 'House', title: 'Water bill', kind: 'todo' }, T0).id, 'done', {}, T0);
  assert.equal(s.history('insurance').length, 1);
  assert.match(s.history('insurance')[0].what, /Accept/);
  assert.equal(s.history('').length, 2);
});

// A relay (one assistant that carries the person's answers to another list) needs to take over lights raised with no
// name, and to see what is waiting without collecting it.
{
  const { HOLD_MS, OUT_HOLD_MS, CLAIM_MS } = require('../lib/store');
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbrelay-'));
  const T0 = new Date(2026, 10, 16, 10, 0, 0).getTime();
test('a light raised with no name can be adopted, and then only its owner collects it', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Yes or no: open Sunday?', kind: 'decide', options: ['Yes', 'No'], key: 'board:sunday' }, T0);
  assert.equal(l.agent, '');
  s.update(l.id, { adopt: true, agent: 'relay' }, 'relay', T0 + 1);
  assert.equal(s.db.lights[0].agent, 'relay');
  assert.deepEqual(s.warnings, [], 'adopt is a known field');
  s.act(l.id, 'answer', { value: 'Yes' }, T0 + 2);
  const other = s.decisions(T0 + 2 + HOLD_MS + 1, { agent: 'claude-code:test~ab12' });
  assert.equal(other.decisions.length, 0, 'another session is not handed it');
  const mine = s.decisions(T0 + 2 + HOLD_MS + 1, { agent: 'relay' });
  assert.equal(mine.decisions.length, 1);
  assert.equal(mine.decisions[0].value, 'Yes');
  assert.equal(mine.decisions[0].key, 'board:sunday');
});

test('the same key raised by the owner after adopting updates that light, not a second one', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Old title', key: 'board:x' }, T0);
  s.update(l.id, { adopt: true, agent: 'relay' }, 'relay', T0 + 1);
  const again = s.raise({ area: 'Shop', title: 'New title', key: 'board:x', agent: 'relay' }, T0 + 2);
  assert.equal(again.id, l.id);
  assert.equal(s.db.lights.length, 1);
  assert.equal(s.db.lights[0].title, 'New title');
});

test('adopting is refused for a light another assistant owns, for the person\'s own note, without a name, and while a decision is out', () => {
  const s = open(tmp());
  const theirs = s.raise({ area: 'Shop', title: 'Theirs', agent: 'bot' }, T0);
  assert.throws(() => s.update(theirs.id, { adopt: true, agent: 'relay' }, 'relay', T0 + 1), /belongs to bot/);
  assert.equal(theirs.agent, 'bot');
  const nameless = s.raise({ area: 'Shop', title: 'Nameless' }, T0);
  assert.throws(() => s.update(nameless.id, { adopt: true }, 'agent', T0 + 1), /Say who/);
  const own = s.dump('call the plumber', T0)[0];
  assert.throws(() => s.update(own.id, { adopt: true, agent: 'relay' }, 'relay', T0 + 1), /own note/);
  const asked = s.raise({ area: 'Shop', title: 'Yes or no: paint it blue?', kind: 'decide', options: ['Yes', 'No'] }, T0);
  s.act(asked.id, 'answer', { value: 'No' }, T0 + 1);
  assert.throws(() => s.update(asked.id, { adopt: true, agent: 'relay' }, 'relay', T0 + 2), /decided/);
  assert.equal(asked.agent, '');
});

test('collecting with only:true hands out the caller\'s own lights and never ones raised for anyone', () => {
  const s = open(tmp());
  const mine = s.raise({ area: 'Shop', title: 'Yes or no: mine?', kind: 'decide', options: ['Yes', 'No'], agent: 'relay' }, T0);
  const anyone = s.raise({ area: 'Shop', title: 'Yes or no: anyone?', kind: 'decide', options: ['Yes', 'No'] }, T0);
  s.act(mine.id, 'answer', { value: 'Yes' }, T0); s.act(anyone.id, 'answer', { value: 'No' }, T0);
  const t = T0 + HOLD_MS + 1;
  assert.deepEqual(s.pending(t, { agent: 'relay', only: true }).decisions, 1);
  const got = s.decisions(t, { agent: 'relay', only: true });
  assert.deepEqual(got.decisions.map((d) => d.id), [mine.id]);
  assert.equal(s.db.lights.find((l) => l.id === anyone.id).decision.collectedAt, null, 'the light for anyone is left for its assistant');
  assert.equal(s.decisions(t + 1, { agent: 'someone' }).decisions.length, 1, 'and without only, it is still anyone\'s');
});
test('nothing is handed out or counted while the person is asked whether it went out', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Approve the change', change_from: 'a', change_to: 'b', agent: 'bot' }, T0);
  s.act(l.id, 'approve', {}, T0);
  const t1 = T0 + HOLD_MS + 1;
  assert.equal(s.decisions(t1, { agent: 'bot' }).decisions.length, 1);
  s.tick(t1 + CLAIM_MS + 1); // collected, never reported: the person is asked
  assert.equal(l.unreported, true);
  assert.equal(s.decisions(t1 + CLAIM_MS + 2, { agent: 'bot' }).decisions.length, 0, 'not handed out again until the person answers');
  assert.equal(s.pending(t1 + CLAIM_MS + 2, { agent: 'bot' }).decisions, 0);
});
test('adopt is refused while a send is being checked with the person, and when it would make two lights with one key', () => {
  const s = open(tmp());
  const a = s.raise({ area: 'Shop', title: 'Change it', change_from: 'a', change_to: 'b', key: 'k1' }, T0);
  s.act(a.id, 'approve', {}, T0);
  s.decisions(T0 + HOLD_MS + 1, { agent: 'bot' });
  s.complete(a.id, 'unsure', 'not sure it went', T0 + HOLD_MS + 2, a.decision.id);
  assert.throws(() => s.update(a.id, { adopt: true, agent: 'relay' }, 'relay', T0 + HOLD_MS + 3), /not been settled/);
  s.raise({ area: 'Shop', title: 'Mine', key: 'k2', agent: 'relay' }, T0);
  const twin = s.raise({ area: 'Shop', title: 'Nameless twin', key: 'k2' }, T0);
  assert.throws(() => s.update(twin.id, { adopt: true, agent: 'relay' }, 'relay', T0 + 1), /already has an open light/);
});
test('raising again with the same key and adopt:true is not refused', () => {
  const s = open(tmp());
  s.raise({ area: 'Shop', title: 'Mine', key: 'k', agent: 'relay' }, T0);
  const again = s.raise({ area: 'Shop', title: 'Mine, reworded', key: 'k', agent: 'relay', adopt: true }, T0 + 1);
  assert.equal(again.title, 'Mine, reworded');
});
test('adopting again by the owner is a quiet no-op', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Mine', agent: 'relay' }, T0);
  s.update(l.id, { adopt: true, agent: 'relay' }, 'relay', T0 + 1);
  assert.equal(l.agent, 'relay');
  assert.deepEqual(s.warnings, []);
});

test('pending counts what is waiting for an assistant without collecting it', () => {
  const s = open(tmp());
  const a = s.raise({ area: 'Shop', title: 'Yes or no: A?', kind: 'decide', options: ['Yes', 'No'], agent: 'relay' }, T0);
  const b = s.raise({ area: 'Shop', title: 'Text Dale', draft: 'Hi Dale', phone: '+15555550100', channel: 'sms', follow_up_days: 3, agent: 'relay' }, T0);
  s.raise({ area: 'Shop', title: 'Not mine', kind: 'decide', options: ['Yes', 'No'], agent: 'bot' }, T0);
  s.act(a.id, 'answer', { value: 'Yes' }, T0);
  s.act(b.id, 'approve', { rev: undefined }, T0);
  let p = s.pending(T0 + 1, { agent: 'relay' });
  assert.equal(p.decisions, 0, 'still inside the hold');
  assert.equal(p.held, 1);
  assert.ok(p.next_release_at > T0);
  p = s.pending(T0 + Math.max(HOLD_MS, OUT_HOLD_MS) + 1, { agent: 'relay' });
  assert.equal(p.decisions, 1);
  assert.equal(p.sent_by_you, 1);
  // Looking twice changes nothing: the same counts, and the decision can still be taken back.
  const again = s.pending(T0 + Math.max(HOLD_MS, OUT_HOLD_MS) + 2, { agent: 'relay' });
  assert.deepEqual(again, Object.assign({}, p, { now: again.now }));
  assert.equal(s.db.lights.find((l) => l.id === a.id).decision.collectedAt, null);
  const got = s.decisions(T0 + Math.max(HOLD_MS, OUT_HOLD_MS) + 3, { agent: 'relay' });
  assert.equal(got.decisions.length, 1);
  assert.equal(got.sent_by_you.length, 1);
  p = s.pending(T0 + Math.max(HOLD_MS, OUT_HOLD_MS) + 4, { agent: 'relay' });
  assert.equal(p.decisions, 0, 'claimed: not counted again');
  assert.equal(p.sent_by_you, 0, 'told once');
  assert.equal(p.unreported, 1, 'collected and not yet reported');
  p = s.pending(T0 + Math.max(HOLD_MS, OUT_HOLD_MS) + CLAIM_MS + 10, { agent: 'relay' });
  assert.equal(p.decisions, 1, 'a lapsed claim is waiting again');
});
}

test('waiting on another session\'s light says whose it is instead of waiting for nothing', () => {
  const s = open(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')), { holdMs: 0 });
  const l = s.raise({ area: 'Shop', title: 'Which size?', kind: 'decide', options: ['S', 'L'], agent: 'claude-code:shop~1a2b' }, T0);
  assert.equal(s.notYours(l.id, { agent: 'claude-code:home~9f9f' }), 'raised by another session, or under a project this call does not name; only a session with that light\'s name can collect it');
  assert.equal(s.notYours(l.id, { agent: 'claude-code:shop~1a2b' }), '');
  assert.equal(s.notYours(l.id, { agent: 'other', all: true }), '', 'one told to take over may');
  const anyone = s.raise({ area: 'Shop', title: 'Pick a color', kind: 'decide', options: ['Red', 'Blue'] }, T0);
  assert.equal(s.notYours(anyone.id, { agent: 'other' }), '', 'a light raised with no name is anyone\'s');
});

test('raising the same thing again with no key returns the open light instead of a second one', () => {
  const s = fresh();
  const a = s.raise({ area: 'Shop', title: 'Send the Henderson quote', draft: 'Hi Dale, the quote is $1,200.', to: 'Dale', value: 1200, agent: '' }, T0);
  const b = s.raise({ area: 'Shop', title: 'Send the Henderson quote', draft: 'Hi Dale, the quote is $1,200.', to: 'Dale', value: 1200, agent: '' }, T0 + 1000);
  assert.equal(b.id, a.id);
  assert.match(s.warnings.join(' '), new RegExp(`already open \\(${a.id}\\)`));
  assert.equal(s.db.lights.length, 1, 'one light, so "$1,200 in play", not $2,400');
  // Different words, another container, or a finished light: a new light.
  assert.notEqual(s.raise({ area: 'Shop', title: 'Send the Henderson quote', draft: 'Hi Dale, the quote is $1,300.', to: 'Dale' }, T0).id, a.id);
  assert.notEqual(s.raise({ area: 'Side', title: 'Send the Henderson quote', draft: 'Hi Dale, the quote is $1,200.', to: 'Dale' }, T0).id, a.id);
  const c = s.raise({ area: 'Shop', title: 'Order boxes', kind: 'todo', agent: 'bot' }, T0);
  s.update(c.id, { state: 'done' }, 'bot', T0);
  assert.notEqual(s.raise({ area: 'Shop', title: 'Order boxes', kind: 'todo', agent: 'bot' }, T0).id, c.id);
  // Another assistant's identical light stays its own; the new one is separate, and says so.
  const d = s.raise({ area: 'Shop', title: 'Renew the domain', kind: 'todo', agent: 'one' }, T0);
  const e = s.raise({ area: 'Shop', title: 'Renew the domain', kind: 'todo', agent: 'two' }, T0);
  assert.notEqual(e.id, d.id);
  assert.match(s.warnings.join(' '), /another assistant \(one\)/);
  // The person typing the same note twice gets two notes: only assistants' raises are matched.
  assert.equal(s.dump('Call the dentist').length + s.dump('Call the dentist').length, 2);
  assert.equal(s.db.lights.filter((l) => l.title === 'Call the dentist').length, 2);
  // A kind of job that repeats (an action_type) is never matched: eight identical fixes are eight.
  const f1 = s.raise({ area: 'Site', title: 'Fix a listing', change_from: 'a', change_to: 'b', action_type: 'listing-fix' }, T0);
  assert.notEqual(s.raise({ area: 'Site', title: 'Fix a listing', change_from: 'a', change_to: 'b', action_type: 'listing-fix' }, T0).id, f1.id);
});

test('an approval on a board no assistant has checked in on today waits instead of turning red', () => {
  const MIN = 60e3, s = fresh();
  const l = s.raise({ area: 'Shop', title: 'Send the quote', draft: 'Hi Dale, the quote is attached.', to: 'Dale', agent: 'desk' }, T0);
  s.act(l.id, 'approve', { rev: s.view(T0).lights[0].rev }, T0);
  assert.equal(s.tick(T0 + 3 * 60 * MIN), false, 'no assistant has asked for decisions: nothing turns red');
  assert.equal(l.state, 'approved'); assert.equal(l.stuck, false);
  const shown = s.view(T0 + 3 * 60 * MIN).lights[0];
  assert.equal(shown.waitingCheckIn, true);
  assert.match(shown.alert, /Waiting for an assistant to check in/);
  assert.match(shown.alert, /check my Switchboard/);
  // An assistant checks in (another one: it collects nothing here). From then on today's rule applies.
  assert.equal(s.decisions(T0 + 3 * 60 * MIN, { agent: 'someone-else' }).decisions.length, 0);
  assert.equal(s.view(T0 + 3 * 60 * MIN).lights[0].waitingCheckIn, false);
  assert.equal(s.tick(T0 + 3 * 60 * MIN + 1000), true);
  assert.equal(l.state, 'broken'); assert.equal(l.stuck, true);
  assert.match(s.view(T0 + 3 * 60 * MIN + 1000).lights[0].alert, /No assistant has collected it/);
});

test('an assistant that checked in today makes an approval nobody collects turn red after 15 minutes; a day later it waits again', () => {
  const MIN = 60e3, s = fresh();
  s.decisions(T0, { agent: 'bot' }); // checks in, nothing to collect yet
  const a = s.raise({ area: 'Shop', title: 'Fix the price', change_from: '$10', change_to: '$12', agent: 'other' }, T0);
  s.act(a.id, 'approve', { rev: s.view(T0).lights[0].rev }, T0);
  assert.equal(s.tick(T0 + 10 * MIN), false);
  assert.equal(s.tick(T0 + 16 * MIN), true, 'the usual 15 minutes');
  assert.equal(a.stuck, true);
  // More than a day since anyone checked in: the next approval waits.
  const t = T0 + 2 * DAY, b = s.raise({ area: 'Shop', title: 'Fix the hours', change_from: '9', change_to: '10', agent: 'other' }, t);
  s.act(b.id, 'approve', { rev: s.view(t).lights.find((x) => x.id === b.id).rev }, t);
  s.tick(t + 60 * MIN);
  assert.equal(b.state, 'approved');
  assert.match(s.view(t + 60 * MIN).lights.find((x) => x.id === b.id).alert, /Waiting for an assistant to check in/);
});
