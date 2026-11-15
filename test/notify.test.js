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
  const a = await start({ port: 0, dir, notify: { send: (t, b) => sent.push(b), titles: true, quiet: [0, 0] } }); // no quiet hours: the test runs at any hour
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

test('a text to the owner\'s own phone goes through Messages, with the words as arguments', () => {
  const { textSender } = require('../lib/notify');
  const calls = [];
  const send = textSender({ to: '+18595550123', platform: 'darwin', spawn: (cmd, args) => { calls.push([cmd, args]); return { on() {}, unref() {} }; } });
  send('Switchboard', '2 new things need you; "Dale" said `rm -rf`');
  assert.equal(calls[0][0], 'osascript');
  const args = calls[0][1], script = args.filter((a, i) => args[i - 1] === '-e');
  assert.ok(script.join(' ').includes('Messages') && !script.join(' ').includes('Dale') && !script.join(' ').includes('8595550123'), 'neither the number nor the words are spliced into the script');
  assert.deepEqual(args.slice(-2), ['+18595550123', 'Switchboard: 2 new things need you; "Dale" said `rm -rf`']);
  assert.equal(textSender({ to: 'pat@example.com', platform: 'darwin', spawn: () => ({ on() {}, unref() {} }) }) != null, true, 'an Apple ID email works too');
  assert.equal(textSender({ to: 'call me', platform: 'darwin' }), null, 'not a number or an email: no sender');
  assert.equal(textSender({ to: '+18595550123', platform: 'linux' }), null, 'Messages is a Mac app');
});

test('the board texts when SWITCHBOARD_NOTIFY_TEXT is set, adding the phone link when there is one', () => {
  const { sendersFromEnv } = require('../lib/notify');
  const calls = [], spawn = (cmd, args) => { calls.push(args.slice(-2)); return { on() {}, unref() {} }; };
  const only = sendersFromEnv({ SWITCHBOARD_NOTIFY_TEXT: '+18595550123', SWITCHBOARD_PHONE_URL: 'https://box.tailnet.ts.net:8443/' }, { platform: 'darwin', spawn });
  assert.equal(only.senders.length, 1, 'texting alone is enough to switch notifications on');
  only.senders[0]('Switchboard', '1 new thing needs you on Switchboard', 1);
  assert.deepEqual(calls[0], ['+18595550123', 'Switchboard: 1 new thing needs you https://box.tailnet.ts.net:8443/']);
  const both = sendersFromEnv({ SWITCHBOARD_NOTIFY: 'titles', SWITCHBOARD_NOTIFY_TEXT: '+18595550123' }, { platform: 'darwin', spawn });
  assert.equal(both.senders.length, 2, 'banner and text');
  both.senders[1]('Switchboard', 'Text Pat Lee (Acme Lighting)', 1);
  assert.deepEqual(calls[1], ['+18595550123', 'Switchboard: 1 new thing needs you'], 'a text never names the item unless asked: the banner may, the locked phone screen does not');
  const named = sendersFromEnv({ SWITCHBOARD_NOTIFY_TEXT: '+18595550123', SWITCHBOARD_NOTIFY_TEXT_TITLES: '1' }, { platform: 'darwin', spawn });
  named.senders[0]('Switchboard', 'Text Pat Lee (Acme Lighting)', 1);
  assert.deepEqual(calls[2], ['+18595550123', 'Switchboard: Text Pat Lee (Acme Lighting)']);
  const bad = sendersFromEnv({ SWITCHBOARD_NOTIFY_TEXT: 'my phone' }, { platform: 'darwin', spawn });
  assert.equal(bad.senders.length, 0); assert.match(bad.warning, /SWITCHBOARD_NOTIFY_TEXT/);
  assert.equal(sendersFromEnv({}, { platform: 'darwin', spawn }).senders.length, 0, 'off unless asked for');
});

test('with titles on, a message to a customer is never named in a banner or a text: no name, no number', () => {
  const sent = []; let now = at(10);
  const n = notifier({ send: (t, b) => sent.push(b), now: () => now, titles: true });
  n.check(view([]));
  now = at(10, 5); n.check(view([gold('c', 'Text Pat Henderson at 859-555-0142', { outbound: true, to: 'Pat Henderson' })]));
  assert.deepEqual(sent, ['a message to a customer is ready (Shop)']);
  now = at(11); n.check(view([gold('c', 'x', { outbound: true }), gold('d', 'Reply to Dale (859) 555-0142', { outbound: true }), gold('e', 'Renew the domain')]));
  assert.equal(sent.length, 2);
  assert.doesNotMatch(sent.join(' | '), /Pat|Henderson|Dale|859|555|0142/);
  assert.match(sent[1], /^2 new things need you: a message to a customer is ready \(Shop\) and 1 more$/);
});

test('banners follow the board\'s own switch: off on a new board, on from the page or setup\'s answer, and SWITCHBOARD_NOTIFY="false" is off', async () => {
  const { sendersFromEnv } = require('../lib/notify');
  const spawn = () => ({ on() {}, unref() {} });
  for (const v of ['false', '0', 'off', 'no']) assert.equal(sendersFromEnv({ SWITCHBOARD_NOTIFY: v }, { platform: 'darwin', spawn }).senders.length, 0, v);
  assert.equal(sendersFromEnv({ SWITCHBOARD_NOTIFY: 'true' }, { platform: 'darwin', spawn }).senders.length, 1);
  const sent = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbn-'));
  const a = await start({ port: 0, dir, banner: (t, b) => sent.push(b), quiet: [0, 0] });
  const raise = (title) => fetch(a.url + '/api/lights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 't', area: 'Shop', title, kind: 'todo', link: 'https://x' }) });
  const state = async (key) => (await fetch(a.url + '/api/state', { headers: key ? { 'x-switchboard-key': key } : {} })).json();
  try {
    let st = await state(a.key);
    assert.equal(st.bannersSetUp, true); assert.equal(st.banners, false); assert.equal(st.texts, false, 'a new board: no texts either');
    await raise('Order boxes');
    assert.deepEqual(sent, [], 'off: nothing shown');
    const r = await fetch(a.url + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ banners: true }) });
    assert.equal(r.status, 403, 'only the person\'s page switches it');
    await fetch(a.url + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-switchboard-key': a.key }, body: JSON.stringify({ banners: true }) });
    st = await state(a.key); assert.equal(st.banners, true);
    await raise('Renew the domain');
    assert.equal(sent.length, 1, 'on: the next new light shows, with no 30-minute wait left over from while it was off');
    assert.match(sent[0], /1 new thing needs you/);
  } finally { a.close(); }
});

test('a board saved before the texts switch existed has texts off; a change to SWITCHBOARD_NOTIFY wins over an earlier banners answer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbn-'));
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ version: 3, areas: [], lights: [], settings: { banners: false, notifyEnv: false } }));
  const { open } = require('../lib/store');
  assert.equal(open(dir).view().texts, false, 'no "texts" saved: off, not on');
  const was = process.env.SWITCHBOARD_NOTIFY;
  process.env.SWITCHBOARD_NOTIFY = '1';
  const errs = [], err = console.error; console.error = (m) => errs.push(String(m));
  let a;
  try {
    a = await start({ port: 0, dir, quiet: [0, 0] });
    const st = await (await fetch(a.url + '/api/state', { headers: { 'x-switchboard-key': a.key } })).json();
    assert.equal(st.banners, true, 'the Desktop toggle (SWITCHBOARD_NOTIFY) was turned on after the answer: it wins');
    assert.ok(errs.some((m) => /SWITCHBOARD_NOTIFY changed/.test(m)), errs.join('\n'));
  } finally { console.error = err; if (was === undefined) delete process.env.SWITCHBOARD_NOTIFY; else process.env.SWITCHBOARD_NOTIFY = was; if (a) a.close(); }
  // Unchanged since the answer: the answer stands.
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ version: 3, areas: [], lights: [], settings: { banners: false, notifyEnv: false } }));
  const b = await start({ port: 0, dir, quiet: [0, 0] });
  try { assert.equal((await (await fetch(b.url + '/api/state', { headers: { 'x-switchboard-key': b.key } })).json()).banners, false); } finally { b.close(); }
});
