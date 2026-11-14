'use strict';
// Who gets which decision: the name a session has on the board comes from its repository (every worktree and subfolder
// of one repository is one name), or from the project it names. Sessions started in one plain folder that name
// different projects are never handed each other's decisions.
const { childEnv } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');
const { start } = require('../server');
const root = path.join(__dirname, '..');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sbrt-')));
const fp = (p) => require('crypto').createHash('sha1').update(p).digest('hex').slice(0, 4);

// The connector, started in `cwd`, spoken to over stdio as a client would.
function mcp(env, cwd) {
  const c = spawn(process.execPath, [path.join(root, 'mcp.js')], { cwd, env: childEnv(env), stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '', id = 0; const waiting = new Map();
  c.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); const m = JSON.parse(line); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const req = (method, params) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const call = async (name, args) => { const r = (await req('tools/call', { name, arguments: args || {} })).result; if (r.isError) throw new Error(r.content[0].text); return JSON.parse(r.content[0].text); };
  return { req, call, hello: () => req('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 't' } }), close: () => c.kill() };
}
// What the person does on the page: approve or answer, with the page key.
async function tap(a, id, action, extra) {
  const l = (await (await fetch(a.url + '/api/state')).json()).lights.find((x) => x.id === id);
  const r = await fetch(`${a.url}/api/lights/${id}/act`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-switchboard-key': a.key }, body: JSON.stringify(Object.assign({ action, rev: l.rev }, extra)) });
  assert.equal(r.status, 200, await r.text());
}
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com'].concat(args), { cwd, env: childEnv(), stdio: 'pipe' });
let hasGit = true; try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { hasGit = false; }

test('two sessions started in one folder that name different projects are never handed each other\'s decisions', async () => {
  const dir = tmp(), home = tmp(), a = await start({ port: 0, dir, holdMs: 0 });
  const env = { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port };
  const alpha = mcp(env, home), beta = mcp(env, home), plain = mcp(env, home);
  try {
    await Promise.all([alpha.hello(), beta.hello(), plain.hello()]);
    const la = await alpha.call('raise_light', { project: 'alpha', area: 'Shop', title: 'Alpha: which size?', kind: 'decide', options: ['Small', 'Large'] });
    const lb = await beta.call('raise_light', { project: 'beta', area: 'Shop', title: 'Beta: which size?', kind: 'decide', options: ['Small', 'Large'] });
    assert.ok(!la.warnings, JSON.stringify(la.warnings)); // project is not passed on to the board as a field
    assert.equal(la.agent, 't:alpha'); assert.equal(lb.agent, 't:beta');
    await tap(a, la.id, 'answer', { value: 'Small' }); await tap(a, lb.id, 'answer', { value: 'Large' });
    assert.deepEqual((await plain.call('get_decisions')).decisions, [], 'a session that named no project gets neither');
    // The project was given once; later calls without it still go to alpha, so one forgotten argument does not misroute.
    const ga = await alpha.call('get_decisions');
    assert.deepEqual(ga.decisions.map((d) => d.id), [la.id]);
    const gb = await beta.call('get_decisions', { project: 'beta' });
    assert.deepEqual(gb.decisions.map((d) => d.id), [lb.id]);
    assert.equal(ga.decisions[0].value, 'Small'); assert.equal(gb.decisions[0].value, 'Large');
  } finally { alpha.close(); beta.close(); plain.close(); a.close(); }
});

test('wait_for_decision and update_light speak with the project name too', async () => {
  const dir = tmp(), home = tmp(), a = await start({ port: 0, dir, holdMs: 0 });
  const s = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port }, home);
  try {
    await s.hello();
    const l = await s.call('raise_light', { project: 'gamma', area: 'Shop', title: 'Gamma: ship it?', kind: 'decide', options: ['Yes', 'No'] });
    await s.call('update_light', { id: l.id, note: 'checked twice' });
    await tap(a, l.id, 'answer', { value: 'Yes' });
    const w = await s.call('wait_for_decision', { id: l.id, seconds: 2 });
    assert.equal(w.decided, true); assert.equal(w.decision.value, 'Yes');
    assert.equal(a.store.db.lights[0].decision.collectedBy, 't:gamma');
    const r = await s.call('complete_decision', { id: l.id, decision_id: w.decision.decision_id, outcome: 'done', project: 'gamma' });
    assert.equal(r.state, 'done');
  } finally { s.close(); a.close(); }
});

test('a session that names the project of the folder it was started in keeps the folder\'s name', async () => {
  const dir = tmp(), work = path.join(tmp(), 'my-shop'), a = await start({ port: 0, dir });
  fs.mkdirSync(work);
  const s = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port }, work);
  try {
    await s.hello();
    const l = await s.call('raise_light', { project: 'My-Shop', area: 'Shop', title: 'Order boxes', kind: 'todo' });
    assert.equal(l.agent, `t:my-shop~${fp(work)}`);
  } finally { s.close(); a.close(); }
});

test('every worktree and subfolder of one repository is one name', { skip: !hasGit && 'git is not installed' }, async () => {
  const dir = tmp(), base = tmp(), repo = path.join(base, 'around-town'), wt = path.join(base, 'wt-feature'), sub = path.join(repo, 'src');
  fs.mkdirSync(sub, { recursive: true });
  git(repo, 'init', '-q'); git(repo, 'commit', '-q', '--allow-empty', '-m', 'first'); git(repo, 'worktree', 'add', '-q', wt);
  const a = await start({ port: 0, dir }), env = { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port };
  const names = [];
  for (const cwd of [repo, wt, sub]) {
    const s = mcp(env, cwd);
    try { await s.hello(); names.push((await s.call('raise_light', { area: 'Code', title: 'From ' + path.basename(cwd), kind: 'todo' })).agent); } finally { s.close(); }
  }
  try {
    assert.deepEqual(names, Array(3).fill(`t:around-town~${fp(repo)}`), 'the same as before for the main folder, and shared by its worktree and subfolder');
  } finally { a.close(); }
});

test('the session-start hook counts for the repository\'s name from a worktree', { skip: !hasGit && 'git is not installed' }, async () => {
  const dir = tmp(), base = tmp(), repo = path.join(base, 'shop'), wt = path.join(base, 'shop-wt');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q'); git(repo, 'commit', '-q', '--allow-empty', '-m', 'first'); git(repo, 'worktree', 'add', '-q', wt);
  const a = await start({ port: 0, dir, holdMs: 0 });
  try {
    const l = a.store.raise({ area: 'Shop', title: 'Which size?', kind: 'decide', options: ['Small', 'Large'], agent: `claude-code:shop~${fp(repo)}` });
    a.store.act(l.id, 'answer', { value: 'Large', rev: require('../lib/store').rev(l) });
    const out = await new Promise((ok) => {
      const c = spawn(process.execPath, [path.join(root, 'hooks', 'session-start.js')], { env: childEnv({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port }), stdio: ['pipe', 'pipe', 'inherit'] });
      let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => ok(o)); c.stdin.end(JSON.stringify({ cwd: wt }));
    });
    assert.match(out, /1 decision is ready for this session/);
  } finally { a.close(); }
});

test('waiting on a light another session raised returns at once and says whose it is', async () => {
  const dir = tmp(), home = tmp(), a = await start({ port: 0, dir, holdMs: 0 });
  const env = { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port };
  const alpha = mcp(env, home), beta = mcp(env, home);
  try {
    await Promise.all([alpha.hello(), beta.hello()]);
    const l = await alpha.call('raise_light', { project: 'alpha', area: 'Shop', title: 'Alpha: which size?', kind: 'decide', options: ['Small', 'Large'] });
    await tap(a, l.id, 'answer', { value: 'Small' });
    const t0 = Date.now(), w = await beta.call('wait_for_decision', { id: l.id, seconds: 20, project: 'beta' });
    assert.deepEqual(w, { decided: false, reason: 'raised by another session, or under a project this call does not name; only a session with that light\'s name can collect it' });
    assert.ok(Date.now() - t0 < 5000, 'it did not wait');
    const r = await fetch(a.url + '/api/wait', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: l.id, seconds: 20, agent: 'someone' }) });
    assert.deepEqual(await r.json(), { decided: false, reason: 'raised by another session, or under a project this call does not name; only a session with that light\'s name can collect it' });
    assert.equal(a.store.db.lights[0].decision.collectedAt, null, 'nothing was collected');
    assert.equal((await alpha.call('wait_for_decision', { id: l.id, seconds: 2 })).decided, true);
  } finally { alpha.close(); beta.close(); a.close(); }
});

test('a named project can never take a repository session\'s name, or another client\'s', { skip: !hasGit && 'git is not installed' }, async () => {
  const { projectName, agentName } = require('../lib/names');
  assert.equal(projectName('repoA~bb37'), 'repoA-bb37');
  assert.equal(projectName('claude-desktop:alpha'), 'claude-desktop-alpha');
  const dir = tmp(), base = tmp(), repo = path.join(base, 'repoA'), plain = path.join(base, 'plain');
  fs.mkdirSync(repo); fs.mkdirSync(plain);
  git(repo, 'init', '-q'); git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
  const a = await start({ port: 0, dir, holdMs: 0 }), env = { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port };
  const owner = mcp(env, repo), other = mcp(env, plain);
  try {
    await Promise.all([owner.hello(), other.hello()]);
    const l = await owner.call('raise_light', { area: 'Code', title: 'Ship it?', kind: 'decide', options: ['Yes', 'No'] });
    assert.equal(l.agent, `t:repoA~${fp(repo)}`);
    await tap(a, l.id, 'answer', { value: 'Yes' });
    const w = await other.call('wait_for_decision', { id: l.id, seconds: 1 });
    assert.equal(w.decided, false);
    assert.ok(!w.reason.includes(l.agent), 'the reason does not hand over the name to use: ' + w.reason);
    const borrowed = await other.call('wait_for_decision', { id: l.id, seconds: 1, project: `repoA~${fp(repo)}` });
    assert.equal(borrowed.decided, false, 'a project spelled like the repository\'s name is another name');
    assert.deepEqual((await other.call('get_decisions', { project: `repoA~${fp(repo)}` })).decisions, []);
    assert.equal(a.store.db.lights[0].decision.collectedAt, null, 'nothing was collected');
    assert.notEqual(agentName({ client: 't', folder: { base: 'plain', fp: '0000' }, project: projectName(`repoA~${fp(repo)}`) }), l.agent);
    const got = await owner.call('get_decisions');
    assert.deepEqual(got.decisions.map((d) => d.id), [l.id]);
    assert.equal(a.store.db.lights[0].decision.collectedBy, l.agent, 'the board names the session that really collected it');
  } finally { owner.close(); other.close(); a.close(); }
});

test('a session that names a project part-way through still collects what it raised before, and nobody else\'s', async () => {
  const dir = tmp(), home = tmp(), a = await start({ port: 0, dir, holdMs: 0 });
  const env = { SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port };
  const s = mcp(env, home), named = mcp(env, home);
  try {
    await Promise.all([s.hello(), named.hello()]);
    const x = await s.call('raise_light', { area: 'Shop', title: 'Order the flyers?', kind: 'decide', options: ['Yes', 'No'] });
    const y = await s.call('raise_light', { project: 'around-lex', area: 'Code', title: 'Ship release 132?', kind: 'decide', options: ['Yes', 'No'] });
    assert.notEqual(x.agent, y.agent);
    const z = await named.call('raise_light', { project: 'beta', area: 'Code', title: 'Beta thing?', kind: 'decide', options: ['Yes', 'No'] });
    for (const l of [x, y, z]) await tap(a, l.id, 'answer', { value: 'Yes' });
    const w = await s.call('wait_for_decision', { id: x.id, seconds: 2 });
    assert.equal(w.decided, true, JSON.stringify(w));
    const got = await s.call('get_decisions');
    assert.deepEqual(got.decisions.map((d) => d.id), [y.id], 'its own light under the project, and never beta\'s');
    const byId = (id) => a.store.db.lights.find((l) => l.id === id);
    assert.equal(byId(x.id).decision.collectedBy, x.agent); assert.equal(byId(y.id).decision.collectedBy, y.agent);
    const ack = await s.call('ack_decisions', { ids: [x.id, y.id] });
    assert.ok(!ack.warnings, JSON.stringify(ack.warnings)); assert.equal(ack.acknowledged, 2);
    // An empty project goes back to the folder's own name.
    const back = await s.call('raise_light', { project: '', area: 'Shop', title: 'Order boxes', kind: 'todo' });
    assert.equal(back.agent, x.agent);
  } finally { s.close(); named.close(); a.close(); }
});

test('with a fixed name (Claude Desktop: one connector for every chat), a project applies only to the call that names it', async () => {
  const dir = tmp(), home = tmp(), a = await start({ port: 0, dir, holdMs: 0 });
  const desk = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port, SWITCHBOARD_AGENT: 'claude-desktop' }, home);
  try {
    await desk.hello();
    const one = await desk.call('raise_light', { area: 'Home', title: 'Chat 1: paint colour?', kind: 'decide', options: ['Blue', 'Green'] });
    const two = await desk.call('raise_light', { project: 'alpha', area: 'Code', title: 'Chat 2: ship alpha?', kind: 'decide', options: ['Yes', 'No'] });
    assert.equal(one.agent, 'claude-desktop'); assert.equal(two.agent, 'claude-desktop:alpha');
    const three = await desk.call('raise_light', { area: 'Home', title: 'Chat 3: book the plumber?', kind: 'decide', options: ['Yes', 'No'] });
    assert.equal(three.agent, 'claude-desktop', 'a later chat that names no project is not filed under alpha');
    await tap(a, one.id, 'answer', { value: 'Blue' }); await tap(a, two.id, 'answer', { value: 'Yes' });
    assert.deepEqual((await desk.call('get_decisions')).decisions.map((d) => d.id), [one.id], 'a plain claude-desktop decision still comes to a call with no project');
    assert.deepEqual((await desk.call('get_decisions', { project: 'alpha' })).decisions.map((d) => d.id), [two.id]);
  } finally { desk.close(); a.close(); }
});

test('a session working on a collected approval keeps its claim with progress, under any name it used', async () => {
  const dir = tmp(), home = tmp(), a = await start({ port: 0, dir, holdMs: 0 });
  const s = mcp({ SWITCHBOARD_HOME: dir, SWITCHBOARD_PORT: new URL(a.url).port }, home);
  try {
    await s.hello();
    const l = await s.call('raise_light', { area: 'Shop', title: 'Send the quote', draft: 'Hi Dale', to: 'Dale', kind: 'approve' });
    await tap(a, l.id, 'approve');
    for (let i = 0; i < 40 && a.store.db.lights[0].state !== 'approved'; i++) await new Promise((ok) => setTimeout(ok, 50));
    const got = await s.call('get_decisions');
    assert.deepEqual(got.decisions.map((d) => d.id), [l.id]);
    const before = a.store.db.lights[0].decision.claimUntil;
    await new Promise((ok) => setTimeout(ok, 20));
    const u = await s.call('update_light', { id: l.id, progress: 50, project: 'around-lex' });
    assert.ok(!u.warnings, JSON.stringify(u.warnings));
    assert.ok(a.store.db.lights[0].decision.claimUntil > before, 'the claim was kept, though the session now names a project');
  } finally { s.close(); a.close(); }
});
