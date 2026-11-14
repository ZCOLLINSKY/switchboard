#!/usr/bin/env node
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const SELF = `node "${path.join(root, 'bin', 'switchboard.js')}"`; // what to type, wherever Switchboard was put
const expand = (p) => p.replace(/^~(?=$|[\\/])/, os.homedir());
const HOME = expand(process.env.SWITCHBOARD_HOME || path.join(os.homedir(), '.local', 'share', 'switchboard'));

const HELP = `Switchboard

  start [--port 4747] [--host 127.0.0.1] [--open]   run the board
  stop [--port N]                                     stop the board that is running
  link [--sim] [--port N]                             print the link that lets a browser act on the board
  sim [scenario] [--port 4750] [--open] [--no-live]   a made-up busy day (morning, slammed, comeback, trusted, clear, first-day)
  demo [--clear] [--port N]                           load or remove the example lights
  raise --area "Name" --title "What you need" [--kind approve|decide|sense|todo|fix]
        [--draft "..."] [--options "Yes,No"] [--state need_you|waiting_them|auto|queued|broken] [--due 2026-12-01] [--port N]
  list [--port N]                                     what needs you, from the command line
  mcp                                                 the assistant connector (MCP over stdio)

Flags take a value after a space or an equals sign: --port 5000 or --port=5000.`;

// Which flags each command takes. true = takes a value, false = a switch.
const FLAGS = {
  start: { port: true, host: true, open: false }, stop: { port: true }, link: { port: true, sim: false },
  sim: { port: true, host: true, open: false, 'no-live': false }, demo: { port: true, clear: false }, list: { port: true }, mcp: {},
  raise: { port: true, area: true, title: true, kind: true, draft: true, options: true, state: true, due: true, to: true, note: true, link: true, source: true, agent: true, key: true, value: true, 'follow-up-days': true, outbound: false },
};
const fail = (msg) => { console.error(msg); process.exit(1); };
const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); process.exit(0); }
if (!FLAGS[cmd]) fail(`Unknown command "${cmd}".\n\n${HELP}`);
const flags = {}, words = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
  if (/^-[^-]/.test(a)) fail(`"${a}": flags start with two dashes, like --${a.replace(/^-+/, '')}.`);
  if (!a.startsWith('--')) { words.push(a); continue; }
  const eq = a.indexOf('='), name = a.slice(2, eq > 0 ? eq : undefined);
  if (!(name in FLAGS[cmd])) fail(`"${cmd}" does not take --${name}.\n\n${HELP}`);
  if (!FLAGS[cmd][name]) { flags[name] = true; continue; }
  // A flag that takes a value takes the next word whatever it looks like, so a draft may start with dashes.
  const v = eq > 0 ? a.slice(eq + 1) : rest[++i];
  if (v === undefined) fail(`--${name} needs a value.`);
  flags[name] = v;
}
if (words.length && cmd !== 'sim') fail(`"${words.join(' ')}" is not a flag. Put text in quotes after a flag, like --title "Order more boxes".`);
if (words.length > 1) fail(`Give one scenario name, not "${words.join(' ')}".`);

const port = flags.port || process.env.SWITCHBOARD_PORT || 4747;
const BASE = (process.env.SWITCHBOARD_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
const notRunning = () => fail(`Switchboard is not running at ${BASE}. Start it with: ${SELF} start${flags.port ? ' --port ' + flags.port : ''}`);
// Find the running board and its data folder: ask it, then fall back to the lock file it leaves beside its data.
async function board(home) {
  // A port or address the person named is the only place to look. Without one, the lock file may point to another port.
  // A data folder that was named (SWITCHBOARD_HOME, or a simulation's) must be the one the board serves: never another board's.
  const named = !!(flags.port || process.env.SWITCHBOARD_URL || process.env.SWITCHBOARD_PORT), mustServe = process.env.SWITCHBOARD_HOME || home !== HOME ? path.resolve(home) : null;
  // A --port typed now wins; otherwise a named data folder's own lock file says where its board is.
  const places = flags.port ? [BASE] : mustServe ? [lockUrl(home), BASE] : named ? [BASE] : [BASE, lockUrl(home)];
  for (const url of places.filter(Boolean)) {
    try {
      const h = await (await fetch(url + '/api/health', { signal: AbortSignal.timeout(2000) })).json();
      if (h && h.name === 'switchboard' && (!mustServe || path.resolve(path.dirname(h.data)) === mustServe)) return { url, dir: path.dirname(h.data) };
    } catch (e) { /* nothing there */ }
  }
  return null;
}
function lockUrl(home) { try { return JSON.parse(fs.readFileSync(path.join(home, 'server.lock'), 'utf8')).url || null; } catch (e) { return null; } }
const keyIn = (dir) => { try { return fs.readFileSync(path.join(dir, 'page.key'), 'utf8').trim(); } catch (e) { return ''; } };
const api = async (url, method, route, body) => {
  const res = await fetch(url + route, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json(); if (!res.ok) throw new Error(data.error); return data;
};
function openLink(link) {
  const c = spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '""', link] : [link], { stdio: 'ignore', detached: true });
  c.on('error', () => console.log('Could not open a browser from here. Open the link above yourself.'));
  c.unref();
}
async function startBoard(opts, label) {
  try { return await require('../server').start(opts); }
  catch (e) {
    if (e.code === 'ELOCKED') { const b = await board(opts.dir || HOME); const k = b && keyIn(b.dir); fail(`Switchboard is already running${b ? ' at ' + b.url : ''}.${k ? `\nOpen it with: ${b.url}/?key=${k}` : ''}\nTo stop it: ${SELF} stop${b && b.url !== 'http://127.0.0.1:4747' ? ' --port ' + new URL(b.url).port : ''}`); }
    if (e.code === 'EADDRINUSE') {
      const b = await board(opts.dir || HOME);
      fail(b ? `Switchboard (${label}) is already using port ${opts.port}.` : `Port ${opts.port} is used by another program, not Switchboard. Pick another one with --port.`);
    }
    throw e;
  }
}

(async () => {
  if (cmd === 'start') {
    const s = await startBoard({ port: port, host: flags.host, signals: true }, 'your board');
    console.log(`Switchboard is on.\nOpen it with this link (once per browser; it lets that browser approve things):\n  ${s.link}\nData file: ${s.store.file}\nStop with Ctrl+C, or from another terminal: ${SELF} stop${flags.port ? ' --port ' + flags.port : ''}`);
    if (flags.open) openLink(s.link);
  } else if (cmd === 'stop') {
    const b = await board(HOME); if (!b) notRunning();
    let pid = null; try { pid = JSON.parse(fs.readFileSync(path.join(b.dir, 'server.lock'), 'utf8')).pid; } catch (e) { /* no lock */ }
    if (!pid) fail(`Switchboard at ${b.url} did not leave a lock file, so its process is unknown. Stop it where it was started.`);
    try { process.kill(pid, 'SIGTERM'); } catch (e) { fail(`Could not stop process ${pid}: ${e.message}`); }
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 150)); if (!(await board(b.dir))) { console.log('Switchboard stopped.'); return; } }
    console.log('Asked it to stop, but something answers again (a login item with KeepAlive restarts it). Remove that login item to stop it for good.');
  } else if (cmd === 'link') {
    // The link that lets a browser act on the board. The key lives beside the data of the board that is running.
    const home = flags.sim ? path.join(os.homedir(), '.local', 'share', 'switchboard-sim', String(flags.port || 4750)) : HOME;
    const b = await board(home);
    if (!b) { const k = keyIn(home); fail(`Switchboard is not running${flags.sim ? ' (no simulation on that port)' : ` at ${BASE}`}.${k ? ' The link will work again once it is started.' : ''} Start it with: ${SELF} ${flags.sim ? 'sim' : 'start'}${flags.port ? ' --port ' + flags.port : ''}`); }
    const k = keyIn(b.dir); if (!k) fail(`The board at ${b.url} has no page key yet. Restart it.`);
    console.log(`${b.url}/?key=${k}`);
  } else if (cmd === 'sim') {
    // A throwaway board with made-up data. Never touches your real one.
    const p = flags.port || 4750, name = words[0] || 'morning';
    const known = Object.keys(require('../scenarios').scenarios); if (!known.includes(name)) fail(`No scenario "${name}". Try: ${known.join(', ')}`);
    const s = await startBoard({ port: p, host: flags.host, dir: path.join(os.homedir(), '.local', 'share', 'switchboard-sim', String(p)), sim: true, scenario: name, live: !flags['no-live'], signals: true }, 'a simulation');
    console.log(`Simulation "${name}" is on. Open it with this link:\n  ${s.link}\nMade-up data only. Switch scenarios from the bar at the top of the page.\nStop with Ctrl+C.`);
    if (flags.open) openLink(s.link);
  } else if (cmd === 'mcp') {
    require('../mcp');
  } else if (cmd === 'demo') {
    // Loading the examples is the person's own action, so it carries the page key of the board that is running.
    const b = await board(HOME); if (!b) notRunning();
    const r = await fetch(b.url + '/api/demo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-switchboard-key': keyIn(b.dir) }, body: JSON.stringify({ clear: !!flags.clear }) });
    if (!r.ok) fail((await r.json()).error);
    console.log(flags.clear ? 'Examples removed.' : `Examples added. Open ${b.url}`);
  } else if (cmd === 'raise') {
    if (!flags.area || !flags.title) fail('Usage: raise --area "Name" --title "What you need" [--kind ...] [--draft "..."] [--options "Yes,No"]');
    const b = await board(HOME); if (!b) notRunning();
    const body = Object.assign({}, flags); delete body.port;
    if (body.options != null) body.options = String(body.options).split(',').map((x) => x.trim()).filter(Boolean);
    if (body['follow-up-days'] != null) { body.follow_up_days = Number(body['follow-up-days']); delete body['follow-up-days']; }
    if (!body.agent) body.agent = 'command-line';
    const l = await api(b.url, 'POST', '/api/lights', body).catch((e) => fail(e.message));
    console.log(`Light ${l.id} is on: ${l.title}`);
    for (const w of l.warnings || []) console.log(`  note: ${w}`);
  } else if (cmd === 'list') {
    const b = await board(HOME); if (!b) notRunning();
    const v = await api(b.url, 'GET', '/api/state');
    // The same sentence the page builds: taps are timed, chores are counted apart, and what nobody has timed is said, not guessed.
    const taps = v.seconds < 90 ? `${v.seconds} sec of taps` : `about ${Math.round(v.seconds / 60)} min of taps`;
    const extra = [v.chores.count ? `${v.chores.count} longer job${v.chores.count === 1 ? '' : 's'} (about ${v.chores.minutes} min)` : '', v.unsized ? `${v.unsized} not timed yet` : ''].filter(Boolean).join(', ');
    console.log(`${v.queue.length} need you (${v.seconds ? taps : 'no quick taps'}${extra ? '; ' + extra : ''}) · ${v.counts.waiting_them} waiting on others · ${v.counts.auto} running`);
    for (const id of v.queue) { const l = v.lights.find((x) => x.id === id); console.log(`  ${l.id}  [${(v.areas.find((a) => a.id === l.area) || {}).name}] ${l.title}`); }
  }
})().catch((e) => fail(e.message));
