'use strict';
// Receipts from the board's own log: counted, never estimated.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, rev } = require('../lib/store');
const { report } = require('../lib/report');

test('the report counts what came in, what was decided and how fast, and what is still waiting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbr-')), s = open(dir, { holdMs: 0 });
  const T = new Date(2026, 10, 16, 9, 0, 0).getTime(), M = 60e3;
  const a = s.raise({ agent: 'claude-code:around-lex', area: 'Around Lex', title: 'Ship release 131?', kind: 'decide', options: ['Yes', 'No'] }, T);
  const b = s.raise({ agent: 'claude-code:around-lex', area: 'Around Lex', title: 'Reply to the Lyric', kind: 'approve', draft: 'Thanks!', outbound: true, to: 'Lyric' }, T);
  const c = s.raise({ agent: 'owners-board', area: 'LightDeck', title: 'Rename the repo?', kind: 'decide', options: ['Yes', 'No'] }, T + M);
  s.raise({ agent: 'owners-board', area: 'LightDeck', title: 'Still waiting one', kind: 'todo' }, T + 2 * M);
  s.raise({ agent: 'claude-code:test', area: 'Bourbon Daybook', title: 'Release running', kind: 'todo', state: 'auto' }, T + 2 * M);
  s.act(a.id, 'answer', { value: 'Yes', rev: rev(a) }, T + 4 * M);
  s.act(b.id, 'approve', { rev: rev(b) }, T + 10 * M);
  s.act(c.id, 'answer', { value: 'No', rev: rev(c) }, T + 21 * M);
  const got = s.decisions(T + 30 * M, { agent: 'claude-code:around-lex' });
  for (const d of got.decisions) s.complete(d.id, d.action === 'approve' ? 'sent' : 'done', '', T + 31 * M, d.decision_id);
  s.save();
  const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const r = report(events, s.view(T + 40 * M), { days: 7, now: T + 40 * M });
  assert.match(r, /Came in: 5 lights, 4 asking you \(from claude-code:around-lex 2, owners-board 2, claude-code:test 1\)/);
  assert.match(r, /You decided: 3 \(1 approved, 2 answered\)/);
  assert.match(r, /middle 10 min, fastest 4 min, slowest 20 min/);
  assert.match(r, /Picked up by assistants: 2 \(claude-code:around-lex 2\)/);
  assert.match(r, /Reported back: 2 \(1 sent, 1 done, 0 failed, 0 not sure\)/);
  assert.match(r, /Waiting on you now: \d+\. Waiting longest: "Still waiting one"/);
  assert.doesNotMatch(r, /NaN|undefined/);
  assert.match(report([], { lights: [] }, { days: 7, now: T }), /Came in: 0 lights, 0 asking you\.\nYou decided: 0\.\nTime from asking to your answer: no answers yet\./, 'an empty week reads plainly');
});

test('cli.js report prints the receipts of the board in use', async () => {
  const { childEnv } = require('./fixtures/env'), { spawn } = require('child_process'), { start } = require('../server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbr-')), a = await start({ port: 0, dir });
  try {
    a.store.raise({ agent: 't', area: 'Shop', title: 'Order boxes?', kind: 'decide', options: ['Yes', 'No'] }); a.store.save();
    const out = await new Promise((ok) => { const c = spawn(process.execPath, [path.join(__dirname, '..', 'cli.js'), 'report', '--days', '3'], { env: childEnv({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port }) });
      let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('close', () => ok(o)); });
    assert.match(out, /the last 3 days/); assert.match(out, /Came in: 1 light, 1 asking you/); assert.match(out, /Waiting on you now: 1\./);
  } finally { a.close(); }
});
