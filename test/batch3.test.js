'use strict';
// Review batch 3: order and numbers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, splitDump, DAY, HOLD_MS, OUT_HOLD_MS } = require('../lib/store');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-b3-'));
const T0 = new Date(2026, 10, 13, 10, 0, 0).getTime(), H = 36e5; // 10 am local, inside working hours
const titles = (s, now) => { const v = s.view(now); return v.queue.map((id) => v.lights.find((l) => l.id === id).title); };

test('3.1 (P11) the queue is ordered by meaning', () => {
  const s = open(tmp());
  s.raise({ area: 'Shop', title: 'Lead waiting 2 days', draft: 'Hi', outbound: true }, T0 - 50 * H);
  s.raise({ area: 'Shop', title: 'Background refresh failed', state: 'broken' }, T0 - 26 * H);
  s.raise({ area: 'Home', title: 'Renew the $12 domain?', kind: 'decide', options: ['Yes', 'No'], value: 12 }, T0 - H);
  s.raise({ area: 'Home', title: 'Insurance renewal', kind: 'decide', options: ['Accept', 'Shop around'] }, T0 - 6 * DAY);
  s.raise({ area: 'School', title: 'Problem set, due tonight', kind: 'todo', work_minutes: 90, due: T0 + 6 * H }, T0 - DAY);
  s.raise({ area: 'Shop', title: 'Quote, $8,900', draft: 'x', outbound: true, value: 8900 }, T0 - H);
  s.raise({ area: 'Shop', title: 'Deposit reminders did not send', state: 'broken', holds_up: '3 deposits, $2,900' }, T0 - 2 * H);
  assert.deepEqual(titles(s, T0), ['Problem set, due tonight', 'Quote, $8,900', 'Lead waiting 2 days', 'Deposit reminders did not send', 'Insurance renewal', 'Renew the $12 domain?', 'Background refresh failed']);
  const v = s.view(T0);
  assert.deepEqual(v.lights.filter((l) => l.keep).map((l) => l.title).sort(), ['Deposit reminders did not send', 'Problem set, due tonight']);
  assert.equal(v.order.length, 5);
  assert.match(v.order.join('; '), /broken/);
});

test('3.4 the headline counts taps; chores are listed apart', () => {
  const s = open(tmp());
  s.raise({ area: 'A', title: 'Approve a fix', change_from: 'a', change_to: 'b', seconds: 10 }, T0);
  s.raise({ area: 'A', title: 'Get a new mail key', state: 'broken', work_minutes: 15 }, T0);
  s.raise({ area: 'A', title: 'Problem set', kind: 'todo', work_minutes: 90 }, T0);
  const v = s.view(T0);
  assert.equal(v.seconds, 10);
  assert.deepEqual(v.chores, { count: 2, minutes: 105 });
  assert.equal(v.lights.filter((l) => l.chore).length, 2);
});

test('3.5 (P8) estimates use the middle of recent taps, ignore interruptions, and correct an assistant\'s number', () => {
  const s = open(tmp());
  s.act(s.raise({ area: 'A', title: 'first ever approval', draft: 'x' }, T0).id, 'approve', { tookMs: 540000 }, T0);
  for (let i = 0; i < 10; i++) s.raise({ area: 'A', title: 'typo fix ' + i, change_from: 'a', change_to: 'b' }, T0);
  const v = s.view(T0);
  assert.equal(v.seconds, 0, 'one nine-minute interruption sets nothing');
  assert.equal(v.unsized, 10);
  const s3 = open(tmp());
  for (let i = 0; i < 8; i++) s3.act(s3.raise({ area: 'A', title: 'reply ' + i, draft: 'x', seconds: 5, action_type: 'reply' }, T0).id, 'approve', { tookMs: 90000 }, T0);
  const l = s3.raise({ area: 'A', title: 'reply 9', draft: 'x', seconds: 5, action_type: 'reply' }, T0);
  assert.equal(s3.view(T0).lights.find((x) => x.id === l.id).est, 90);
  const s4 = open(tmp());
  [6, 8, 7, 200, 9].forEach((sec, i) => s4.act(s4.raise({ area: 'A', title: 'fix ' + i, change_from: 'a', change_to: 'b', action_type: 'fix' }, T0).id, 'approve', { tookMs: sec * 1000 }, T0));
  const n = s4.raise({ area: 'A', title: 'fix new', change_from: 'a', change_to: 'b', action_type: 'fix' }, T0);
  assert.equal(s4.view(T0).lights.find((x) => x.id === n.id).est, 8, 'the middle value, not the average');
});

test('3.6 (N5) "I have 10 minutes" puts what is due today first', () => {
  const s = open(tmp());
  s.raise({ area: 'A', title: 'Call the county before 5 pm', kind: 'todo', seconds: 360, due: T0 + 5 * H }, T0);
  s.raise({ area: 'A', title: 'Approve typo fix', change_from: 'a', change_to: 'b', seconds: 8 }, T0);
  s.raise({ area: 'A', title: 'Pick a dentist time', kind: 'decide', options: ['Mon'], seconds: 9 }, T0);
  s.raise({ area: 'A', title: 'A long review', kind: 'todo', seconds: 500 }, T0);
  const f = s.fit(10, T0), v = s.view(T0);
  assert.deepEqual(f.ids.map((id) => v.lights.find((l) => l.id === id).title), ['Call the county before 5 pm', 'Approve typo fix', 'Pick a dentist time']);
  assert.equal(f.seconds, 377);
});

test('3.7 (P6) snoozing is counted, keeps the light\'s age, and the third time asks for a decision', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'School', title: 'Start the outline', kind: 'todo' }, T0);
  s.act(l.id, 'snooze', { days: 2 }, T0); s.tick(T0 + 2 * DAY + 1);
  assert.equal(s.view(T0 + 2 * DAY + 2).lights[0].stale, true, 'age is not reset by a snooze');
  s.act(l.id, 'snooze', { days: 2 }, T0 + 2 * DAY + 2);
  assert.equal(s.view(T0 + 3 * DAY).counts.snoozed, 1);
  s.tick(T0 + 5 * DAY);
  assert.throws(() => s.act(l.id, 'snooze', { days: 2 }, T0 + 5 * DAY), /Do it, drop it, or give it a date/);
  s.act(l.id, 'snooze', { until: T0 + 9 * DAY }, T0 + 5 * DAY);
  assert.equal(l.snoozes, 3);
});

test('3.8 (P7) quick notes are split only where each part stands alone, and filed by whole words', () => {
  assert.deepEqual(splitDump('Call Dr. Smith about the results'), ['Call Dr. Smith about the results']);
  assert.deepEqual(splitDump('Email Sam and tell him the brass order is late'), ['Email Sam and tell him the brass order is late']);
  assert.deepEqual(splitDump('Text Dale and ask about Saturday'), ['Text Dale and ask about Saturday']);
  assert.deepEqual(splitDump('Research and plan the spring promo'), ['Research and plan the spring promo']);
  assert.deepEqual(splitDump('Tell Priya to send the HOA board the quote and book the walk-through'), ['Tell Priya to send the HOA board the quote and book the walk-through']);
  assert.deepEqual(splitDump('Order 6 brass uplights, pay the water bill and book the dentist'), ['Order 6 brass uplights', 'Pay the water bill', 'Book the dentist']);
  const s = open(tmp());
  ['Ortiz Lighting', 'TrailFork app', 'Night classes', 'Family', 'House admin'].forEach((n) => s.addArea({ name: n }, T0));
  const where = (t) => { const id = s.dump(t, T0)[0].area; return s.db.areas.find((a) => a.id === id).name; };
  assert.equal(where('pick up the kids tonight at 6'), 'Inbox');
  assert.equal(where('fortnightly payroll'), 'Inbox');
  assert.equal(where('administer the survey'), 'Inbox');
  assert.equal(where('study for night class'), 'Night classes');
  assert.equal(where('order lighting transformers'), 'Ortiz Lighting');
});

test('3.9 (P14) the person\'s own to-dos are never handed to assistants; the list is capped; old finished lights are archived', () => {
  const s = open(tmp());
  for (let i = 0; i < 300; i++) s.act(s.dump('My own task ' + i, T0 + i)[0].id, 'done', {}, T0 + i + 1);
  assert.equal(s.decisions(T0 + DAY, { all: true }).decisions.length, 0);
  for (let i = 0; i < 70; i++) s.act(s.raise({ area: 'A', title: 'fix ' + i, change_from: 'a', change_to: 'b', agent: 'bot' }, T0).id, 'approve', {}, T0);
  const out = s.decisions(T0 + DAY, { agent: 'bot' });
  assert.equal(out.decisions.length, 50);
  assert.equal(out.more, 20);
  s.tick(T0 + 40 * DAY); s.save();
  assert.equal(s.db.lights.filter((l) => l.state === 'done').length, 0, 'finished lights older than 30 days leave the main file');
  assert.equal(fs.readFileSync(path.join(s.dir, 'archive.jsonl'), 'utf8').trim().split('\n').length, 300);
});

test('3.12 the hold depends on what was decided', () => {
  const s = open(tmp());
  const todo = s.raise({ area: 'A', title: 'mine', kind: 'todo', agent: 'bot' }, T0);
  const fix = s.raise({ area: 'A', title: 'job failed', state: 'broken', options: ['Run it now'], agent: 'bot' }, T0);
  const msg = s.raise({ area: 'A', title: 'reply', draft: 'Hi', outbound: true, agent: 'bot' }, T0);
  const chg = s.raise({ area: 'A', title: 'fix', change_from: 'a', change_to: 'b', agent: 'bot' }, T0);
  s.act(todo.id, 'done', {}, T0); s.act(fix.id, 'answer', { value: 'Run it now' }, T0); s.act(msg.id, 'approve', {}, T0); s.act(chg.id, 'approve', {}, T0);
  const seen = []; // each decision is handed out once (it is then claimed), so collect them as they are released
  const got = (ms) => { seen.push(...s.decisions(T0 + ms, { agent: 'bot' }).decisions.map((d) => d.title)); return seen.slice().sort(); };
  assert.deepEqual(got(100), ['mine'], 'your own to-dos release at once');
  assert.deepEqual(got(5001), ['job failed', 'mine'], 'answers on broken jobs after five seconds, so Take back is real');
  assert.deepEqual(got(HOLD_MS), ['fix', 'job failed', 'mine']);
  assert.equal(OUT_HOLD_MS, 60000);
  const h = s.view(T0 + HOLD_MS + 1).held.find((x) => x.id === msg.id);
  assert.equal(h.until, T0 + OUT_HOLD_MS);
  assert.equal(h.quiet, false);
  s.act(msg.id, 'release', {}, T0 + HOLD_MS + 2);
  assert.deepEqual(got(HOLD_MS + 3), ['fix', 'job failed', 'mine', 'reply']);
  const late = new Date(2026, 10, 13, 21, 0, 0).getTime();
  const m2 = s.raise({ area: 'A', title: 'late reply', draft: 'Hi', outbound: true, agent: 'bot' }, late);
  s.act(m2.id, 'approve', {}, late);
  const h2 = s.view(late + 1000).held.find((x) => x.id === m2.id);
  assert.equal(h2.quiet, true);
  assert.equal(new Date(h2.morning).getHours() * 60 + new Date(h2.morning).getMinutes(), 7 * 60 + 45);
  s.act(m2.id, 'release_at', { until: h2.morning }, late + 2000);
  const lateOnes = (now) => s.decisions(now, { agent: 'bot' }).decisions.filter((d) => d.title === 'late reply').length;
  assert.equal(lateOnes(late + 2 * H), 0);
  assert.equal(lateOnes(h2.morning + 1), 1);
});
