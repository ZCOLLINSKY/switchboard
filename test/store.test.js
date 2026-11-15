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

test('the queue pins broken jobs first, then deadlines, then money and people waiting, then the rest by age', () => {
  const s = fresh();
  s.raise({ area: 'A', title: 'old chore', kind: 'todo' }, T0 - 5 * DAY);
  s.raise({ area: 'A', title: 'reply to a person', draft: 'x', outbound: true }, T0 - DAY);
  s.raise({ area: 'A', title: 'small quote', draft: 'x', value: 500 }, T0);
  s.raise({ area: 'A', title: 'big quote', draft: 'x', value: 9000 }, T0);
  s.raise({ area: 'A', title: 'job failed', state: 'broken' }, T0);
  s.raise({ area: 'A', title: 'form due tonight', kind: 'todo', due: T0 + 3600e3 }, T0);
  const v = s.view(T0);
  assert.deepEqual(v.queue.map((id) => v.lights.find((l) => l.id === id).title), ['job failed', 'form due tonight', 'big quote', 'small quote', 'reply to a person', 'old chore']);
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
  const l = s.raise({ area: 'Shop', title: 'Send the quote', draft: 'Hi Dale, the quote is attached.', to: 'Dale', agent: 'claude-desktop' }, T0);
  s.act(l.id, 'approve', { rev: s.view(T0).lights[0].rev }, T0);
  assert.equal(s.tick(T0 + 3 * 60 * MIN), false, 'no assistant has asked for decisions: nothing turns red');
  assert.equal(l.state, 'approved'); assert.equal(l.stuck, false);
  const shown = s.view(T0 + 3 * 60 * MIN).lights[0];
  assert.equal(shown.waitingCheckIn, true);
  assert.match(shown.alert, /Waiting for claude-desktop to check in/);
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
  assert.match(s.view(t + 60 * MIN).lights.find((x) => x.id === b.id).alert, /Waiting for other to check in/);
});

test('an empty collection says what is still in the undo window, and what is ready for other sessions', () => {
  const s = open(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')));
  const HOLD = require('../lib/store').HOLD_MS;
  const mine = s.raise({ area: 'Shop', title: 'Which size?', kind: 'decide', options: ['S', 'L'], agent: 'claude-code:shop~1a2b' }, T0);
  const theirs = s.raise({ area: 'Home', title: 'Which colour?', kind: 'decide', options: ['Red', 'Blue'], agent: 'claude-code:home~9f9f' }, T0);
  s.act(mine.id, 'answer', { value: 'L' }, T0); s.act(theirs.id, 'answer', { value: 'Red' }, T0 - HOLD);
  const early = s.decisions(T0 + 1000, { agent: 'claude-code:shop~1a2b' });
  assert.deepEqual(early.decisions, []);
  assert.equal(early.held, 1);
  assert.equal(early.next_release_at, new Date(T0 + HOLD).toISOString());
  assert.equal(early.ready_for_other_sessions, 1, 'counted, never handed over');
  assert.equal(s.db.lights.find((l) => l.id === theirs.id).decision.collectedAt, null);
  const later = s.decisions(T0 + HOLD, { agent: 'claude-code:shop~1a2b' });
  assert.deepEqual(later.decisions.map((d) => d.id), [mine.id]);
  assert.ok(!('held' in later) && !('next_release_at' in later), 'nothing held: not mentioned');
  assert.ok(!('ready_for_other_sessions' in s.decisions(T0 + HOLD, { agent: 'x', all: true })), 'one that takes everything has no others');
});

test('an approval only one program can collect names that program, instead of asking for a chat that cannot collect it', () => {
  const MIN = 60e3, s = fresh();
  const relay = s.raise({ area: 'Board', title: 'Order flyers', draft: 'Order 500 flyers', kind: 'approve', key: 'board:r12', agent: 'owners-board' }, T0);
  const anyone = s.raise({ area: 'Shop', title: 'Order boxes', draft: 'Order 20 boxes', kind: 'approve' }, T0);
  for (const l of [relay, anyone]) s.act(l.id, 'approve', { rev: s.view(T0).lights.find((x) => x.id === l.id).rev }, T0);
  const shown = (id) => s.view(T0 + 17 * MIN).lights.find((x) => x.id === id);
  assert.equal(shown(relay.id).alert, 'Waiting for owners-board to check in. Only it can collect this one.');
  assert.doesNotMatch(shown(relay.id).alert, /Start a chat/);
  assert.match(shown(anyone.id).alert, /^Waiting for an assistant to check in\. Start a chat and say/);
});

test('money sits with the people waiting: a Stripe step or an invoice rises above other questions', () => {
  const s = fresh();
  s.raise({ area: 'A', title: 'Pick a font', kind: 'decide', options: ['A', 'B'] }, T0 - 3 * DAY);
  s.raise({ area: 'A', title: 'Turn off the old pay links in Stripe', kind: 'todo', link: 'https://x' }, T0);
  s.raise({ area: 'A', title: 'Fix jobs with no invoice link', kind: 'decide', options: ['Yes', 'No'] }, T0 - DAY);
  const v = s.view(T0);
  assert.deepEqual(v.queue.map((id) => v.lights.find((l) => l.id === id).title), ['Fix jobs with no invoice link', 'Turn off the old pay links in Stripe', 'Pick a font']);
});

test('a session that names no container files its light under its project, never Inbox, when the board has one', () => {
  const s = fresh();
  s.addArea({ name: 'Around Lex' });
  assert.equal(s.raise({ title: 'one', agent: 'claude-code:around-lex' }, T0).area, 'around-lex');
  assert.equal(s.raise({ area: 'Inbox', title: 'two', agent: 'claude-code:around-lex~1a2b' }, T0).area, 'around-lex');
  assert.equal(s.raise({ area: 'Inbox', title: 'three', agent: 'claude-code:nowhere' }, T0).area, 'inbox');
  assert.equal(s.raise({ area: 'Other', title: 'four', agent: 'claude-code:around-lex' }, T0).area, 'other');
});

test('the project container is skipped while it sleeps, and raising again with Inbox gives no false warning', () => {
  const s = fresh();
  s.addArea({ name: 'Around Lex' });
  const one = s.raise({ title: 'one', key: 'k1', agent: 'claude-code:around-lex' }, T0);
  assert.equal(one.area, 'around-lex');
  s.raise({ area: 'Inbox', title: 'one again', key: 'k1', agent: 'claude-code:around-lex' }, T0 + 1000);
  assert.ok(!(s.warnings || []).some((w) => /area cannot be changed/.test(w)), 'no false warning');
  s.db.areas.find((a) => a.id === 'around-lex').wakeAt = T0 + DAY;
  assert.equal(s.raise({ title: 'two', agent: 'claude-code:around-lex' }, T0).area, 'inbox', 'a sleeping container would hide it');
});

test('at equal money, a person waiting comes before a money step', () => {
  const s = fresh();
  s.raise({ area: 'A', title: 'Turn off the old pay links in Stripe', kind: 'todo', link: 'https://x' }, T0 - DAY);
  s.raise({ area: 'A', title: 'reply to a person', draft: 'x', outbound: true }, T0);
  const v = s.view(T0);
  assert.deepEqual(v.queue.map((id) => v.lights.find((l) => l.id === id).title), ['reply to a person', 'Turn off the old pay links in Stripe']);
});

test('texts to the phone are off on a new board and on a board from before, and the switch is remembered', () => {
  const s = fresh();
  assert.equal(s.view(T0).texts, false, 'a new board: off until the person turns them on');
  s.setting('texts', true); s.save();
  assert.equal(open(s.dir).view(T0).texts, true, 'remembered');
  // A board saved before this setting existed (no texts key): off too, until the person turns them on (Nov 15: texts
  // to his phone are off by default).
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  fs.writeFileSync(path.join(old, 'data.json'), JSON.stringify({ version: 3, areas: [], lights: [], settings: {} }));
  assert.equal(open(old).view(T0).texts, false);
  s.setting('texts', false);
  assert.equal(s.view(T0).texts, false);
  assert.throws(() => s.setting('texts', 'off'), /true or false/);
  assert.throws(() => s.setting('volume', true), /Unknown setting/);
});

test('setup\'s attention question: the person\'s tap sets banners and texts, and Undo puts them back', () => {
  const { rev, ATTENTION_KEY, ATTENTION_OPTIONS } = require('../lib/store');
  const s = fresh();
  assert.equal(s.view(T0).banners, null, 'unset: the board follows how it was started');
  const ask = () => s.raise({ title: 'How should it get your attention?', kind: 'decide', key: ATTENTION_KEY, options: ATTENTION_OPTIONS, recommended: ATTENTION_OPTIONS[0] }, T0);
  let l = ask();
  s.act(l.id, 'answer', { value: 'A banner on this computer', rev: rev(l) }, T0);
  assert.equal(s.db.settings.banners, true); assert.equal(s.db.settings.texts, false);
  assert.equal(s.view(T0).banners, true);
  s.act(l.id, 'undo', {}, T0 + 1000);
  assert.ok(!('banners' in s.db.settings), 'Undo: back to unset'); assert.equal(s.db.settings.texts, false);
  s.act(l.id, 'answer', { value: 'A text to my phone', rev: rev(l) }, T0 + 2000);
  assert.equal(s.db.settings.texts, true); assert.ok(!('banners' in s.db.settings), 'texts leave banners as they were');
  s.save(); assert.equal(s.decisions(T0 + 10 * 60e3, { all: true }).decisions[0].value, 'A text to my phone', 'the assistant still gets the answer');
  l = ask();
  s.act(l.id, 'answer', { value: "Don't, I'll open it myself", rev: rev(l) }, T0 + 20 * 60e3);
  assert.equal(s.db.settings.banners, false); assert.equal(s.db.settings.texts, false);
  // The same answer on any other light changes nothing, and a typed answer it cannot read changes nothing.
  const other = s.raise({ title: 'Banner or text?', kind: 'decide', key: 'other', options: ATTENTION_OPTIONS, recommended: ATTENTION_OPTIONS[0] }, T0);
  s.act(other.id, 'answer', { value: 'A text to my phone', rev: rev(other) }, T0 + 21 * 60e3);
  assert.equal(s.db.settings.texts, false);
  l = ask();
  s.act(l.id, 'answer', { text: 'ask me later', rev: rev(l) }, T0 + 22 * 60e3);
  assert.equal(s.db.settings.texts, false); assert.equal(s.db.settings.banners, false);
  s.setting('banners', true); assert.equal(s.view(T0).banners, true);
  assert.throws(() => s.setting('banners', 'yes'), /true or false/);
  // Only the three exact buttons switch anything. The same key raised with other buttons (an assistant's own wording)
  // changes nothing, so "No texts, banner is fine" never turns banners off and "Only text me when it breaks" never
  // turns texts on for everything.
  for (const value of ['No texts, banner is fine', 'Only text me when something breaks', 'no']) {
    l = s.raise({ title: 'How should it get your attention?', kind: 'decide', key: ATTENTION_KEY, options: [value, 'Other'], recommended: value }, T0);
    s.act(l.id, 'answer', { value, rev: rev(l) }, T0 + 30 * 60e3);
    assert.deepEqual([s.db.settings.banners, s.db.settings.texts], [true, false], value);
  }
  l = ask(); s.act(l.id, 'answer', { value: 'A text to my phone', rev: rev(l) }, T0 + 31 * 60e3);
  assert.equal(s.db.settings.texts, true, 'the button still works');
});

test('the attention question offers only what this computer can do: all three on a Mac, no text on Linux, none on Windows', () => {
  const { attentionOptions, ATTENTION_OPTIONS } = require('../lib/store');
  assert.deepEqual(attentionOptions('darwin'), ATTENTION_OPTIONS);
  assert.deepEqual(attentionOptions('linux'), ATTENTION_OPTIONS.slice(0, 2));
  assert.deepEqual(attentionOptions('win32'), []);
});

test('a lined-up copy post can be marked sent or brought forward from the drawer; a lined-up assistant job cannot be approved', () => {
  const s = fresh();
  const post = s.raise({ area: 'School', title: 'Post the study group invite', state: 'queued', kind: 'approve', channel: 'copy', link: 'https://example.com/new', draft: 'Thursdays 7 pm.' }, T0);
  const job = s.raise({ area: 'School', title: 'Queued build step', state: 'queued', kind: 'approve' }, T0);
  assert.throws(() => s.act(job.id, 'approve', { rev: s.view(T0).lights.find((l) => l.id === job.id).rev }, T0), /already handled/, 'an assistant\'s lined-up job is not approved from the drawer');
  const other = s.raise({ area: 'School', title: 'Post the second invite', state: 'queued', kind: 'approve', channel: 'copy', draft: 'Fridays.' }, T0);
  s.act(post.id, 'approve', { rev: s.view(T0).lights.find((l) => l.id === post.id).rev }, T0);
  assert.equal(s.view(T0).lights.find((l) => l.id === post.id), undefined, 'sent by the person: done');
  s.act(other.id, 'ready', {}, T0);
  const v = s.view(T0);
  assert.equal(v.lights.find((l) => l.id === other.id).state, 'need_you');
  assert.ok(v.queue.includes(other.id));
  assert.equal(v.held.find((x) => x.id === other.id).what, 'Brought forward');
  s.act(other.id, 'undo', {}, T0 + 1);
  assert.equal(s.view(T0 + 1).lights.find((l) => l.id === other.id).state, 'queued', 'undo puts it back in line');
  s.act(job.id, 'ready', {}, T0);
  assert.throws(() => s.act(job.id, 'ready', {}, T0), /Only something lined up/, 'once it is in front of the person, it is not lined up');
});

test('a timed pass: broken jobs go in first, and safe answers that can be taken together cost one card', () => {
  const s = fresh();
  for (let i = 1; i <= 8; i++) s.raise({ area: 'App', title: `Duplicate ${i}`, kind: 'decide', options: ['Keep the first', 'Keep the second'], recommended: 'Keep the first', seconds: 30 }, T0 - i * 1000);
  s.raise({ area: 'App', title: 'Nightly job failed', state: 'broken', options: ['Run it now', 'Leave it'], seconds: 20 }, T0);
  s.raise({ area: 'App', title: 'Check the long report', kind: 'todo', seconds: 50 }, T0);
  const v = s.view(T0), f = s.fit(2, T0), title = (id) => v.lights.find((l) => l.id === id).title;
  assert.equal(title(f.ids[0]), 'Nightly job failed');
  assert.equal(f.ids.filter((id) => /Duplicate/.test(title(id))).length, 8, 'all eight safe answers ride on one card');
  assert.equal(f.seconds, 20 + 60, 'the broken job, then one minute for the group card');
  assert.ok(!f.ids.some((id) => title(id) === 'Check the long report'), 'nothing past the budget');
});

// The "Reach out?" drawer: a suggestion the person did not ask for waits folded away, never in front of them.
test('an optional light stays out of the queue, lanes, headline and area counts, and is counted as "to reach out"', () => {
  const s = fresh();
  const ask = s.raise({ area: 'Shop', title: 'Reply to Dale', draft: 'Thursday works.', outbound: true, to: 'Dale' }, T0);
  const lead = s.raise({ area: 'Shop', title: 'Text Maria about the patio quote?', draft: 'Hi Maria, still thinking about the patio lights?', outbound: true, to: 'Maria', channel: 'copy', optional: true, last_contact: 'Nov 9, texted the quote' }, T0);
  const rec = s.raise({ area: 'Shop', title: 'Check in with the Lees?', draft: 'Hi, how are the lights?', outbound: true, to: 'the Lees', optional: true }, T0);
  const v = s.view(T0), byId = (id) => v.lights.find((l) => l.id === id);
  assert.deepEqual(v.queue, [ask.id], 'only what the person asked for is in the queue');
  assert.ok(!Object.values(v.lanes).flat().includes(rec.id), 'never in a group tap');
  assert.equal(v.counts.waiting, 1); assert.equal(v.counts.need_you, 1, 'the headline counts only the queue');
  assert.equal(v.counts.reachOut, 2); assert.equal(v.counts.total, 3);
  const c = v.counts; assert.equal(c.waiting + c.broken + c.running + c.queued + c.others + c.aside + c.reachOut, c.total, 'the parts still add up');
  const a = v.areas.find((x) => x.name === 'Shop'); assert.equal(a.waiting, 1); assert.equal(a.counts.reachOut, 2);
  assert.ok(byId(lead.id).reachOut); assert.equal(byId(lead.id).lastContact, 'Nov 9, texted the quote');
  assert.deepEqual(v.reachOut.slice().sort(), [lead.id, rec.id].sort());
  assert.equal(s.fit(10, T0).ids.includes(lead.id), false, 'never in a timed pass');
});

test('the Reach out drawer lists the longest-quiet first, then the ones with no date it can read', () => {
  const s = fresh(), now = Date.UTC(2026, 10, 15, 15);
  const nodate = s.raise({ area: 'Shop', title: 'A', draft: 'Hi', outbound: true, to: 'A', optional: true, last_contact: 'a while ago' }, now - 3000);
  const recent = s.raise({ area: 'Shop', title: 'B', draft: 'Hi', outbound: true, to: 'B', optional: true, last_contact: 'Nov 9, texted the quote' }, now - 2000);
  const old = s.raise({ area: 'Shop', title: 'C', draft: 'Hi', outbound: true, to: 'C', optional: true, last_contact: '2026-08-01' }, now - 1000);
  const dec = s.raise({ area: 'Shop', title: 'D', draft: 'Hi', outbound: true, to: 'D', optional: true, last_contact: 'Dec 20' }, now); // no year, later than today: last December
  const v = s.view(now);
  assert.deepEqual(v.reachOut, [dec.id, old.id, recent.id, nodate.id]);
  assert.equal(new Date(v.lights.find((l) => l.id === dec.id).lastContactAt).getFullYear(), 2025);
  assert.equal(v.lights.find((l) => l.id === nodate.id).lastContactAt, null);
});

test('an optional light never rings, and an approved one that failed comes back in front of the person', () => {
  const { notifier } = require('../lib/notify');
  const s = fresh(), sent = [];
  const n = notifier({ send: (t, b, k) => sent.push(k), now: () => Date.UTC(2026, 0, 5, 15), quiet: [0, 0], everyMs: 0 });
  n.check(s.view(T0));
  const l = s.raise({ area: 'Shop', title: 'Text an old lead?', draft: 'Hi', outbound: true, to: 'Sam', optional: true }, T0);
  assert.equal(n.check(s.view(T0)), null, 'nothing rings for a suggestion');
  s.act(l.id, 'approve', { rev: s.view(T0).lights.find((x) => x.id === l.id).rev }, T0);
  s.decisions(T0 + HOLD_MS, { all: true }); s.complete(l.id, 'failed', 'bounced', T0 + HOLD_MS);
  const v = s.view(T0 + HOLD_MS);
  assert.ok(v.queue.includes(l.id), 'he said yes to it; the failure is his to see');
  assert.equal(v.reachOut.length, 0);
});

test('setting optional on an existing light moves it to Reach out: its own assistant or the person, never another assistant', () => {
  const s = fresh();
  const l = s.raise({ area: 'Shop', title: 'Text Maria?', draft: 'Hi', outbound: true, to: 'Maria', agent: 'relay', key: 'lead:1' }, T0);
  assert.ok(s.view(T0).queue.includes(l.id));
  assert.throws(() => s.update(l.id, { optional: true, agent: 'someone-else' }, 'someone-else', T0), /belongs to relay/);
  s.update(l.id, { optional: true, last_contact: 'Nov 2, called', agent: 'relay' }, 'relay', T0);
  let v = s.view(T0); assert.deepEqual(v.reachOut, [l.id]); assert.equal(v.queue.length, 0);
  s.update(l.id, { optional: false, agent: 'relay' }, 'relay', T0);
  assert.ok(s.view(T0).queue.includes(l.id), 'optional:false brings it back');
  s.raise({ area: 'Shop', title: 'Text Maria?', agent: 'relay', key: 'lead:1', optional: true }, T0);
  assert.deepEqual(s.view(T0).reachOut, [l.id], 'raising again with the same key moves it too');
  const free = s.raise({ area: 'Shop', title: 'No name on this one', draft: 'Hi', outbound: true, to: 'Al' }, T0);
  s.update(free.id, { optional: true, agent: 'anyone' }, 'anyone', T0);
  assert.ok(s.view(T0).reachOut.includes(free.id), 'a light raised with no name can be moved by any assistant');
  const mine = s.raise({ area: 'Shop', title: 'Assistant light', draft: 'Hi', outbound: true, to: 'Bo', agent: 'x' }, T0);
  s.update(mine.id, { optional: true }, 'you', T0);
  assert.ok(s.view(T0).reachOut.includes(mine.id), 'the person may move any light');
  const odd = s.raise({ area: 'Shop', title: 'Odd one', optional: 'maybe' }, T0);
  assert.equal(odd.optional, false); assert.ok(s.warnings.some((w) => /optional must be true or false/.test(w)));
});

test('the person moves a message to Reach out (undoable), and "Not now" drops it with a reason the assistant is handed', () => {
  const s = fresh();
  const l = s.raise({ area: 'Shop', title: 'Text Maria?', draft: 'Hi Maria', outbound: true, to: 'Maria', channel: 'copy', link: 'https://example.com/chat' }, T0);
  const q = s.raise({ area: 'Shop', title: 'Pick a color', kind: 'decide', options: ['Red', 'Blue'] }, T0);
  assert.throws(() => s.act(q.id, 'reach_out', {}, T0), /Only a message to a person/);
  s.act(l.id, 'reach_out', {}, T0);
  let v = s.view(T0); assert.deepEqual(v.reachOut, [l.id]); assert.equal(v.held.find((x) => x.id === l.id).what, 'Moved to Reach out');
  assert.throws(() => s.act(l.id, 'reach_out', {}, T0), /already in Reach out/);
  s.act(l.id, 'undo', {}, T0 + 1); v = s.view(T0 + 1);
  assert.ok(v.queue.includes(l.id), 'undo puts it back in the list'); assert.equal(v.reachOut.length, 0);
  s.act(l.id, 'reach_out', {}, T0 + 2);
  // From the drawer: Copy & open, then "Yes, it went", with the rev of what was copied.
  const rev = s.view(T0 + 2).lights.find((x) => x.id === l.id).rev;
  s.act(l.id, 'approve', { rev }, T0 + 3);
  assert.equal(s.view(T0 + 3).lights.find((x) => x.id === l.id), undefined, 'sent by the person: done');
  const o = s.raise({ area: 'Shop', title: 'Check in with the Lees?', draft: 'Hi', outbound: true, to: 'Lee', optional: true, agent: 'a1' }, T0);
  s.act(o.id, 'drop', { why: 'they hired someone else' }, T0);
  const got = s.decisions(T0 + HOLD_MS, { agent: 'a1' }).decisions.find((d) => d.id === o.id);
  assert.equal(got.action, 'drop'); assert.equal(got.text, 'they hired someone else');
});

test('only a message to a person can wait in Reach out: a decision or a to-do marked optional stays in the list, with a warning', () => {
  const s = fresh();
  const d = s.raise({ area: 'Shop', title: 'Text her?', kind: 'decide', options: ['Text her', 'Skip'], recommended: 'Skip', optional: true }, T0);
  assert.equal(d.optional, false); assert.ok(s.warnings.some((w) => /only for a message to a person/.test(w)), s.warnings.join('; '));
  const t = s.raise({ area: 'Shop', title: 'Call the Lees', kind: 'todo', link: 'https://x', optional: true }, T0);
  const v = s.view(T0); assert.ok(v.queue.includes(d.id) && v.queue.includes(t.id)); assert.equal(v.reachOut.length, 0);
  // A light already in the drawer that becomes something else comes back to the list.
  const m = s.raise({ area: 'Shop', title: 'Text Al', draft: 'Hi', outbound: true, to: 'Al', optional: true, agent: 'a1', key: 'k' }, T0);
  assert.deepEqual(s.view(T0).reachOut, [m.id]);
  s.update(m.id, { kind: 'todo', agent: 'a1' }, 'a1', T0);
  assert.equal(s.view(T0).reachOut.length, 0);
});

test('what the person moved to Reach out stays there: its assistant cannot pull it back into the list', () => {
  const s = fresh();
  const l = s.raise({ area: 'Shop', title: 'Text Dale (old lead)', draft: 'Hi Dale', outbound: true, to: 'Dale', agent: 'a1', key: 'lead:dale' }, T0);
  s.act(l.id, 'reach_out', {}, T0);
  s.raise({ area: 'Shop', title: 'Text Dale (old lead)', draft: 'Hi Dale', outbound: true, to: 'Dale', agent: 'a1', key: 'lead:dale', optional: false }, T0 + 1);
  assert.ok(s.warnings.some((w) => /stays there until they bring it back/.test(w)), s.warnings.join('; '));
  s.update(l.id, { optional: false, agent: 'a1' }, 'a1', T0 + 2);
  let v = s.view(T0 + 2); assert.deepEqual(v.reachOut, [l.id]); assert.ok(!v.queue.includes(l.id));
  s.update(l.id, { optional: false }, 'you', T0 + 3);
  assert.ok(s.view(T0 + 3).queue.includes(l.id), 'the person brings it back');
  // Moved by the person through an update: the same.
  const m = s.raise({ area: 'Shop', title: 'Text Bo', draft: 'Hi', outbound: true, to: 'Bo', agent: 'a1', key: 'lead:bo' }, T0);
  s.update(m.id, { optional: true }, 'you', T0);
  s.update(m.id, { optional: false, agent: 'a1' }, 'a1', T0 + 1);
  assert.ok(s.view(T0 + 1).reachOut.includes(m.id));
});

test('a message to a customer raised through the board\'s API with no owner is refused; examples and practice runs still work', () => {
  const s = fresh();
  const api = (o) => s.raise(o, T0, { api: true });
  for (const o of [{ outbound: true }, { outbound: 'true' }, { to: 'Dale Henderson' }, { phone: '+18595550142' }])
    assert.throws(() => api(Object.assign({ area: 'Shop', title: 'Reply to Dale', kind: 'approve', draft: 'Hi' }, o)), /needs one owner/);
  assert.throws(() => api({ area: 'Shop', title: 'Reply to Dale', kind: 'approve', draft: 'Hi', outbound: true, agent: '' }), /without for_anyone/);
  assert.throws(() => api({ area: 'Shop', title: 'Reply to Dale', kind: 'approve', draft: 'Hi', to: 'Dale', demo: true }), /needs one owner/, 'an example flag through the API changes nothing');
  const ok = api({ area: 'Shop', title: 'Reply to Dale', kind: 'approve', draft: 'Hi', outbound: true, agent: 'claude:shop~1234' });
  assert.equal(ok.agent, 'claude:shop~1234');
  api({ area: 'Shop', title: 'Order boxes', kind: 'todo' }); // nothing to a customer: no owner needed
  s.raise({ area: 'Shop', title: 'Practice reply', kind: 'approve', outbound: true, draft: 'Hi' }, T0); // the store itself (sims) is not the API
  s.seedDemo(T0); assert.ok(s.db.lights.some((l) => l.demo && l.outbound));
  // An unowned light cannot become a message to a customer later either, except by the person.
  const loose = s.raise({ area: 'Shop', title: 'Think about Dale', kind: 'todo' }, T0);
  assert.throws(() => s.update(loose.id, { to: 'Dale Henderson' }, 'claude:x', T0), /needs one owner/);
  assert.equal(s.update(loose.id, { to: 'Dale Henderson' }, 'you', T0).outbound, true);
});

test('an option label marked "(recommended)" becomes the recommended answer, and the mark comes off the button', () => {
  const s = fresh();
  const l = s.raise({ area: 'Shop', title: 'Which supplier?', kind: 'decide', options: ['Acme (recommended)', 'Bolt'] }, T0);
  assert.deepEqual([l.options, l.recommended], [['Acme', 'Bolt'], 'Acme']);
  assert.ok(s.warnings.some((w) => /"\(recommended\)" mark was taken off the option "Acme" and it was set as the recommended answer/.test(w)), s.warnings.join('; '));
  const named = s.raise({ area: 'Shop', title: 'Which day?', kind: 'decide', options: ['Monday [Recommended]', 'Friday'], recommended: 'Friday' }, T0);
  assert.deepEqual([named.options, named.recommended], [['Monday', 'Friday'], 'Friday'], 'a recommended named outright wins');
  const said = s.raise({ area: 'Shop', title: 'Go?', kind: 'decide', options: ['Yes (recommended)', 'No'], recommended: 'Yes (recommended)' }, T0);
  assert.deepEqual([said.options, said.recommended], [['Yes', 'No'], 'Yes']);
  const plain = s.raise({ area: 'Shop', title: 'Paint?', kind: 'decide', options: ['Blue', 'Green'], recommended: 'Green' }, T0);
  assert.deepEqual([plain.options, plain.recommended], [['Blue', 'Green'], 'Green'], 'nothing changes without the mark');
  s.update(plain.id, { options: ['Blue (recommended)', 'Green'] }, 'claude:x', T0);
  assert.equal(s.db.lights.find((x) => x.id === plain.id).recommended, 'Blue', 'new options that mark one say what is recommended now');
});

test('an answer given in chat: recorded with the person\'s words by the session that asked, collected at once, never trust', () => {
  const s = fresh(), me = { agent: 'claude-code:acme' };
  const q = s.raise({ area: 'A', title: 'Which day for the install?', kind: 'decide', options: ['Tuesday', 'Wednesday'], agent: me.agent }, T0);
  const r = s.recordAnswer(q.id, Object.assign({ value: 'wednesday', quote: 'wednesday works, do that' }, me), T0 + 1000);
  assert.equal(r.held, false);
  const l = s.db.lights.find((x) => x.id === q.id);
  assert.equal(l.state, 'done');
  assert.deepEqual([l.decision.value, l.decision.via, l.decision.quote, l.decision.by, l.decision.releaseAt], ['Wednesday', 'chat', 'wednesday works, do that', 'you', T0 + 1000]);
  const got = s.decisions(T0 + 1000, me).decisions;
  assert.equal(got.length, 1, 'collected right away: the person already said it');
  assert.equal(got[0].value, 'Wednesday');
  assert.equal(Object.keys(s.db.streaks).length, 0, 'a chat answer earns no trust');
  assert.ok(s.history('', 50).some((x) => x.id === q.id), 'search_history finds it');
});

test('record_answer refuses: another session\'s light, a message to a person, an approval, a wrong option, no quote', () => {
  const s = fresh(), me = { agent: 'claude-code:acme' };
  const theirs = s.raise({ area: 'A', title: 'Pick one', kind: 'decide', options: ['A', 'B'], agent: 'claude-code:other' }, T0);
  assert.throws(() => s.recordAnswer(theirs.id, Object.assign({ value: 'A', quote: 'A' }, me), T0), /belongs to claude-code:other/);
  const nobody = s.raise({ area: 'A', title: 'Pick again', kind: 'decide', options: ['A', 'B'] }, T0);
  assert.throws(() => s.recordAnswer(nobody.id, Object.assign({ value: 'A', quote: 'A' }, me), T0), /Leave it for the board/);
  const msg = s.raise({ area: 'A', title: 'Text Pat', kind: 'approve', draft: 'Hi Pat', outbound: true, to: 'Pat Lee', agent: me.agent }, T0);
  assert.throws(() => s.recordAnswer(msg.id, Object.assign({ value: 'yes', quote: 'send it' }, me), T0), /message to a person is approved on the board/);
  const change = s.raise({ area: 'A', title: 'Change the price', kind: 'approve', change_from: '$10', change_to: '$12', agent: me.agent }, T0);
  assert.throws(() => s.recordAnswer(change.id, Object.assign({ value: 'yes', quote: 'yes' }, me), T0), /approval is given on the board/);
  const q = s.raise({ area: 'A', title: 'Pick a color', kind: 'decide', options: ['Red', 'Blue'], agent: me.agent }, T0);
  assert.throws(() => s.recordAnswer(q.id, Object.assign({ value: 'Green', quote: 'green' }, me), T0), /one of this light's options/);
  assert.throws(() => s.recordAnswer(q.id, Object.assign({ value: 'Red' }, me), T0), /quote is required/);
  assert.equal(s.db.lights.find((x) => x.id === q.id).state, 'need_you');
});

test('record_answer on a high-stakes light only waits for the person\'s Confirm; Not that clears it; a changed light refuses it', () => {
  const s = fresh(), me = { agent: 'claude-code:acme' };
  const q = s.raise({ area: 'A', title: 'Delete the old backups folder?', kind: 'decide', options: ['Yes', 'No'], agent: me.agent }, T0);
  const r = s.recordAnswer(q.id, Object.assign({ value: 'Yes', quote: 'yeah delete it' }, me), T0 + 1000);
  assert.equal(r.held, true);
  let l = s.db.lights.find((x) => x.id === q.id);
  assert.equal(l.state, 'need_you'); assert.equal(l.decision, null); assert.equal(l.chatAnswer.quote, 'yeah delete it');
  assert.equal(s.decisions(T0 + 99e6, me).decisions.length, 0, 'nothing to collect before the Confirm');
  s.act(q.id, 'dismiss_chat', {}, T0 + 2000);
  assert.equal(s.db.lights.find((x) => x.id === q.id).chatAnswer, null);
  s.recordAnswer(q.id, Object.assign({ value: 'Yes', quote: 'yes really' }, me), T0 + 3000);
  s.act(q.id, 'confirm_chat', {}, T0 + 4000);
  l = s.db.lights.find((x) => x.id === q.id);
  assert.deepEqual([l.state, l.decision.value, l.decision.via, l.decision.quote], ['done', 'Yes', 'chat', 'yes really']);
  assert.ok(l.decision.releaseAt > T0 + 4000, 'a confirm keeps the usual hold, so it can be taken back');
  const q2 = s.raise({ area: 'A', title: 'Drop the old leads table?', kind: 'decide', options: ['Yes', 'No'], agent: me.agent }, T0);
  s.recordAnswer(q2.id, Object.assign({ value: 'Yes', quote: 'yes' }, me), T0 + 1000);
  s.update(q2.id, { note: 'Background only.' }, me.agent, T0 + 1500);
  assert.ok(s.db.lights.find((x) => x.id === q2.id).chatAnswer, 'a note is background: the answer still stands for the person to confirm');
  s.update(q2.id, { title: 'Drop the old leads table and the archive table?' }, me.agent, T0 + 2000);
  assert.ok(s.warnings.some((w) => /answer from the chat was about this light as it was/.test(w)), 'the assistant is told to ask again');
  assert.throws(() => s.act(q2.id, 'confirm_chat', {}, T0 + 3000), /There is no answer from a chat/);
});

test('a to-do said done in chat is done; a high-stakes to-do waits for Confirm', () => {
  const s = fresh(), me = { agent: 'claude-code:acme' };
  const t = s.raise({ area: 'A', title: 'Order the bulbs', kind: 'todo', link: 'https://example.com', agent: me.agent }, T0);
  s.recordAnswer(t.id, Object.assign({ value: 'done', quote: 'ordered them this morning' }, me), T0 + 1000);
  assert.equal(s.db.lights.find((x) => x.id === t.id).state, 'done');
  const h = s.raise({ area: 'A', title: 'Remove the old pay links in Stripe', kind: 'todo', link: 'https://example.com', agent: me.agent }, T0);
  assert.equal(s.recordAnswer(h.id, Object.assign({ value: 'done', quote: 'did it' }, me), T0 + 1000).held, true);
  s.act(h.id, 'confirm_chat', {}, T0 + 2000);
  assert.equal(s.db.lights.find((x) => x.id === h.id).state, 'done');
});

test('a chat answer is judged by the answer given: "Yes" to a deletion that recommends No still waits for Confirm', () => {
  const s = fresh(), me = { agent: 'claude-code:acme' };
  const q = s.raise({ area: 'A', title: 'Delete the old backups folder?', kind: 'decide', options: ['Yes', 'No'], recommended: 'No', agent: me.agent }, T0);
  assert.equal(s.recordAnswer(q.id, Object.assign({ value: 'Yes', quote: 'yeah delete those' }, me), T0 + 1000).held, true, 'the risky answer waits');
  s.act(q.id, 'dismiss_chat', {}, T0 + 2000);
  assert.equal(s.recordAnswer(q.id, Object.assign({ value: 'No', quote: 'no keep them' }, me), T0 + 3000).held, false, 'keeping them changes nothing: recorded');
});

test('a light waiting on the Confirm of a chat answer is shown one at a time, never in a group', () => {
  const s = fresh(), me = { agent: 'claude-code:acme' };
  const q = s.raise({ area: 'A', title: 'Delete the old backups folder?', kind: 'decide', options: ['Yes', 'No'], recommended: 'No', agent: me.agent }, T0);
  assert.ok(s.view(T0).lanes.read.includes(q.id), 'before: a deletion recommending No is read first');
  s.recordAnswer(q.id, Object.assign({ value: 'Yes', quote: 'delete them' }, me), T0 + 1000);
  const v = s.view(T0 + 1000);
  assert.ok(v.lanes.high.includes(q.id) && !v.lanes.read.includes(q.id) && !v.lanes.safe.includes(q.id));
  assert.throws(() => s.bulk([q.id], 'recommended', {}, T0 + 2000), /one at a time/i);
});

test('a session in the project\'s folder collects answers stranded under the project name, only once that session is quiet', () => {
  const { HOLD_MS } = require('../lib/store');
  const s = fresh(), asker = { agent: 'claude-code:acme' }, inRepo = { agent: 'claude-code:acme~ab12', fallback: ['claude-code:acme'] };
  const q = s.raise({ area: 'A', title: 'Which day?', kind: 'decide', options: ['Tue', 'Wed'], agent: asker.agent }, T0);
  s.decisions(T0, asker); // the asking session was here
  s.act(q.id, 'answer', { value: 'Wed', rev: require('../lib/store').rev(s.db.lights.find((l) => l.id === q.id)) }, T0 + 1000);
  const ready = T0 + 1000 + HOLD_MS;
  assert.equal(s.decisions(ready + 60e3, inRepo).decisions.length, 0, 'not while the asking session may still come back');
  const later = ready + 11 * 60e3;
  const got = s.decisions(later, inRepo).decisions;
  assert.deepEqual(got.map((d) => [d.id, d.value, d.fallback, d.raised_by]), [[q.id, 'Wed', true, 'claude-code:acme']]);
  assert.equal(s.db.lights.find((l) => l.id === q.id).decision.collectedBy, 'claude-code:acme~ab12', 'collected under its own name');
  assert.throws(() => s.update(q.id, { state: 'dropped', closing: true, agent: inRepo.agent, agents: [inRepo.agent], fallback: ['claude-code:acme'] }, inRepo.agent, later), /belongs to claude-code:acme/, 'the fallback never lets it close the light');
});

test('the fallback never takes an answer from a session that is still around, nor a message to a person', () => {
  const { HOLD_MS, rev } = require('../lib/store');
  const s = fresh(), asker = { agent: 'claude-code:acme' }, inRepo = { agent: 'claude-code:acme~ab12', fallback: ['claude-code:acme'] };
  const q = s.raise({ area: 'A', title: 'Pick one', kind: 'decide', options: ['A', 'B'], agent: asker.agent }, T0);
  const m = s.raise({ area: 'A', title: 'Text Pat', kind: 'approve', draft: 'Hi Pat', outbound: true, to: 'Pat Lee', agent: asker.agent }, T0);
  s.act(q.id, 'answer', { value: 'A', rev: rev(s.db.lights.find((l) => l.id === q.id)) }, T0 + 1000);
  s.act(m.id, 'approve', { rev: rev(s.db.lights.find((l) => l.id === m.id)) }, T0 + 1000);
  const later = T0 + 1000 + HOLD_MS + 11 * 60e3;
  s.decisions(T0 + 1000, { agent: 'claude-code:pinger' }); s.db.seen.agents = Object.assign(s.db.seen.agents || {}, { 'claude-code:acme': later - 60e3 }); // the asking session checked in a minute ago
  assert.equal(s.decisions(later, inRepo).decisions.filter((d) => d.fallback).length, 0, 'a live session keeps its answers');
  const s2 = fresh();
  const m2 = s2.raise({ area: 'A', title: 'Text Pat', kind: 'approve', draft: 'Hi Pat', outbound: true, to: 'Pat Lee', agent: asker.agent }, T0);
  s2.act(m2.id, 'approve', { rev: rev(s2.db.lights.find((l) => l.id === m2.id)) }, T0 + 1000);
  assert.equal(s2.decisions(T0 + 99 * 60e3, inRepo).decisions.length, 0, 'a message to a person waits for a session that can send it');
});

test('raise time: a recommendation that changes nothing, and an eleventh open ask in one container, each get a warning', () => {
  const s = fresh();
  const l = s.raise({ title: 'Switch the newsletter to weekly', kind: 'decide', options: ['Yes', 'Not now'], recommended: 'Not now' }, T0);
  assert.ok(s.warnings.some((w) => /changes nothing/.test(w)), s.warnings.join('; '));
  s.raise({ title: 'Keep the STOP opt-out?', kind: 'decide', options: ['Yes', 'No'], recommended: 'No' }, T0);
  assert.ok(!s.warnings.some((w) => /changes nothing/.test(w)), 'a question about keeping something is not status quo');
  for (let i = 0; i < 10; i++) s.raise({ title: `Approve fix ${i}`, kind: 'approve', draft: 'x', key: `k${i}`, area: 'Busy' }, T0);
  s.raise({ title: 'Approve fix 11', kind: 'approve', draft: 'x', key: 'k11', area: 'Busy' }, T0);
  assert.ok(s.warnings.some((w) => /fold this into one light/.test(w)), s.warnings.join('; '));
  assert.ok(l.id);
});
