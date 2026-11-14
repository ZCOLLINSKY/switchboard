'use strict';
// The board keeps a copy of its data file once a day in backups/, the last 14 days, so a damaged or mistaken data file
// can be put back. A copy is made the first time the board saves on a new day, and never written over that day.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../lib/store');

const day = (d) => `data-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;

test('a daily copy of the data file, the last 14 days, private to this user', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbb-')), b = path.join(dir, 'backups');
  fs.mkdirSync(b, { mode: 0o700 });
  for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(b, `data-2025-01-${String(i).padStart(2, '0')}.json`), '{}');
  fs.writeFileSync(path.join(b, 'notes.txt'), 'not a backup: left alone');
  const s = open(dir, {});
  s.raise({ area: 'Shop', title: 'First', kind: 'todo' }); s.save();
  const today = path.join(b, day(new Date()));
  assert.ok(fs.existsSync(today), 'today has a copy');
  assert.equal(JSON.parse(fs.readFileSync(today, 'utf8')).lights.length, 1);
  assert.equal(fs.statSync(today).mode & 0o777, 0o600);
  s.raise({ area: 'Shop', title: 'Second', kind: 'todo' }); s.save();
  assert.equal(JSON.parse(fs.readFileSync(today, 'utf8')).lights.length, 1, 'the day\'s copy is not written over');
  const kept = fs.readdirSync(b).filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  assert.equal(kept.length, 14, 'the newest 14 days are kept');
  assert.equal(kept[kept.length - 1], day(new Date()));
  assert.ok(fs.existsSync(path.join(b, 'notes.txt')), 'other files in the folder are not touched');
});
