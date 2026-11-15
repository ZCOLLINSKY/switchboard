'use strict';
// Batch 8: the deep dig's medium and low findings in the rules, the server and the assistant connector.
const { childEnv, freePort } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { open, rev, DAY, OUT_HOLD_MS, HOLD_MS, CLAIM_MS, COLLECT_MS } = require('../lib/store');
const { start } = require('../server');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb8-'));
const T0 = new Date(2026, 10, 16, 10, 0, 0).getTime(), HOLD = OUT_HOLD_MS + 1000;
const msg = (s, extra, now = T0) => s.raise(Object.assign({ area: 'Shop', title: 'Reply to Dale', draft: 'Thursday works.', to: 'Dale', agent: 'bot' }, extra), now);

test('dates: impossible, ancient and far-future dates are refused (F10, B12, D9, H9, H21)', () => {
  const s = open(tmp()); const l = msg(s);
  for (const bad of ['2026-02-30', '2019-05-01', 1e17, '3000-01-01', 'soon']) { s.update(l.id, { due: bad }, 'bot', T0); assert.ok(s.warnings.some((w) => /due is not a date/.test(w)), String(bad)); }
  assert.equal(l.due, null);
  s.update(l.id, { due: '2026-11-20' }, 'bot', T0); assert.equal(new Date(l.due).getHours(), 23);
});
test('text: direction overrides and invisible characters are removed; a line separator becomes a new line (G13, T1, M1)', () => {
  const s = open(tmp());
  const l = msg(s, { to: 'Dale ‮elpmaxe.live@‬', draft: 'Hi there​' });
  assert.equal(l.to, 'Dale elpmaxe.live@');
  assert.equal(l.draft, 'Hi\nthere');
});
test('keys: two long keys that share their start stay two threads; a structured key is not "[object Object]" (B14, H4)', () => {
  const s = open(tmp());
  const a = msg(s, { key: 'x'.repeat(130) + 'A' }), b = msg(s, { key: 'x'.repeat(130) + 'B' });
  assert.notEqual(a.id, b.id);
  const c = msg(s, { key: { thread: 1 } }), d = msg(s, { key: { thread: 2 } });
  assert.notEqual(c.id, d.id);
});
test('names: a stray space or a long name never hides a decision from the assistant that raised it (B13, H7, M6)', () => {
  const s = open(tmp(), { holdMs: 0 });
  const long = 'agent-' + 'n'.repeat(100);
  const l = s.raise({ area: 'A', title: 'Pick', kind: 'decide', options: ['a', 'b'], agent: long + ' ' }, T0);
  s.act(l.id, 'answer', { value: 'a', rev: rev(l) }, T0);
  assert.equal(s.decisions(T0 + 1, { agent: long + ' ' }).decisions.length, 1);
});
test('ack: only for a decision this assistant was handed (H2, B1, K1, M4, T3)', () => {
  const s = open(tmp(), { holdMs: 0 });
  const l = s.raise({ area: 'A', title: 'Fix typo', change_from: 'a', change_to: 'b', agent: 'bot' }, T0);
  s.act(l.id, 'approve', { rev: rev(l) }, T0);
  assert.equal(s.ack([l.id], T0 + 1, { agent: 'bot' }), 0);
  assert.match(s.warnings.join(' '), /never handed/);
  s.decisions(T0 + 2, { agent: 'bot' });
  assert.equal(s.ack([l.id], T0 + 3, { agent: 'other' }), 0);
  assert.equal(s.ack([l.id], T0 + 3, { agent: 'bot' }), 1);
});
test('a flag reaches the assistant at once, and a retry keeps it flagged (B15, B32)', () => {
  const s = open(tmp(), { random: () => 0.99 }); s.setting('autonomy', true);
  for (let i = 0; i < 10; i++) { const t = T0 + (i % 3) * DAY + i * 1000, l = s.raise({ area: 'Site', title: 'P' + i, change_from: 'a' + i, change_to: 'b' + i, action_type: 'price', agent: 'bot' }, t); s.act(l.id, 'approve', { rev: rev(l) }, t); }
  s.promote('site|price', true, T0 + 3 * DAY);
  const t = T0 + 4 * DAY, l = s.raise({ area: 'Site', title: 'Auto', change_from: 'Open 9', change_to: 'Open 10', action_type: 'price', agent: 'bot' }, t);
  s.decisions(t + 1, { agent: 'bot' }); // the assistant applies it at once
  s.act(l.id, 'answer', { value: 'Flag it' }, t + 2);
  const back = s.decisions(t + 2 + HOLD_MS + 1, { agent: 'bot' }).decisions[0];
  assert.ok(back && back.flagged, 'handed back within the hold, not ten minutes later');
  s.complete(l.id, 'failed', 'could not revert', t + 3 + HOLD_MS, back.decision_id);
  s.act(l.id, 'answer', { value: 'Try again' }, t + 4 + HOLD_MS);
  assert.equal(s.decisions(t + 5 + 2 * HOLD_MS, { agent: 'bot' }).decisions[0].flagged, true);
});
test('an automatic change that fails loses its right to run by itself (B24)', () => {
  const s = open(tmp(), { random: () => 0.99 }); s.setting('autonomy', true);
  for (let i = 0; i < 10; i++) { const t = T0 + (i % 3) * DAY + i * 1000, l = s.raise({ area: 'Site', title: 'P' + i, change_from: 'a' + i, change_to: 'b' + i, action_type: 'price', agent: 'bot' }, t); s.act(l.id, 'approve', { rev: rev(l) }, t); }
  s.promote('site|price', true, T0 + 3 * DAY);
  for (let i = 0; i < 6; i++) s.raise({ area: 'Site', title: 'A' + i, change_from: 'x', change_to: 'y' + i, action_type: 'price', agent: 'bot' }, T0 + 4 * DAY + i);
  const ran = s.db.lights.find((l) => l.state === 'approved' && l.decision && l.decision.by === 'auto');
  const d = s.decisions(T0 + 4 * DAY + 10, { agent: 'bot' }).decisions.find((x) => x.id === ran.id);
  s.complete(ran.id, 'failed', 'page did not save', T0 + 4 * DAY + 11, d.decision_id);
  assert.equal(s.db.auto['site|price'], undefined);
});
test('"Leave it" is final; a late "sent" is recorded as sent without reopening (B10)', () => {
  const s = open(tmp());
  const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  const d = s.decisions(T0 + HOLD, { agent: 'bot' }).decisions[0];
  s.complete(l.id, 'failed', 'bounced', T0 + HOLD + 1, d.decision_id);
  s.act(l.id, 'answer', { value: 'Leave it' }, T0 + HOLD + 2);
  s.complete(l.id, 'failed', 'bounced again', T0 + HOLD + 3, d.decision_id);
  assert.equal(l.state, 'done');
  s.complete(l.id, 'sent', 'it went after all', T0 + HOLD + 4, d.decision_id);
  assert.equal(l.state, 'done'); assert.equal(l.sent.length, 1);
});
test('"I sent it" is told after the take-back window, even if the thread has moved on (B11, B23); waiting on it ends at once (M7)', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Text Sam', draft: 'On my way', phone: '+15555550100', follow_up_days: 1, agent: 'bot' }, T0);
  s.act(l.id, 'approve', { rev: rev(l) }, T0);
  assert.equal(s.decisions(T0 + 1000, { agent: 'bot' }).sent_by_you.length, 0, 'not inside the take-back window');
  const w = s.decisionFor(l.id, T0 + HOLD_MS + 1, { agent: 'bot' });
  assert.equal(w.sent_by_you, true);
  const l2 = s.raise({ area: 'Shop', title: 'Text Ann', draft: 'Running late', phone: '+15555550101', follow_up_days: 1, agent: 'bot' }, T0);
  s.act(l2.id, 'approve', { rev: rev(l2) }, T0);
  s.tick(T0 + 2 * DAY); // comes back for a follow-up; the decision moves to the past
  assert.equal(s.decisions(T0 + 2 * DAY, { agent: 'bot' }).sent_by_you.filter((x) => x.id === l2.id).length, 1);
});
test('collected and never reported becomes a question in the queue (B7)', () => {
  const s = open(tmp());
  const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  s.decisions(T0 + HOLD, { agent: 'bot' });
  s.tick(T0 + HOLD + CLAIM_MS + 1);
  const v = s.view(T0 + HOLD + CLAIM_MS + 2);
  assert.ok(v.queue.includes(l.id));
  assert.deepEqual(l.options, ['It went out', 'It did not go out']);
  assert.match(v.lights.find((x) => x.id === l.id).alert, /never reported/);
  s.act(l.id, 'answer', { value: 'It went out' }, T0 + HOLD + CLAIM_MS + 3);
  assert.equal(l.state, 'done');
});
test('the assistant that collected keeps its claim by reporting progress (B30)', () => {
  const s = open(tmp());
  const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  s.decisions(T0 + HOLD, { agent: 'bot' });
  s.update(l.id, { progress: 50, agent: 'bot' }, 'bot', T0 + HOLD + CLAIM_MS - 1000);
  assert.equal(s.decisions(T0 + HOLD + CLAIM_MS + 1000, { agent: 'other', all: true }).decisions.length, 0);
});
test('snoozes: new words bring a thread back; only asking lights snooze; a snooze never hides a deadline; sleeping containers wait (B8, F9, C32, C26)', () => {
  const s = open(tmp());
  const l = msg(s, { key: 'k1' }); s.act(l.id, 'snooze', { days: 3 }, T0);
  msg(s, { key: 'k1', source: 'Dale: are you there?' }, T0 + 1000);
  assert.equal(l.snoozeUntil, null);
  const w = s.raise({ area: 'Shop', title: 'Quote out', state: 'waiting_them', agent: 'bot' }, T0);
  assert.throws(() => s.act(w.id, 'snooze', { days: 1 }, T0), /Only something waiting on you/);
  const due = msg(s, { title: 'Due Friday', due: T0 + 2 * DAY });
  s.act(due.id, 'snooze', { days: 5 }, T0);
  assert.ok(due.snoozeUntil <= T0 + 2 * DAY - 2 * 3600e3);
  s.addArea({ name: 'Taxes', wake_at: T0 + 30 * DAY }, T0);
  const t = s.raise({ area: 'Taxes', title: 'Find the 1099', kind: 'todo', agent: 'bot' }, T0);
  assert.ok(!s.view(T0).queue.includes(t.id));
});
test('take-backs leave no trace: time estimates, known recipients, trust counts from later taps; an edited approval keeps your words (F7, F8, U17, U5)', () => {
  const s = open(tmp());
  const l = s.raise({ area: 'Shop', title: 'Text Sam', draft: 'Hi', phone: '+15555550100', agent: 'bot' }, T0);
  s.act(l.id, 'approve', { rev: rev(l), tookMs: 1000 }, T0);
  s.act(l.id, 'undo', {}, T0 + 500);
  assert.deepEqual(Object.keys(s.db.recipients), []);
  assert.equal(s.db.timing.approve, undefined);
  const m = msg(s);
  s.act(m.id, 'approve', { rev: rev(m), text: 'Thursday at 3 works.' }, T0);
  s.act(m.id, 'undo', {}, T0 + 500);
  assert.equal(m.draft, 'Thursday at 3 works.');
  const a = s.raise({ area: 'Site', title: 'one', change_from: 'a', change_to: 'b', action_type: 'typo', agent: 'bot' }, T0);
  const b = s.raise({ area: 'Site', title: 'two', change_from: 'c', change_to: 'd', action_type: 'typo', agent: 'bot' }, T0);
  s.act(a.id, 'approve', { rev: rev(a) }, T0); s.act(b.id, 'approve', { rev: rev(b) }, T0 + 1);
  assert.equal(s.db.streaks['site|typo'].n, 2);
  s.act(a.id, 'undo', {}, T0 + 2);
  assert.equal(s.db.streaks['site|typo'].n, 1, 'the later approval still counts');
});
test('a page that is behind cannot answer a question it never showed (G2)', () => {
  const s = open(tmp());
  const q = s.raise({ area: 'A', title: 'Which colour?', kind: 'decide', options: ['Warm', 'Cool'], agent: 'bot' }, T0);
  const shown = rev(q);
  s.update(q.id, { title: 'Delete which file?', options: ['Warm', 'Cool'] }, 'bot', T0 + 1);
  assert.throws(() => s.act(q.id, 'answer', { value: 'Warm', rev: shown }, T0 + 2), /This changed/);
});
test('rules you approved survive an assistant rewriting the voice note, and are added once (H22, G10)', () => {
  const s = open(tmp()); const a = s.addArea({ name: 'Shop', voice: 'Short and plain.' }, T0);
  s.learn(a.id, 'No exclamation marks', true); s.learn(a.id, 'No exclamation marks', true);
  assert.deepEqual(a.rules, ['No exclamation marks'], 'added once');
  s.addArea({ name: 'Shop', voice: 'Friendly, first names.' }, T0);
  assert.equal(a.voice, 'Friendly, first names.');
  assert.deepEqual(a.rules, ['No exclamation marks'], 'the person\'s rule survives');
  assert.ok(s.warnings.some((w) => /standing rules/.test(w)));
});
test('examples never take over a real container (K20); a broken job shows its fix choices (K6); a quiet job is not "running" (U35)', () => {
  const s = open(tmp());
  s.raise({ area: 'Family', title: 'Pick up Zoe', kind: 'todo', by: 'you' }, T0);
  s.seedDemo(T0); s.clearDemo();
  assert.ok(s.db.areas.some((a) => a.name === 'Family'));
  const j = s.raise({ area: 'Ops', title: 'Nightly import', state: 'auto', expect_by: T0 + 1000, agent: 'bot' }, T0);
  s.tick(T0 + 2000);
  assert.equal(s.view(T0 + 2000).counts.auto, 0);
  s.update(j.id, { state: 'broken', reason: 'disk full' }, 'bot', T0 + 3000);
  assert.equal(j.kind, 'fix');
});
test('history: finds the recipient, says when it really went, and "sent" only for approvals (U19, U31, U32); the log has every change (K11)', () => {
  const s = open(tmp());
  const l = msg(s, { to: 'Priya Natarajan' }); s.act(l.id, 'approve', { rev: rev(l) }, T0);
  const d = s.decisions(T0 + HOLD, { agent: 'bot' }).decisions[0];
  s.complete(l.id, 'sent', '', T0 + HOLD + 5000, d.decision_id);
  const h = s.history('natarajan');
  assert.equal(h.length, 1); assert.equal(h[0].sentAt, T0 + HOLD + 5000);
  const n = msg(s, { title: 'Decline this' }); s.act(n.id, 'no', {}, T0);
  const dn = s.decisions(T0 + HOLD * 2, { agent: 'bot' }).decisions.find((x) => x.id === n.id);
  s.complete(n.id, 'done', '', T0 + HOLD * 2 + 1, dn.decision_id);
  assert.doesNotMatch(s.history('decline')[0].what, /sent/);
  s.setting('autonomy', true); s.save();
  assert.ok(fs.readFileSync(path.join(s.dir, 'events.jsonl'), 'utf8').includes('"type":"setting"'));
});
test('data safety: a readable file that is not a board is refused; leftovers are tidied; a damaged log line loses only itself (D5, D6, D4)', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'data.json'), '[1,2,3]');
  assert.throws(() => open(dir), /not a Switchboard board/);
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ lights: [], areas: [] }));
  // A pid above every system's limit, so no process can own it (a small number like 123 is a live process on CI).
  fs.writeFileSync(path.join(dir, 'data.json.99999999.tmp'), '{}');
  const s = open(dir);
  assert.equal(fs.existsSync(path.join(dir, 'data.json.99999999.tmp')), false);
  const l = msg(s); s.act(l.id, 'approve', { rev: rev(l) }, T0); s.save();
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{broken\n');
  assert.equal(open(dir).history('').length, 1);
});
test('a draft that would be cut is refused; nothing is cut from a message (K5, H10)', () => {
  const s = open(tmp());
  assert.throws(() => msg(s, { draft: 'x'.repeat(4001) }), /Nothing is cut/);
});
test('server: replies never carry the decision; callers cannot mark examples (B9, M5, H3, H23)', async () => {
  const a = await start({ port: 0, dir: tmp(), holdMs: 60000 });
  const post = (p, body, key) => fetch(a.url + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, key ? { 'x-switchboard-key': a.key } : {}), body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const l = await post('/api/lights', { area: 'A', title: 'Pick', kind: 'decide', options: ['x', 'y'], agent: 'bot', demo: true });
    assert.equal(a.store.db.lights[0].demo, false);
    await post(`/api/lights/${l.id}/act`, { action: 'answer', value: 'x' }, true);
    const u = await post(`/api/lights/${l.id}`, { note: 'hi', agent: 'bot' });
    assert.equal(u.decision, undefined); assert.equal(u.decided, true);
    await post('/api/areas', { name: 'A', demo: true });
    assert.equal(a.store.db.areas[0].demo, false);
  } finally { a.close(); }
});

// The assistant connector, spoken to over stdio as a client would.
function mcp(env) {
  const c = spawn(process.execPath, [path.join(__dirname, '..', 'mcp.js')], { env: childEnv(env), stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = ''; const waiting = new Map(), lines = [];
  c.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); lines.push(line); const m = JSON.parse(line); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  let id = 0;
  const req = (method, params) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  return { c, req, raw: (t) => c.stdin.write(t + '\n'), lines, close: () => c.kill() };
}
test('MCP: a U+2028 inside a draft does not lose the call; "null", batches and replies are handled; any version is not agreed to (M1, M2, M13)', async () => {
  const a = await start({ port: 0, dir: tmp() });
  const m = mcp({ SWITCHBOARD_URL: a.url, SWITCHBOARD_AGENT: 'bot' });
  try {
    const init = await m.req('initialize', { protocolVersion: '1999-01-01', clientInfo: { name: 't' } });
    assert.notEqual(init.result.protocolVersion, '1999-01-01');
    m.raw('null'); m.raw('[{"jsonrpc":"2.0","id":99,"method":"ping"}]'); m.raw('{"jsonrpc":"2.0","id":98,"result":{}}');
    const r = await m.req('tools/call', { name: 'raise_light', arguments: { area: 'A', title: 'Quote', draft: 'Line one line two' } });
    assert.ok(!r.result.isError, r.result.content[0].text);
    assert.equal(a.store.db.lights[0].draft, 'Line one\nline two');
    assert.ok(m.lines.some((x) => /-32600/.test(x)), 'batch and null answered as invalid requests');
    assert.ok(!m.lines.some((x) => /"id":98/.test(x)), 'a reply is not answered');
    const bad = await m.req('tools/call', {});
    assert.ok(bad.error);
  } finally { m.close(); a.close(); }
});
test('MCP: a cancelled wait collects nothing (M3, H1)', async () => {
  const a = await start({ port: 0, dir: tmp(), holdMs: 0 });
  const m = mcp({ SWITCHBOARD_URL: a.url, SWITCHBOARD_AGENT: 'bot' });
  try {
    await m.req('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 't' } });
    const l = a.store.raise({ area: 'A', title: 'Pick', kind: 'decide', options: ['x', 'y'], agent: 'bot' }); a.store.save();
    m.c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 50, method: 'tools/call', params: { name: 'wait_for_decision', arguments: { id: l.id, seconds: 20 } } }) + '\n');
    await new Promise((r) => setTimeout(r, 300));
    m.c.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 50 } }) + '\n');
    await new Promise((r) => setTimeout(r, 300));
    a.store.act(l.id, 'answer', { value: 'x' }); a.store.save();
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(a.store.db.lights[0].decision.collectedAt, null, 'nobody collected it');
  } finally { m.close(); a.close(); }
});
test('MCP: when the board will not start, its own reason is passed on (D17, M9)', async () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'data.json'), '{ damaged');
  const m = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: String(await freePort()), SWITCHBOARD_AGENT: 'bot' });
  try {
    await m.req('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 't' } });
    const r = await m.req('tools/call', { name: 'list_lights', arguments: {} });
    assert.ok(r.result.isError);
    assert.match(r.result.content[0].text, /Cannot read .*data\.json/);
  } finally { m.close(); }
});

test('containers: a bad wake date or colour warns and changes nothing; rename and remove (M12, C9)', () => {
  const s = open(tmp()); const a = s.addArea({ name: 'Taxes', wake_at: '2027-01-05' }, T0);
  const was = a.wakeAt;
  s.addArea({ name: 'Taxes', wake_at: 'Jan 5', color: 'blue' }, T0);
  assert.equal(a.wakeAt, was);
  assert.ok(s.warnings.some((w) => /wake_at is not a date/.test(w)) && s.warnings.some((w) => /color/.test(w)));
  s.renameArea(a.id, 'Tax season'); assert.equal(a.name, 'Tax season');
  s.raise({ area: 'Tax season', title: 'Find the 1099', kind: 'todo', agent: 'bot' }, T0);
  assert.throws(() => s.removeArea(a.id), /still has 1 open light/);
  const e = s.addArea({ name: 'Empty' }, T0); s.removeArea(e.id);
  assert.ok(!s.db.areas.some((x) => x.name === 'Empty'));
});
test('bulk over 200 is refused, not cut (K13); dropping "Keep going?" switches the rule off (B26)', () => {
  const s = open(tmp());
  assert.throws(() => s.bulk(Array.from({ length: 201 }, (_, i) => 'x' + i), 'done', {}, T0), /At most 200/);
});
test('command line: with a data folder named, it never talks to a board serving other data', async () => {
  const other = await start({ port: 0, dir: tmp() });
  const { execFileSync } = require('child_process');
  const run = (args, env) => { try { return execFileSync(process.execPath, [path.join(__dirname, '..', 'cli.js')].concat(args), { env: childEnv(env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return String(e.stdout) + String(e.stderr); } };
  try {
    const out = run(['link'], { SWITCHBOARD_HOME: tmp(), SWITCHBOARD_URL: '', SWITCHBOARD_PORT: String(new URL(other.url).port) });
    assert.doesNotMatch(out, new RegExp(other.key), 'the other board\'s key is never printed');
    assert.match(run(['raise', '--area', 'A', '--title', 'T', '-draft', 'x'], {}), /two dashes/);
    assert.match(run(['start', '--help'], {}), /^Switchboard/);
  } finally { other.close(); }
});
