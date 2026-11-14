#!/usr/bin/env node
'use strict';
// Switchboard server: one small HTTP server, no dependencies.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { open } = require('./lib/store');

async function start(opts = {}) {
  const port = Number(opts.port != null ? opts.port : process.env.SWITCHBOARD_PORT || 4747);
  const host = opts.host || process.env.SWITCHBOARD_HOST || '127.0.0.1';
  const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
  const extra = opts.allowedHosts != null ? [].concat(opts.allowedHosts) : (process.env.SWITCHBOARD_ALLOWED_HOSTS || '').split(',');
  const allowed = new Set([...LOOPBACK, host].concat(extra.map((s) => String(s).trim()).filter(Boolean)));
  // Headers a proxy adds. tailscale serve, a reverse proxy or a tunnel reaches the board from 127.0.0.1, but the person
  // (or anyone else) is on another device.
  const PROXY = ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-real-ip', 'tailscale-user-login', 'tailscale-user-name'];
  const store = open(opts.dir, { holdMs: opts.holdMs, collectMs: opts.collectMs });
  const waiters = new Set();
  // Simulation mode: made-up days you can switch between, with events that happen while you watch.
  const sim = opts.sim ? { list: require('./scenarios').scenarios, current: null, live: opts.live !== false, timers: [] } : null;
  function loadScenario(name) {
    const sc = sim.list[name];
    if (!sc) throw new Error(`No scenario "${name}". Try: ${Object.keys(sim.list).join(', ')}`);
    sim.timers.forEach(clearTimeout); sim.timers = [];
    store.reset(); sc.build(store, Date.now()); sim.current = name; store.save();
    if (sim.live) for (const ev of sc.live || []) {
      const t = setTimeout(() => { try { const find = (start) => store.db.lights.find((l) => l.title.startsWith(start) && l.state !== 'done' && l.state !== 'dropped'); ev.run(store, Date.now(), find); changed(); } catch (e) { console.error('sim event failed:', e.message); } }, ev.at * 1000);
      t.unref(); sim.timers.push(t);
    }
  }
  const page = path.join(__dirname, 'public', 'index.html');
  // How to connect an assistant to this board, for the page's first-run guidance. The terminal line names this board's
  // folder and port when they are not the usual ones (each -e after the server's name and before --).
  const connectInfo = () => {
    if (sim) return null;
    const port = server.address().port, env = [];
    if (path.resolve(store.dir) !== path.resolve(os.homedir(), '.local', 'share', 'switchboard')) env.push(`-e SWITCHBOARD_HOME="${store.dir}"`);
    if (port !== 4747) env.push(`-e SWITCHBOARD_PORT=${port}`);
    // A plugin's or a Desktop extension's folder is replaced on every update: a connector pointed at it would break later.
    const managed = /[\\/]\.claude[\\/]plugins[\\/]|[\\/]Claude Extensions[\\/]/.test(__dirname + path.sep);
    return { folder: __dirname, plugin: ['/plugin marketplace add ZCOLLINSKY/switchboard', '/plugin install switchboard@zcollinsky'],
      mcp: managed ? null : ['claude mcp add --scope user switchboard'].concat(env, ['--', `node "${path.join(__dirname, 'mcp.js')}"`]).join(' '),
      desktop: 'https://github.com/ZCOLLINSKY/switchboard/releases/latest' };
  };
  const clients = new Set();

  const changed = () => { store.save(); for (const res of clients) res.write('event: change\ndata: 1\n\n'); for (const w of waiters) w(); };
  // In a simulation, a stand-in assistant collects each decision and reports it sent a few seconds later.
  if (sim) {
    const sending = new Map(); // decision_id -> { id, at }
    const t = setInterval(() => { try {
      const now = Date.now(), got = store.decisions(now, { all: true });
      for (const d of got.decisions) sending.set(d.decision_id, { id: d.id, at: now + 4000, redo: d.action === 'redo' ? d.text : null });
      let n = got.decisions.length + got.sent_by_you.length;
      for (const [did, job] of sending) if (now >= job.at) { sending.delete(did); n++; try {
        if (job.redo != null) {
          // The stand-in cannot write. It hands the light back unchanged and says so, rather than pretending to have used the note.
          store.complete(job.id, 'done', '', now, did);
          store.update(job.id, { state: 'need_you', changed: 'Nothing yet: in the simulation a stand-in plays your assistant and cannot rewrite. A real assistant changes the draft here and says what it changed.', reason: 'handed back by the stand-in' }, 'sim-assistant', now);
        }
        else store.complete(job.id, 'sent', '', now, did);
      } catch (e) { /* replaced or taken back meanwhile */ } }
      if (n) changed();
    } catch (e) { console.error('sim assistant:', e.message); } }, 2000);
    t.unref(); sim.assistant = t;
  }
  // The board must never be shown inside another site's frame, where a click could be tricked.
  // What a caller gets back about a light: never the decision itself (that is collected only through get_decisions), never the undo record.
  const pub = (l) => { const o = Object.assign({}, l, { decided: !!l.decision }); delete o.decision; delete o.undo; delete o.past; delete o.history; delete o.board; return o; };
  const SAFE = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
  const json = (res, code, body) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, SAFE)); res.end(JSON.stringify(body)); };
  // One writer per data folder. A second server would silently overwrite the first one's saves.
  const lockFile = path.join(store.dir, 'server.lock');
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  const lockId = require('crypto').randomBytes(6).toString('hex');
  const locked = (held) => Object.assign(new Error(`Switchboard is already running on this data${held.url ? ' at ' + held.url : ''} (process ${held.pid}). Use that one, or stop it first. If nothing answers there, it is safe to delete ${lockFile}.`), { code: 'ELOCKED', url: held.url });
  // A lock is believed only if its owner answers: a process number alone can belong to anything after a crash or a restart.
  const answers = async (held) => {
    if (!held.url) return alive(held.pid) && Date.now() - (held.at || 0) < 15000; // still starting up
    try { const r = await fetch(held.url + '/api/health', { signal: AbortSignal.timeout(1500) }); const h = await r.json(); return h.lock === held.id; } catch (e) { return false; }
  };
  let held = null;
  try { held = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  if (held && held.host === os.hostname() && alive(held.pid) && await answers(held)) throw locked(held);
  // Take it in one step, so two starts at the same moment cannot both get through.
  fs.mkdirSync(store.dir, { recursive: true, mode: 0o700 });
  if (held || fs.existsSync(lockFile)) { try { fs.unlinkSync(lockFile); } catch (e) { /* someone else cleared it */ } }
  try { fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, id: lockId, url: '', live: true, host: os.hostname(), at: Date.now() }), { mode: 0o600, flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') throw locked({ pid: 'another', url: '' }); throw e; }
  const unlock = () => { try { const h = JSON.parse(fs.readFileSync(lockFile, 'utf8')); if (h.pid === process.pid && h.id === lockId) fs.unlinkSync(lockFile); } catch (e) { /* already gone */ } };
  // The page key: only a browser that was opened through the printed link can approve, undo or promote.
  // It guards against mistakes (a confused assistant with a shell), not against something that reads your files.
  const keyFile = path.join(store.dir, 'page.key');
  let pageKey;
  try { pageKey = fs.readFileSync(keyFile, 'utf8').trim(); } catch (e) { pageKey = ''; }
  if (!/^[a-f0-9]{32}$/.test(pageKey)) { pageKey = require('crypto').randomBytes(16).toString('hex'); fs.mkdirSync(store.dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(keyFile, pageKey + '\n', { mode: 0o600 }); }
  const fromPage = (req) => req.headers['x-switchboard-key'] === pageKey;
  const PAGE_ONLY = /^\/api\/(?:lights\/[a-f0-9]+\/act|bulk|promote|demote|settings|learn|unlearn|reoffer|areas\/rename|areas\/remove|sim|dump)$/;
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('Body must be JSON')); } });
    req.on('error', reject);
  });

  // Unfinished requests are dropped after seconds, checked every second (Node checks every 30 s by default).
  const server = http.createServer({ requestTimeout: 10000, headersTimeout: 5000, connectionsCheckingInterval: 1000 }, async (req, res) => {
    let mutating = false;
    try {
      // Only answer for hosts we were started for (blocks DNS-rebinding from other sites).
      const hostName = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!allowed.has(hostName)) return json(res, 403, { error: 'Host not allowed. Set SWITCHBOARD_ALLOWED_HOSTS to add one.' });
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      // Local means this computer, asked directly: from a loopback address, by a loopback name, through no proxy.
      const local = /^(?:127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '') && LOOPBACK.has(hostName) && !PROXY.some((k) => req.headers[k] != null);
      // From another device (a phone on a private network, anything through tailscale serve), every /api call needs the
      // page key, reading included. A browser's live feed cannot send headers, so it may carry the key in its address.
      const keyed = fromPage(req) || (p === '/api/events' && url.searchParams.get('key') === pageKey);
      if (!local && p.startsWith('/api/') && p !== '/api/health' && !keyed) return json(res, 403, { error: 'Open Switchboard through its key link on this device first.' });
      // Any call from the assistant connector on this computer (opening the board, asking for decisions) means one is in
      // use, so the page stops offering to connect one. A website cannot send this header without the board's permission.
      if (local && req.headers['x-switchboard-client'] === 'mcp' && !store.db.seen.mcp) { store.connectorSeen(); changed(); }

      if (req.method === 'GET' && p === '/' && url.searchParams.get('key')) {
        if (url.searchParams.get('key') !== pageKey) return json(res, 403, { error: `That link is out of date. Ask your assistant to open Switchboard for you, or get the current link in a terminal with: node "${path.join(__dirname, 'cli.js')}" link` });
        // The page itself keeps the key (per address, port included) and takes it out of the address bar. No cookie: a cookie
        // on 127.0.0.1 is shared with every other local server, and with a simulation on another port.
        res.writeHead(200, Object.assign({ 'content-type': 'text/html; charset=utf-8' }, SAFE));
        return fs.createReadStream(page).on('error', () => res.end('The page file is missing. Reinstall Switchboard.')).pipe(res);
      }
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        res.writeHead(200, Object.assign({ 'content-type': 'text/html; charset=utf-8' }, SAFE));
        return fs.createReadStream(page).on('error', () => res.end('The page file is missing. Reinstall Switchboard.')).pipe(res);
      }
      if (req.method === 'GET' && p === '/api/state') return json(res, 200, Object.assign(store.view(), { canAct: fromPage(req), connect: connectInfo() }, sim ? { sim: { current: sim.current, live: sim.live, scenarios: Object.keys(sim.list).map((k) => ({ name: k, title: sim.list[k].title, blurb: sim.list[k].blurb, live: !!(sim.list[k].live && sim.live) })) } } : {}));
      if (req.method === 'GET' && (p === '/api/decisions' || p === '/api/wait')) return json(res, 405, { error: 'Collecting decisions is a write. Send a JSON POST.' });
      // Counts only, collecting nothing: a relay looks here before it starts any work.
      if (req.method === 'GET' && p === '/api/pending') return json(res, 200, store.pending(Date.now(), { agent: url.searchParams.get('agent') || '', only: url.searchParams.get('only') === '1' }));
      if (req.method === 'GET' && p === '/api/fit') return json(res, 200, store.fit(url.searchParams.get('minutes')));
      if (req.method === 'GET' && p === '/api/history') return json(res, 200, { items: store.history(url.searchParams.get('q') || '') });
      if (req.method === 'GET' && p === '/api/health') return json(res, 200, Object.assign({ ok: true, name: 'switchboard', lock: lockId }, local ? { data: store.file } : {}));
      if (req.method === 'GET' && p === '/api/events') {
        res.writeHead(200, Object.assign({ 'content-type': 'text/event-stream', connection: 'keep-alive' }, SAFE));
        res.write('retry: 3000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
      // Writes must be JSON, which other websites cannot send here without permission.
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Send JSON with content-type: application/json' });
      if (PAGE_ONLY.test(p) && !fromPage(req)) return json(res, 403, { error: 'This browser can only look. To approve here, open your Switchboard link.' });
      const body = await readBody(req);
      mutating = true;
      // Who did it is decided here, never taken from the caller: only the person's own page can speak as the person.
      const person = fromPage(req);
      if (!person || p === '/api/lights') delete body.by;
      // Examples are made by the board, never by a caller: a real light or container marked as an example would be deleted with them.
      if (!person) delete body.demo;
      // Collecting changes the board (the person can no longer take the decision back), so it is a JSON POST like every
      // other write. A plain GET, which any website could make the browser send, collects nothing.
      // An assistant asking is a check-in: from then on an approval it leaves turns red after 15 minutes. The board keeps
      // it, and tells the page, at most every few minutes.
      const was = store.db.seen.checkIn, firstIn = () => was == null || Date.now() - was > 5 * 60e3;
      if (p === '/api/decisions') {
        const got = store.decisions(Date.now(), { agent: String(body.agent || ''), agents: body.agents, all: body.all === true, only: body.only === true });
        if (got.decisions.length || got.sent_by_you.length || firstIn()) changed();
        return json(res, 200, got);
      }
      if (p === '/api/wait') {
        // An assistant that is mid-task can wait here for one light's answer instead of polling.
        const id = String(body.id || ''), who = { agent: String(body.agent || ''), agents: body.agents };
        // Someone else's light would never be handed over: say so now, instead of waiting out the seconds for nothing.
        const why = store.notYours(id, who); if (why) return json(res, 200, { decided: false, reason: why });
        const until = Date.now() + Math.min(Math.max(Number(body.seconds) || 30, 1), 50) * 1000;
        let over = false, busy = false;
        const check = () => { if (busy) return null; busy = true; try { const d = store.decisionFor(id, Date.now(), who); if (d) { over = true; changed(); } return d; } finally { busy = false; } };
        const first = check();
        if (!first && firstIn()) changed();
        if (first) return json(res, 200, { decided: true, decision: first });
        return await new Promise((done) => {
          const finish = (out) => { clearInterval(poll); waiters.delete(wake); done(json(res, 200, out)); };
          const wake = () => { if (over) return; try { const got = check(); if (got) finish({ decided: true, decision: got }); else if (Date.now() >= until) { over = true; finish({ decided: false }); } } catch (e) { over = true; finish({ decided: false, error: e.message }); } };
          const poll = setInterval(wake, 250); waiters.add(wake);
          // The caller hung up (a cancelled wait, a closed session): stop, so an abandoned wait never collects.
          res.on('close', () => { if (!res.writableEnded) { over = true; clearInterval(poll); waiters.delete(wake); done(); } });
        });
      }
      let out;
      let m;
      if (p === '/api/lights') out = store.raise(body);
      else if (p === '/api/complete') {
        if (typeof body.decision_id !== 'string' || !body.decision_id) return json(res, 400, { error: 'Send the decision_id you were handed, so the report lands on the right decision.' });
        out = store.complete(body.id, body.outcome, body.detail, Date.now(), body.decision_id);
      }
      else if ((m = p.match(/^\/api\/lights\/([a-f0-9]+)\/act$/))) {
        if (body.action === 'approve' && typeof body.rev !== 'string') return json(res, 400, { error: 'Send the rev of the light as it was shown.' });
        out = store.act(m[1], body.action, body);
      }
      else if ((m = p.match(/^\/api\/lights\/([a-f0-9]+)$/))) out = store.update(m[1], body, person ? 'you' : String(body.agent || 'agent').slice(0, 40));
      else if (p === '/api/areas') out = store.addArea(body);
      else if (p === '/api/dump') out = { lights: store.dump(body.text) };
      else if (p === '/api/bulk') {
        if (body.action === 'approve' && (!body.revs || (body.ids || []).some((id) => typeof body.revs[id] !== 'string'))) return json(res, 400, { error: 'Send the rev of every light as it was shown.' });
        out = { lights: store.bulk(body.ids, body.action, body) };
      }
      else if (p === '/api/ack') { out = { acknowledged: store.ack(Array.isArray(body.ids) ? body.ids : [], Date.now(), { agent: String(body.agent || ''), agents: body.agents }) }; if (store.warnings.length) out.warnings = store.warnings.slice(); }
      else if (p === '/api/promote') out = store.promote(body.key, body.yes !== false);
      else if (p === '/api/demote') { store.demote(String(body.key || '')); out = { ok: true }; }
      else if (p === '/api/settings') out = store.setting('autonomy', body.autonomy);
      else if (p === '/api/learn') out = store.learn(body.area, body.why, body.yes !== false);
      else if (p === '/api/unlearn') out = store.unlearn(body.area, body.why);
      else if (p === '/api/reoffer') out = store.reoffer(body.key);
      else if (p === '/api/areas/rename') out = store.renameArea(String(body.id || ''), body.name);
      else if (p === '/api/areas/remove') out = store.removeArea(String(body.id || ''));
      else if (p === '/api/sim' && sim) { loadScenario(body.name); out = { ok: true, scenario: sim.current }; }
      else if (p === '/api/demo') {
        // Clearing the examples is safe for anyone (it only removes examples). Loading them is the person's own choice.
        if (!body.clear && !person) return json(res, 403, { error: 'Only the person\'s own page can load the examples.' });
        if (body.clear) store.clearDemo(); else store.seedDemo(); out = { ok: true };
      }
      else return json(res, 404, { error: 'Not found' });
      changed();
      if (out && out.id && out.history) out = pub(out); else if (out && Array.isArray(out.lights)) out = Object.assign({}, out, { lights: out.lights.map(pub) });
      // Anything the store ignored or found odd goes back to the caller instead of vanishing.
      if (store.warnings.length && (p === '/api/lights' || p === '/api/areas' || p === '/api/complete' || p === '/api/ack' || /^\/api\/lights\/[a-f0-9]+$/.test(p))) out = Object.assign({}, out, { warnings: store.warnings.slice() });
      return json(res, 200, out);
    } catch (e) {
      // A refused call changes nothing: whatever it did on its way to failing is put back.
      if (mutating) { try { store.rollback(); } catch (e2) { console.error('rollback failed:', e2.message); } }
      return json(res, 400, { error: e.message });
    }
  });

  const timer = setInterval(() => { try { if (store.tick()) changed(); } catch (e) { console.error('tick failed:', e.message); } }, 30000);
  timer.unref();
  if (sim) loadScenario(opts.scenario || 'morning');
  else if (store.tick()) store.save();

  return new Promise((resolve, reject) => {
    server.once('error', (e) => { unlock(); reject(e); });
    server.listen(port, host, () => {
      const url = `http://${host === '0.0.0.0' || host === 'localhost' ? '127.0.0.1' : host === '::' ? '[::1]' : host.includes(':') ? '[' + host + ']' : host}:${server.address().port}`;
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, id: lockId, url, live: true, host: os.hostname(), at: Date.now() }), { mode: 0o600 });
      process.once('exit', unlock);
      // Ctrl+C, kill and logout do not fire 'exit' by themselves: leave cleanly so the lock goes with us.
      if (require.main === module || opts.signals) for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { unlock(); process.exit(0); });
      resolve({ server, store, url, key: pageKey, link: `${url}/?key=${pageKey}`, close: () => { unlock(); clearInterval(timer); if (sim) { sim.timers.forEach(clearTimeout); clearInterval(sim.assistant); } for (const c of clients) c.end(); server.close(); } });
    });
  });
}

module.exports = { start };

if (require.main === module) {
  // The key link only to a terminal: a login item's log file is no place for it.
  start().then((s) => console.log(process.stdout.isTTY ? `Switchboard is on. Open it with this link once per browser: ${s.link}\n(data: ${s.store.file})` : `Switchboard is on at ${s.url}. Open it ready to approve with: node "${path.join(__dirname, 'cli.js')}" link --open\n(data: ${s.store.file})`))
    .catch((e) => { console.error(e.code === 'EADDRINUSE' ? 'Switchboard is already running on that port.' : e.message); process.exit(1); });
}
