'use strict';
// An assistant can say which answer it recommends. The person can then take every recommendation in one tap (each one
// still on its own undo hold), but only on lights they have seen as they are now, and never on a message to a person.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, rev } = require('../lib/store');

const fresh = () => open(fs.mkdtempSync(path.join(os.tmpdir(), 'sbrec-')), {});
const T = new Date(2026, 10, 16, 10, 0, 0).getTime();
const yn = (s, title, recommended, extra) => s.raise(Object.assign({ agent: 'claude-code:lighting-os', area: 'LightDeck', title, kind: 'decide', options: ['Yes', 'No'], recommended }, extra), T);

test('a recommendation must be one of the options, and follows them', () => {
  const s = fresh();
  assert.equal(yn(s, 'Merge PR 614?', 'Yes').recommended, 'Yes');
  const bad = yn(s, 'Merge PR 613?', 'Maybe');
  assert.equal(bad.recommended, '');
  assert.ok(s.warnings.some((w) => /recommended/.test(w)), 'said why it was ignored');
  const l = yn(s, 'Rename the repo?', 'No');
  s.update(l.id, { options: ['Now', 'Later'], agent: 'claude-code:lighting-os' }, 'claude-code:lighting-os', T + 1000);
  assert.equal(s.db.lights.find((x) => x.id === l.id).recommended, '', 'a recommendation that is no longer an option is dropped');
  const plain = s.raise({ agent: 'a', area: 'Shop', title: 'No recommendation', kind: 'decide', options: ['A', 'B'] }, T);
  assert.equal(plain.recommended, '');
  assert.equal(rev(plain), rev(Object.assign({}, plain, { recommended: undefined })), 'lights without one keep the fingerprint they had');
});

test('take every recommendation: each light is answered with its own, with the usual hold', () => {
  const s = fresh();
  const a = yn(s, 'Terms fix (PR 614)?', 'Yes'), b = yn(s, 'Rehearse a rollback?', 'Yes'), c = yn(s, 'Rename the repo?', 'No');
  const done = s.bulk([a.id, b.id, c.id], 'recommended', { revs: { [a.id]: rev(a), [b.id]: rev(b), [c.id]: rev(c) } }, T + 60e3);
  assert.equal(done.length, 3);
  for (const [l, v] of [[a, 'Yes'], [b, 'Yes'], [c, 'No']]) {
    const x = s.db.lights.find((y) => y.id === l.id);
    assert.equal(x.decision.value, v); assert.equal(x.decision.action, 'answer');
    assert.ok(x.decision.releaseAt > T + 60e3, 'still on its undo hold');
  }
  // Collected after the hold, each carries the answer that was recommended.
  const got = s.decisions(T + 5 * 60e3, { agent: 'claude-code:lighting-os' }).decisions.map((d) => d.value).sort();
  assert.deepEqual(got, ['No', 'Yes', 'Yes']);
});

test('refused as a whole when one has no recommendation, changed since it was seen, or is a message', () => {
  const s = fresh();
  const a = yn(s, 'Terms fix?', 'Yes'), none = s.raise({ agent: 'x', area: 'Shop', title: 'Pick one', kind: 'decide', options: ['A', 'B'] }, T);
  assert.throws(() => s.bulk([a.id, none.id], 'recommended', { revs: { [a.id]: rev(a), [none.id]: rev(none) } }, T + 1000), /recommend/);
  assert.equal(s.db.lights.find((x) => x.id === a.id).decision, null, 'nothing was answered');
  const b = yn(s, 'Rollback rehearsal?', 'Yes'), seen = rev(b);
  s.update(b.id, { recommended: 'No', agent: 'claude-code:lighting-os' }, 'claude-code:lighting-os', T + 2000);
  assert.throws(() => s.bulk([a.id, b.id], 'recommended', { revs: { [a.id]: rev(a), [b.id]: seen } }, T + 3000), /changed/i, 'a recommendation that changed after it was seen is not taken');
  const msg = s.raise({ agent: 'x', area: 'Shop', title: 'Reply to Dale', kind: 'approve', draft: 'Hi', outbound: true, to: 'Dale', options: ['Send', 'Hold'], recommended: 'Send' }, T);
  assert.throws(() => s.bulk([msg.id], 'recommended', { revs: { [msg.id]: rev(msg) } }, T + 4000), /message|person|recommend/i);
});
