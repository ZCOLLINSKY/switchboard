'use strict';
// A session closes its own lights, finds what was answered before, and is told at raise time what would make a light
// easier to answer. Plus deep links, and the home-screen app files.
const { childEnv, freePort } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const { open, rev, DAY, HOLD_MS, OUT_HOLD_MS } = require('../lib/store');
const { notifier, textSender, osSender } = require('../lib/notify');
const { start } = require('../server');
const root = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbcl-'));
const T = new Date(2026, 10, 16, 10, 0, 0).getTime();
const has = (s, re) => s.warnings.some((w) => re.test(w));

// ---- raise-time lint (warnings only, never refusals)
test('lint: a decide with options and no recommendation is told to recommend', () => {
  const s = open(tmp(), {});
  const l = s.raise({ agent: 'a', area: 'Shop', title: 'Pick a plan?', kind: 'decide', options: ['A', 'B'] }, T);
  assert.ok(l && l.id, 'raised anyway');
  assert.ok(has(s, /recommended/), s.warnings.join('|'));
  s.raise({ agent: 'a', area: 'Shop', title: 'Pick a plan 2?', kind: 'decide', options: ['A', 'B'], recommended: 'A' }, T);
  assert.ok(!has(s, /recommended/), 'no warning when recommended');
  s.raise({ agent: 'a', area: 'Shop', title: 'One option', kind: 'decide', options: ['A'] }, T);
  assert.ok(!has(s, /recommended/), 'one option needs no recommendation');
});
test('lint: approve and outbound lights without a draft, outbound without to, todo without link', () => {
  const s = open(tmp(), {});
  s.raise({ agent: 'a', area: 'Shop', title: 'Send quote', kind: 'approve' }, T);
  assert.ok(has(s, /draft/), s.warnings.join('|'));
  s.raise({ agent: 'a', area: 'Shop', title: 'Email Dale', kind: 'approve', outbound: true, draft: 'Hi' }, T);
  assert.ok(has(s, /\bto\b/) && !has(s, /no draft|without a draft|needs a draft/), s.warnings.join('|'));
  s.raise({ agent: 'a', area: 'Shop', title: 'Mow', kind: 'todo' }, T);
  assert.ok(has(s, /link/), s.warnings.join('|'));
  s.raise({ agent: 'a', area: 'Shop', title: 'Mow 2', kind: 'todo', link: 'https://example.com/x' }, T);
  assert.ok(!has(s, /link/), s.warnings.join('|'));
  s.raise({ agent: 'a', area: 'Shop', title: 'Chase Dale', state: 'waiting_them', kind: 'approve', outbound: true, to: 'Dale', draft: 'Hi' }, T);
  assert.ok(has(s, /follow-up/i), s.warnings.join('|'));
  s.raise({ agent: 'a', area: 'Shop', title: 'Chase Dale 2', state: 'waiting_them', kind: 'approve', outbound: true, to: 'Dale', draft: 'Hi', follow_up_draft: 'Checking in', follow_up_days: 2 }, T);
  assert.ok(!has(s, /follow-up/i), s.warnings.join('|'));
  const clean = s.raise({ agent: 'a', area: 'Shop', title: 'Ready', kind: 'approve', outbound: true, to: 'Dale', draft: 'Hi' }, T);
  assert.deepEqual(s.warnings, [], 'a complete light has no warnings');
  assert.ok(clean.id);
});

// ---- answered before
test('raise warns when the same key was answered in the last 14 days, quoting the answer and the date', () => {
  const s = open(tmp(), {});
  const l = s.raise({ agent: 'a', area: 'Shop', title: 'Renew the domain?', kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes', key: 'renew-domain' }, T);
  s.act(l.id, 'answer', { value: 'No', rev: rev(l) }, T + 1000);
  const d = s.decisions(T + 1000 + HOLD_MS + 1000, { agent: 'a' }).decisions[0];
  s.complete(l.id, 'done', '', T + 1000 + HOLD_MS + 2000, d.decision_id);
  s.raise({ agent: 'a', area: 'Shop', title: 'Renew the domain?', kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes', key: 'renew-domain' }, T + 3 * DAY);
  assert.ok(has(s, /answered.*2026-11-16.*No/), s.warnings.join('|'));
  s.raise({ agent: 'a', area: 'Shop', title: 'Renew the domain?', kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes', key: 'renew-domain' }, T + 20 * DAY);
  assert.ok(!has(s, /answered.*2026-11-16/), 'older than 14 days: no warning');
  s.raise({ agent: 'a', area: 'Shop', title: 'Other', kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes', key: 'another' }, T + 3 * DAY);
  assert.ok(!has(s, /answered/), 'a different key');
});

// ---- closing
test('close: update with closing finishes a light, but never while a decision on it is out', () => {
  const s = open(tmp(), {});
  const l = s.raise({ agent: 'a', area: 'Shop', title: 'Reply to Dale', kind: 'approve', outbound: true, to: 'Dale', draft: 'Thursday.', key: 'dale' }, T);
  s.act(l.id, 'approve', { rev: rev(l) }, T + 1000);
  assert.throws(() => s.update(l.id, { state: 'done', closing: true, agent: 'a' }, 'a', T + 2000), /decision|approv/i);
  const d = s.decisions(T + OUT_HOLD_MS + 5000, { agent: 'a' }).decisions[0];
  assert.throws(() => s.update(l.id, { state: 'done', closing: true, agent: 'a' }, 'a', T + OUT_HOLD_MS + 5001), /complete_decision|decision/i, 'collected but not reported');
  s.complete(l.id, 'sent', '', T + OUT_HOLD_MS + 6000, d.decision_id);
  const k = s.raise({ agent: 'a', area: 'Shop', title: 'Build site', state: 'auto', key: 'site' }, T);
  s.update(k.id, { state: 'done', closing: true, reason: 'finished', agent: 'a' }, 'a', T + 10);
  assert.equal(s.db.lights.find((x) => x.id === k.id).state, 'done');
  assert.ok(!has(s, /unknown field/), s.warnings.join('|'));
});

// ---- the connector
function mcp(env) {
  const c = spawn(process.execPath, [path.join(root, 'mcp.js')], { env: childEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', id = 0; const waiting = new Map();
  c.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); const m = JSON.parse(line); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const req = (method, params) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const call = async (name, args) => { const r = (await req('tools/call', { name, arguments: args || {} })).result; let json; try { json = JSON.parse(r.content[0].text); } catch (e) { /* plain text */ } return { error: !!r.isError, text: r.content[0].text, json }; };
  return { call, req, hello: () => req('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 't' } }), close: () => c.kill() };
}
async function board(agentEnv) {
  const dir = tmp(), b = await start({ port: await freePort(), dir }), port = new URL(b.url).port;
  const m = mcp(Object.assign({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: port, SWITCHBOARD_AGENT: 'bot' }, agentEnv));
  await m.hello();
  return { b, m, dir, done: () => { m.close(); b.close(); } };
}

test('connector: list_lights returns what a session needs to find its own lights', async () => {
  const x = await board();
  try {
    await x.m.call('raise_light', { area: 'Shop', title: 'Pick', kind: 'decide', options: ['A', 'B'], recommended: 'A', key: 'pick-1', link: 'https://example.com/p', due: '2026-12-01' });
    const r = (await x.m.call('list_lights')).json.lights[0];
    assert.equal(r.key, 'pick-1'); assert.equal(r.link, 'https://example.com/p'); assert.equal(r.agent, 'bot');
    assert.equal(r.recommended, 'A'); assert.equal(r.kind, 'decide'); assert.deepEqual(r.options, ['A', 'B']); assert.ok(r.due, 'due');
  } finally { x.done(); }
});

test('connector: update_light and close_light find the caller\'s own open light by key', async () => {
  const x = await board();
  try {
    const raised = (await x.m.call('raise_light', { area: 'Shop', title: 'Build site', state: 'auto', key: 'site' })).json;
    const u = await x.m.call('update_light', { key: 'site', progress: 'half way' });
    assert.ok(!u.error, u.text); assert.equal(u.json.id, raised.id);
    const miss = await x.m.call('update_light', { key: 'nope', note: 'x' });
    assert.ok(miss.error); assert.match(miss.text, /No open light of yours has the key "nope"/);
    const c = await x.m.call('close_light', { key: 'site', outcome: 'done', note: 'Shipped' });
    assert.ok(!c.error, c.text); assert.equal(c.json.state, 'done');
    const again = await x.m.call('close_light', { key: 'site', outcome: 'done' });
    assert.ok(again.error, 'closed lights are not found again');
    const bad = await x.m.call('close_light', { id: raised.id, outcome: 'approved' });
    assert.ok(bad.error); assert.match(bad.text, /done or dropped/);
    const second = (await x.m.call('raise_light', { area: 'Shop', title: 'Old chore', kind: 'todo', key: 'chore', link: 'https://example.com' })).json;
    const dropped = await x.m.call('close_light', { id: second.id, outcome: 'dropped', note: 'No longer needed' });
    assert.equal(dropped.json.state, 'dropped');
  } finally { x.done(); }
});

test('connector: close_light is refused while a decision is out; another session\'s light is not found by key', async () => {
  const x = await board();
  try {
    const l = (await x.m.call('raise_light', { area: 'Shop', title: 'Send it', kind: 'approve', draft: 'Hi', to: 'Dale', outbound: true, key: 'send' })).json;
    const state = JSON.parse(await new Promise((ok) => http.get(`${x.b.url}/api/state`, (r) => { let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => ok(t)); })));
    const light = state.lights.find((y) => y.id === l.id);
    const key = fs.readFileSync(path.join(x.dir, 'page.key'), 'utf8').trim();
    await new Promise((ok) => { const rq = http.request(`${x.b.url}/api/lights/${l.id}/act`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-switchboard-key': key } }, (r) => { r.resume(); r.on('end', ok); }); rq.end(JSON.stringify({ action: 'approve', rev: light.rev })); });
    const c = await x.m.call('close_light', { key: 'send', outcome: 'done' });
    assert.ok(c.error, c.text); assert.match(c.text, /decision/i);
    const other = mcp({ SWITCHBOARD_HOME: x.dir, SWITCHBOARD_PORT: new URL(x.b.url).port, SWITCHBOARD_AGENT: 'someone-else' });
    await other.hello();
    const r = await other.call('update_light', { key: 'send', note: 'mine now' });
    assert.ok(r.error); assert.match(r.text, /No open light of yours/);
    other.close();
  } finally { x.done(); }
});

test('connector: search_history finds what was answered', async () => {
  const x = await board();
  try {
    const l = (await x.m.call('raise_light', { area: 'Shop', title: 'Renew the domain?', kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes' })).json;
    const key = fs.readFileSync(path.join(x.dir, 'page.key'), 'utf8').trim();
    const st = JSON.parse(await new Promise((ok) => http.get(`${x.b.url}/api/state`, (r) => { let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => ok(t)); })));
    await new Promise((ok) => { const rq = http.request(`${x.b.url}/api/lights/${l.id}/act`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-switchboard-key': key } }, (r) => { r.resume(); r.on('end', ok); }); rq.end(JSON.stringify({ action: 'answer', value: 'No', rev: st.lights.find((y) => y.id === l.id).rev })); });
    const h = await x.m.call('search_history', { q: 'domain' });
    assert.ok(!h.error, h.text); assert.equal(h.json.items.length, 1); assert.match(h.json.items[0].what, /No/);
    const none = await x.m.call('search_history', { q: 'zzz' });
    assert.deepEqual(none.json.items, []);
    const all = await x.m.call('search_history', {});
    assert.equal(all.json.items.length, 1, 'an empty search lists the latest');
  } finally { x.done(); }
});

// ---- deep links
test('notifier passes the new light ids to senders', () => {
  const calls = []; const at = (h, m = 0) => new Date(2026, 10, 16, h, m).getTime(); let now = at(10);
  const n = notifier({ send: (t, b, c, ids) => calls.push({ c, ids }), now: () => now });
  const g = (id) => ({ id, title: id, state: 'need_you', area: 's' });
  n.check({ lights: [g('a')], areas: [] });
  now = at(10, 5); n.check({ lights: [g('a'), g('b')], areas: [] });
  assert.deepEqual(calls, [{ c: 1, ids: ['b'] }]);
});
test('the phone text and the banner link to the one new light, and to the board when several came in', () => {
  const seen = [];
  const spawn = (cmd, args) => { seen.push(args[args.length - 1]); return { on() {}, unref() {} }; };
  const t = textSender({ to: '+15551234567', platform: 'darwin', spawn, link: 'https://zc.example/' });
  t('Switchboard', 'x', 1, ['abc123']);
  t('Switchboard', 'x', 2, ['a', 'b']);
  t('Switchboard', 'x', 1);
  assert.match(seen[0], /https:\/\/zc\.example\/#abc123$/);
  assert.match(seen[1], /https:\/\/zc\.example\/$/);
  assert.match(seen[2], /https:\/\/zc\.example\/$/);
  const b = osSender({ platform: 'darwin', spawn, link: 'https://zc.example/' });
  b('Switchboard', '1 new thing needs you', 1, ['abc123']);
  assert.match(seen[3], /https:\/\/zc\.example\/#abc123/);
});
test('the page opens and selects the light named in the address', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /location\.hash/); assert.match(html, /hashchange/); assert.match(html, /scrollIntoView/);
  assert.doesNotMatch(html, /replaceState\(null, '', location\.pathname\)/, 'the key is removed from the address but the #id stays');
});

// ---- home-screen app
test('the board serves its icon and a web app manifest, and the page links them', async () => {
  const b = await start({ port: await freePort(), dir: tmp() });
  try {
    const get = (p) => new Promise((ok) => http.get(b.url + p, (r) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => ok({ status: r.statusCode, type: r.headers['content-type'], body: Buffer.concat(c) })); }));
    const m = await get('/manifest.webmanifest');
    assert.equal(m.status, 200); assert.match(m.type, /manifest\+json/);
    const j = JSON.parse(m.body.toString());
    assert.equal(j.name, 'Switchboard'); assert.equal(j.display, 'standalone'); assert.match(j.theme_color, /^#[0-9a-f]{6}$/i);
    assert.ok(j.icons.some((i) => i.src === '/icon.png'));
    const i = await get('/icon.png');
    assert.equal(i.status, 200); assert.equal(i.type, 'image/png'); assert.equal(i.body.slice(1, 4).toString(), 'PNG');
    const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
    for (const re of [/rel="manifest" href="\/manifest\.webmanifest"/, /rel="apple-touch-icon" href="\/icon\.png"/, /name="apple-mobile-web-app-capable" content="yes"/, /name="theme-color"/]) assert.match(html, re);
  } finally { b.close(); }
});

// ---- review fixes: ownership, answers of other sessions, banner links
test('close by id: another session cannot close a light, its own names can, an unnamed light is open to a named closer', () => {
  const s = open(tmp(), {});
  const l = s.raise({ agent: 'a', area: 'Shop', title: 'Build site', state: 'auto', key: 'own-1' }, T);
  assert.throws(() => s.update(l.id, { state: 'done', closing: true, agent: 'b', agents: ['b'] }, 'b', T + 10), /belongs to a|another session|raised by/i);
  assert.notEqual(s.db.lights.find((x) => x.id === l.id).state, 'done');
  s.update(l.id, { state: 'done', closing: true, agent: 'b', agents: ['b', 'a'] }, 'b', T + 20);
  assert.equal(s.db.lights.find((x) => x.id === l.id).state, 'done', 'a session whose other names include the raiser may close');
  const m = s.raise({ area: 'Shop', title: 'Own note', state: 'auto' }, T); s.db.lights.find((x) => x.id === m.id).own = true;
  assert.throws(() => s.update(m.id, { state: 'done', closing: true, agent: 'b', agents: ['b'] }, 'b', T + 30), /person|own note|no name/i);
});
test('answered before: another session is not shown the answer or the reason', () => {
  const s = open(tmp(), {});
  const l = s.raise({ agent: 'a', area: 'Shop', title: 'Share?', kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes', key: 'shared' }, T);
  s.act(l.id, 'answer', { value: 'Yes', text: 'private reason 123', rev: rev(l) }, T + 1000);
  s.raise({ agent: 'b', area: 'Shop', title: 'Share?', kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes', key: 'shared' }, T + DAY);
  assert.ok(!has(s, /private reason|answered before/), s.warnings.join('|'));
  s.raise({ agent: 'a', area: 'Shop', title: 'Share? again', kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes', key: 'shared' }, T + DAY);
  assert.ok(has(s, /answered before.*private reason 123/), 'the same session still sees it: ' + s.warnings.join('|'));
});
test('banner: one light links without the query string, several link to the board without it, and no link when none is set', () => {
  const calls = []; const spawn = (c, a) => { calls.push(a[a.length - 1]); return { on() {}, unref() {} }; };
  const send = osSender({ platform: 'darwin', spawn, link: 'https://zc.ts.net/?key=abcd#old' });
  send('Switchboard', 'x', 1, ['abc123']); send('Switchboard', 'y', 2, ['abc', 'def']);
  assert.equal(calls[0], 'x https://zc.ts.net/#abc123');
  assert.equal(calls[1], 'y https://zc.ts.net/');
  assert.ok(!calls.join(' ').includes('key='));
  calls.length = 0; osSender({ platform: 'darwin', spawn })('Switchboard', 'z', 2, ['a', 'b']);
  assert.equal(calls[0], 'z');
});
