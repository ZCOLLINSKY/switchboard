'use strict';
// An answer whose asking session has gone (it ended, or its worktree was removed) must not be stranded. A relay that
// asks for orphans takes a decision only when its owner has not asked for decisions since it became collectable, after
// a wait, and never a message to a person (only a session that can send it may take that) or anything collected before.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, rev, HOLD_MS } = require('../lib/store');

const T0 = new Date(2026, 10, 16, 10, 0, 0).getTime(), MIN = 60e3;
const fresh = () => open(fs.mkdtempSync(path.join(os.tmpdir(), 'sbo-')), {});
const RELAY = { agent: 'zachs-board', only: true, orphans: 10 * MIN };

test('a gone session\'s answer goes to the relay after the wait, marked as an orphan', () => {
  const s = fresh();
  const l = s.raise({ agent: 'claude-code:r131~aaaa', area: 'Around Lex', title: 'Ship release 131?', kind: 'decide', options: ['Yes', 'No'] }, T0);
  s.act(l.id, 'answer', { value: 'Yes', rev: rev(l) }, T0 + MIN);
  assert.equal(s.decisions(T0 + 5 * MIN, RELAY).decisions.length, 0, 'not before the wait');
  const got = s.decisions(T0 + 12 * MIN, RELAY).decisions;
  assert.equal(got.length, 1);
  assert.equal(got[0].orphan, true);
  assert.equal(got[0].raised_by, 'claude-code:r131~aaaa');
  assert.equal(got[0].value, 'Yes');
  // The session comes back later: the answer is already on its way, never handed out twice.
  assert.equal(s.decisions(T0 + 13 * MIN, { agent: 'claude-code:r131~aaaa' }).decisions.length, 0);
});

test('a session that is still asking keeps its own answers', () => {
  const s = fresh();
  const l = s.raise({ agent: 'claude-code:lighting-os~bbbb', area: 'LightDeck', title: 'Merge PR 614?', kind: 'decide', options: ['Yes', 'No'] }, T0);
  s.act(l.id, 'answer', { value: 'No', rev: rev(l) }, T0 + MIN);
  // It asked after the answer could be collected (but before the hold ended for this call: nothing handed yet).
  s.decisions(T0 + MIN + HOLD_MS + 1000, { agent: 'claude-code:other~cccc' });
  s.pending(T0 + MIN + HOLD_MS + 2000, { agent: 'claude-code:lighting-os~bbbb', only: true }); // its session-start count
  assert.equal(s.decisions(T0 + 30 * MIN, RELAY).decisions.length, 0, 'its owner showed up after the answer, so it is not orphaned');
});

test('never a message to a person, never something collected before, never without asking for orphans', () => {
  const s = fresh();
  const msg = s.raise({ agent: 'claude-code:r9~dddd', area: 'Shop', title: 'Reply to Dale', kind: 'approve', draft: 'Hi Dale', outbound: true, to: 'Dale' }, T0);
  s.act(msg.id, 'approve', { rev: rev(msg) }, T0 + MIN);
  const twice = s.raise({ agent: 'claude-code:r9~dddd', area: 'Shop', title: 'Which size?', kind: 'decide', options: ['S', 'L'] }, T0);
  s.act(twice.id, 'answer', { value: 'S', rev: rev(twice) }, T0 + MIN);
  s.decisions(T0 + 2 * MIN, { agent: 'claude-code:r9~dddd' }); // collected by its owner, who then went away
  const plain = s.raise({ agent: 'claude-code:r9~dddd', area: 'Shop', title: 'Order boxes?', kind: 'decide', options: ['Yes', 'No'] }, T0);
  s.act(plain.id, 'answer', { value: 'Yes', rev: rev(plain) }, T0 + 3 * MIN);
  assert.equal(s.decisions(T0 + 60 * MIN, { agent: 'zachs-board', only: true }).decisions.length, 0, 'no orphans unless asked for');
  const got = s.decisions(T0 + 61 * MIN, RELAY).decisions.map((d) => d.id);
  assert.deepEqual(got, [plain.id], 'only the plain answer: not the message, not the one its owner collected');
});

test('a light raised with no name is not an orphan: any session can already take it', () => {
  const s = fresh();
  const l = s.raise({ area: 'Shop', title: 'Anyone: which size?', kind: 'decide', options: ['S', 'L'] }, T0);
  s.act(l.id, 'answer', { value: 'L', rev: rev(l) }, T0 + MIN);
  const got = s.decisions(T0 + 30 * MIN, RELAY).decisions;
  assert.equal(got.length, 0, 'only:true still keeps the relay off lights with no name');
});

test('the HTTP route passes orphans_after_minutes on, and a plain call is unchanged', async () => {
  const { start } = require('../server');
  const a = await start({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'sbo-')), holdMs: 0 });
  try {
    const l = a.store.raise({ agent: 'claude-code:gone~eeee', area: 'Shop', title: 'Which size?', kind: 'decide', options: ['S', 'L'] }, Date.now() - 20 * MIN);
    a.store.act(l.id, 'answer', { value: 'S', rev: rev(l) }, Date.now() - 15 * MIN);
    const post = (b) => fetch(a.url + '/api/decisions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    assert.equal((await post({ agent: 'zachs-board', only: true })).decisions.length, 0);
    const got = (await post({ agent: 'zachs-board', only: true, orphans_after_minutes: 10 })).decisions;
    assert.equal(got.length, 1); assert.equal(got[0].raised_by, 'claude-code:gone~eeee');
  } finally { a.close(); }
});

test('a scheduled task that says how often it runs keeps its answers until it misses a run', () => {
  const s = fresh();
  const TASK = { agent: 'claude-code:agent-queue', every: 30 * MIN };
  s.decisions(T0, TASK); // the 10:00 run checks in and says it runs every 30 minutes
  const l = s.raise({ agent: 'claude-code:agent-queue', area: 'Ops', title: 'Run 4 times a day?', kind: 'decide', options: ['Yes', 'No'] }, T0);
  s.act(l.id, 'answer', { value: 'Yes', rev: rev(l) }, T0 + 2 * MIN);
  assert.equal(s.decisions(T0 + 15 * MIN, RELAY).decisions.length, 0, 'past the usual 10 minutes, but its next run is not due until 10:30');
  assert.equal(s.decisions(T0 + 35 * MIN, RELAY).decisions.length, 0, 'still inside the grace after 10:30');
  const got = s.decisions(T0 + 31 * MIN, TASK).decisions; // the 10:31 run picks it up itself
  assert.equal(got.length, 1);
  assert.equal(got[0].value, 'Yes');
  assert.ok(!got[0].orphan);
});

test('a task that stops running still hands its answer on, after the missed run plus the wait', () => {
  const s = fresh();
  s.decisions(T0, { agent: 'claude-code:nightly', every: 60 * MIN });
  const l = s.raise({ agent: 'claude-code:nightly', area: 'Ops', title: 'Keep the nightly check?', kind: 'decide', options: ['Yes', 'No'] }, T0);
  s.act(l.id, 'answer', { value: 'No', rev: rev(l) }, T0 + 5 * MIN);
  assert.equal(s.decisions(T0 + 65 * MIN, RELAY).decisions.length, 0, 'its 11:00 run is only 5 minutes late');
  const got = s.decisions(T0 + 71 * MIN, RELAY).decisions;
  assert.equal(got.length, 1, 'missed its run by more than the wait: the relay takes it');
  assert.equal(got[0].orphan, true);
});

test('a live session sharing the name keeps the rhythm; 0 clears it; nonsense is ignored', () => {
  const s = fresh();
  s.decisions(T0, { agent: 'claude-code:around-lex', every: 240 * MIN });
  s.decisions(T0 + MIN, { agent: 'claude-code:around-lex' }); // a live session with the same name says nothing
  assert.equal(s.db.seen.every['claude-code:around-lex'], 240 * MIN);
  s.decisions(T0 + 2 * MIN, { agent: 'claude-code:around-lex', every: 0 });
  assert.equal(s.db.seen.every['claude-code:around-lex'], undefined);
  s.decisions(T0 + 3 * MIN, { agent: 'claude-code:around-lex', every: 'soon' });
  assert.equal(s.db.seen.every['claude-code:around-lex'], undefined, 'not a number: nothing kept');
  s.decisions(T0 + 4 * MIN, { agent: 'claude-code:around-lex', every: 999 * 3600e3 });
  assert.equal(s.db.seen.every['claude-code:around-lex'], 26 * 3600e3, 'capped at 26 hours');
});
