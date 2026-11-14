'use strict';
require('./fixtures/env'); // the same result whatever SWITCHBOARD_* settings the caller has
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../lib/store');
const { scenarios } = require('../scenarios');
const NOW = Date.UTC(2026, 0, 9, 14);
const build = (name) => { const s = open(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sc-'))); scenarios[name].build(s, NOW); return s; };

test('every scenario builds and can be viewed', () => {
  for (const name of Object.keys(scenarios)) { const v = build(name).view(NOW); assert.ok(Array.isArray(v.queue), name); }
});
test('morning is a believable handful', () => { const v = build('morning').view(NOW); assert.ok(v.queue.length >= 7 && v.queue.length <= 12); assert.equal(v.counts.broken, 1); });
test('slammed has 30+ lights and stale ones', () => { const v = build('slammed').view(NOW); assert.ok(v.queue.length >= 30); assert.ok(v.lights.some((l) => l.stale)); assert.equal(v.counts.broken, 3); });
test('comeback returns follow-ups, one needing a draft, and wakes an area', () => {
  const s = build('comeback'), v = s.view(NOW);
  assert.ok(v.lights.filter((l) => /^Follow up: /.test(l.title)).length >= 3);
  assert.ok(s.decisions().need_drafts.length >= 1);
  assert.ok(v.lights.some((l) => /is back\./.test(l.title)));
  assert.ok(v.lights.some((l) => l.snoozed));
});
test('trusted has earned a streak; the offer appears only once autonomy is switched on', () => {
  const s = build('trusted');
  assert.equal(s.view(NOW).promote.length, 0);
  assert.equal(s.view(NOW).autonomy.earning[0].streak, 10);
  s.setting('autonomy', true);
  assert.deepEqual(s.view(NOW).promote.map((p) => p.type), ['listing-fix']);
});
test('clear has nothing for you but things still moving', () => { const v = build('clear').view(NOW); assert.equal(v.queue.length, 0); assert.ok(v.counts.waiting_them > 0 && v.counts.auto > 0); assert.equal(v.clearedToday, 4); });
test('first-day is truly empty', () => { const v = build('first-day').view(NOW); assert.equal(v.areas.length, 0); assert.equal(v.lights.length, 0); });
test('live events run against the morning board', () => {
  const s = build('morning');
  const find = (start) => s.db.lights.find((l) => l.title.startsWith(start) && l.state !== 'done' && l.state !== 'dropped');
  for (const ev of scenarios.morning.live) ev.run(s, NOW + ev.at * 1000, find);
  const v = s.view(NOW + 200000);
  assert.ok(v.lights.some((l) => /Parkers said yes/.test(l.title)));
  assert.ok(v.counts.broken >= 2);
});
