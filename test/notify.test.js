'use strict';
// Desktop notifications (opt-in): when something new needs the person, one short banner, at most every 30 minutes,
// never in quiet hours, and never for what was already waiting when the board started.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { notifier, osSender } = require('../lib/notify');
const { start } = require('../server');

const at = (h, m = 0) => new Date(2026, 10, 16, h, m, 0).getTime(); // a Monday, local time
const gold = (id, title, extra) => Object.assign({ id, title, state: 'need_you', area: 'shop' }, extra);
const view = (lights) => ({ lights, areas: [{ id: 'shop', name: 'Shop' }] });

test('what was waiting at start is not announced; something new is, once', () => {
  const sent = []; let now = at(10);
  const n = notifier({ send: (t, b) => sent.push(b), now: () => now, titles: true });
  n.check(view([gold('a', 'Old one'), gold('b', 'Older one')]));
  assert.equal(sent.length, 0, 'the first look only learns what is already there');
  now = at(10, 5); n.check(view([gold('a', 'Old one'), gold('b', 'Older one'), gold('c', 'Text Dale back')]));
  assert.deepEqual(sent, ['Text Dale back (Shop)']);
  now = at(10, 6); n.check(view([gold('a', 'Old one'), gold('b', 'Older one'), gold('c', 'Text Dale back')]));
  assert.equal(sent.length, 1, 'never twice for the same light');
});

test('at most one banner every 30 minutes; what came in meanwhile goes in the next one', () => {
  const sent = []; let now = at(9);
  const n = notifier({ send: (t, b) => sent.push(b), now: () => now, titles: true });
  n.check(view([]));
  now = at(9, 1); n.check(view([gold('a', 'First')]));
  now = at(9, 10); n.check(view([gold('a', 'First'), gold('b', 'Second')]));
  now = at(9, 20); n.check(view([gold('a', 'First'), gold('b', 'Second'), gold('c', 'Third', { state: 'broken' })]));
  assert.deepEqual(sent, ['First (Shop)']);
  now = at(9, 31); n.check(view([gold('a', 'First'), gold('b', 'Second'), gold('c', 'Third', { state: 'broken' })]));
  assert.deepEqual(sent, ['First (Shop)', '2 new things need you: Second (Shop) and 1 more']);
});

test('quiet hours hold banners until morning; a light handled meanwhile is never announced', () => {
  const sent = []; let now = at(22, 50);
  const n = notifier({ send: (t, b) => sent.push(b), now: () => now, titles: true });
  n.check(view([]));
  now = at(23, 30); n.check(view([gold('a', 'Late one'), gold('b', 'Handled at night')]));
  assert.equal(sent.length, 0, 'nothing from 11 pm');
  now = at(7, 5) + 864e5; n.check(view([gold('a', 'Late one')]));
  assert.deepEqual(sent, ['Late one (Shop)']);
});

test('without titles a banner says only how many, so nothing private shows on a locked screen', () => {
  const sent = []; let now = at(12);
  const n = notifier({ send: (t, b) => sent.push(b), now: () => now });
  n.check(view([]));
  now = at(12, 1); n.check(view([gold('a', 'Text Pat Lee')]));
  assert.deepEqual(sent, ['1 new thing needs you on Switchboard']);
});

test('examples, done and lined-up lights never ring', () => {
  const sent = []; let now = at(12);
  const n = notifier({ send: (t, b) => sent.push(b), now: () => now, titles: true });
  n.check(view([]));
  now = at(12, 1); n.check(view([gold('a', 'Example', { demo: true }), gold('b', 'Later', { state: 'queued' }), gold('c', 'Done', { state: 'done' })]));
  assert.equal(sent.length, 0);
});

test('the macOS sender passes the words as arguments, never inside the script', () => {
  const calls = [];
  const send = osSender({ platform: 'darwin', spawn: (cmd, args) => { calls.push([cmd, args]); return { on() {}, unref() {} }; } });
  send('Switchboard', 'Say "hi" to Dale\'s crew; then `rm -rf`');
  assert.equal(calls[0][0], 'osascript');
  const args = calls[0][1], script = args.filter((a, i) => args[i - 1] === '-e');
  assert.ok(script.length && !script.join(' ').includes('Dale'), 'the text is not spliced into the AppleScript');
  assert.ok(calls[0][1].includes('Say "hi" to Dale\'s crew; then `rm -rf`'), 'it is passed as its own argument');
  assert.equal(osSender({ platform: 'win32' }), null, 'no sender where there is none');
});

test('the board rings when a light that needs the person is raised, and only when switched on', async () => {
  const sent = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbn-'));
  const a = await start({ port: 0, dir, notify: { send: (t, b) => sent.push(b), titles: true } });
  try {
    await fetch(a.url + '/api/lights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 't', area: 'Shop', title: 'Which size?', kind: 'decide', options: ['S', 'L'] }) });
    assert.deepEqual(sent, ['Which size? (Shop)']);
  } finally { a.close(); }
  const quiet = [], b = await start({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'sbn-')) });
  try {
    await fetch(b.url + '/api/lights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 't', area: 'Shop', title: 'Which size?', kind: 'decide', options: ['S', 'L'] }) });
    assert.equal(quiet.length, 0);
  } finally { b.close(); }
});
