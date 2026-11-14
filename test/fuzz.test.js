'use strict';
// A short pass of scripts/fuzz.js on every run: random assistants, taps, take-backs and clock jumps, checked after
// every step against the promises about decisions. A long pass: node scripts/fuzz.js 60 500.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const { fuzz } = require('../scripts/fuzz');

test('random sequences never break the promises about decisions', () => {
  const r = fuzz(6, 300);
  assert.deepEqual(r.violations, {}, JSON.stringify(r.first));
  assert.ok(r.coverage.handed > 50 && r.coverage.undone > 5 && r.coverage.outbound_handed > 5 && r.coverage.completed > 20, 'the run reached the paths it checks: ' + JSON.stringify(r.coverage));
});
