#!/usr/bin/env node
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const root = __dirname;
const SELF = `node "${path.join(root, 'cli.js')}"`; // what to type, wherever Switchboard was put
const expand = (p) => p.replace(/^~(?=$|[\\/])/, os.homedir());
const HOME = expand(process.env.SWITCHBOARD_HOME || path.join(os.homedir(), '.local', 'share', 'switchboard'));

const HELP = `Switchboard

  start [--port 4747] [--host 127.0.0.1] [--open]   run the board
  stop [--port N]                                     stop the board that is running
  link [--open] [--sim] [--port N]                    the link that lets a browser act on the board (printed only
                                                      in a terminal; --open opens it in the browser instead)
  link --copy [--at https://name:port]                put the link on the clipboard instead, for this computer or,
                                                      with --at, for a phone on your private network (SETUP step 8)
  sim [scenario] [--port 4750] [--open] [--no-live]   a made-up busy day (morning, slammed, comeback, trusted, clear, first-day)
  report [--days 7]                                   receipts: what came in, what you decided and how fast, what
                                                      was picked up and reported, what still waits (from the log)
  demo [--clear] [--port N]                           load or remove the example lights
  raise --area "Name" --title "What you need" [--kind approve|decide|sense|todo|fix]
        [--draft "..."] [--options "Yes,No"] [--state need_you|waiting_them|auto|queued|broken] [--due 2026-12-01] [--port N]
  list [--port N]                                     what needs you, from the command line
  rotate-key [--port N]                               a new page key: every link opened before stops working; the
                                                      board must restart to use it (a login item is stopped for you)
  snapshot [--label before-0.4.0]                     copy the data file to backups/ with the time in its name, before a
                                                      release or a restart, so the board can be put back exactly as it was
  restore --list                                      the backups, newest first: when, how big, how many lights
  restore <file>                                      put a backup back as the data file (the board must be stopped; the
                                                      data file as it is now is kept in backups/ first)
  app [--dir ~/Applications] [--port N]              on a Mac: make Switchboard.app, one click to open the board ready to
                                                      approve (it starts the board first if it is not running)
  mcp                                                 the assistant connector (MCP over stdio)

Flags take a value after a space or an equals sign: --port 5000 or --port=5000.`;

// Which flags each command takes. true = takes a value, false = a switch.
const FLAGS = {
  app: { dir: true, port: true },
  start: { port: true, host: true, open: false }, stop: { port: true }, link: { port: true, sim: false, open: false, copy: false, at: true },
  sim: { port: true, host: true, open: false, 'no-live': false }, demo: { port: true, clear: false }, list: { port: true }, snapshot: { label: true }, restore: { list: false }, 'rotate-key': { port: true }, report: { port: true, days: true }, mcp: {},
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
if (words.length && cmd !== 'sim' && cmd !== 'restore') fail(`"${words.join(' ')}" is not a flag. Put text in quotes after a flag, like --title "Order more boxes".`);
if (words.length > 1) fail(cmd === 'restore' ? `Name one backup, not "${words.join(' ')}". Put a name with spaces in quotes.` : `Give one scenario name, not "${words.join(' ')}".`);

const port = flags.port || process.env.SWITCHBOARD_PORT || 4747;
const BASE = (process.env.SWITCHBOARD_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
// A simulation follows SWITCHBOARD_PORT too, and keeps its data next to the data folder (switchboard-sim/<port>).
const simPort = String(flags.port || process.env.SWITCHBOARD_PORT || 4750);
const simHome = path.join(HOME.replace(/[\\/]+$/, '') + '-sim', simPort);
// A printed command must reach the board that is in use: the port goes in whenever it is not the usual one, whatever set
// it (--port, SWITCHBOARD_PORT or SWITCHBOARD_URL). A start command also needs the data folder, or it starts another board.
const portOf = (url) => { try { const u = new URL(url); return u.port || (u.protocol === 'https:' ? '443' : '80'); } catch (e) { return ''; } };
const onPort = (url, usual = '4747') => { const p = portOf(url); return p && p !== usual ? ' --port ' + p : ''; };
const withHome = () => (!process.env.SWITCHBOARD_HOME ? '' : process.platform === 'win32' ? `set "SWITCHBOARD_HOME=${HOME}" && ` : `SWITCHBOARD_HOME="${HOME}" `);
const startHint = (sim) => `${withHome()}${SELF} ${sim ? 'sim' + onPort('http://x:' + simPort, '4750') : 'start' + onPort(BASE)}`;
const notRunning = () => fail(`Switchboard is not running at ${BASE}. Start it with: ${startHint(false)}`);
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
// The key link is the person's. It is printed only to a terminal someone is looking at: into a pipe (an assistant's
// shell) or a log file it would reach a reader it was never meant for. There, `link --open` opens it in the browser.
const toPerson = (stream = process.stdout) => !!stream.isTTY;
const openHint = (url) => `${SELF} link --open${onPort(url)}`;
// The clipboard, so a link can go to another device (an iPhone through Universal Clipboard) without ever being printed.
function copyLink(text) {
  const tries = process.platform === 'darwin' ? [['pbcopy', []]] : process.platform === 'win32' ? [['clip', []]] : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']]];
  return tries.reduce((p, [cmd, args]) => p.catch(() => new Promise((ok, no) => {
    const c = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    c.on('error', no); c.on('exit', (code) => (code ? no(new Error(`exit ${code}`)) : ok()));
    c.stdin.end(text);
  })), Promise.reject(new Error('start'))).catch(() => fail('Could not reach the clipboard from here. Run this in your own terminal.'));
}
// open, xdg-open and start exit once they have handed the link over; an error exit means nothing opened. A browser named
// by BROWSER may keep running: still running after a few seconds counts as open.
function openLink(link) {
  const b = process.env.BROWSER; // the usual override, also used by the tests
  return new Promise((done) => {
    const c = spawn(b || (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'), !b && process.platform === 'win32' ? ['/c', 'start', '""', link] : [link], Object.assign({ stdio: 'ignore', detached: true }, !b && process.platform === 'win32' ? { windowsVerbatimArguments: true } : {}));
    let over = false; const end = (why) => { if (over) return; over = true; c.unref(); if (why) { console.error(`${why} Run ${SELF} link${onPort(link)} in your own terminal and open what it prints.`); process.exitCode = 1; } done(); };
    c.on('error', () => end('Could not open a browser from here.'));
    c.on('exit', (code) => end(code ? `The browser did not open (exit ${code}).` : ''));
    c.on('spawn', () => setTimeout(() => end(''), 3000).unref());
  });
}
// The macOS login item (LaunchAgent) that runs the board on this data folder, if there is one: { label, file }.
function loginItemFor(home) {
  if (process.platform !== 'darwin') return null;
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents'), real = (d) => { try { return fs.realpathSync(expand(d)); } catch (e) { return path.resolve(expand(d)); } };
  let names = []; try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.plist')); } catch (e) { return null; }
  for (const f of names) {
    let t = ''; try { t = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { continue; }
    if (!/<string>[^<]*switchboard[^<]*[\\/](?:server|cli)\.js<\/string>/i.test(t) || /board-relay\.js/.test(t)) continue;
    const h = (t.match(/<key>SWITCHBOARD_HOME<\/key>\s*<string>([^<]*)<\/string>/) || [])[1] || path.join(os.homedir(), '.local', 'share', 'switchboard');
    const label = (t.match(/<key>Label<\/key>\s*<string>([^<]*)<\/string>/) || [])[1];
    if (label && real(h) === real(home)) return { label, file: path.join(dir, f) };
  }
  return null;
}
async function startBoard(opts, label) {
  try { return await require('./server').start(opts); }
  catch (e) {
    if (e.code === 'ELOCKED') { const b = await board(opts.dir || HOME); const k = b && keyIn(b.dir); fail(`Switchboard is already running${b ? ' at ' + b.url : ''}.${k ? `\nOpen it with: ${toPerson(process.stderr) && !opts.sim ? `${b.url}/?key=${k}` : opts.sim ? `${SELF} link --sim${onPort(b.url, '4750')}` : openHint(b.url)}` : ''}\nTo stop it: ${SELF} stop${onPort(b ? b.url : e.url || BASE)}`); }
    if (e.code === 'EADDRINUSE') {
      const b = await board(opts.dir || HOME);
      if (b) fail(`Switchboard (${label}) is already using port ${opts.port}.`);
      // Another board (your own, say, when a simulation was pointed at its port) is not "another program".
      let other = false; try { const h = await (await fetch(`http://127.0.0.1:${opts.port}/api/health`, { signal: AbortSignal.timeout(1500) })).json(); other = !!h && h.name === 'switchboard'; } catch (e2) { /* not a board */ }
      fail(other ? `Another Switchboard is using port ${opts.port}. Pick another one with --port.` : `Port ${opts.port} is used by another program, not Switchboard. Pick another one with --port.`);
    }
    throw e;
  }
}

(async () => {
  if (cmd === 'snapshot') {
    // Reads the data file and writes a copy beside the daily ones; the board keeps running and its file is not touched.
    try { console.log(`Saved a copy of the board: ${require('./lib/store').snapshot(HOME, flags.label)}\nTo put it back: stop the board, copy that file over ${path.join(HOME, 'data.json')}, start it.`); }
    catch (e) { fail(e.message); }
    return;
  }
  if (cmd === 'restore') {
    const S = require('./lib/store');
    const size = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
    const when = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const RESTORE = `${withHome()}${SELF} restore`;
    if (flags.list) {
      if (words.length) fail('--list takes no file name. To put one back: ' + RESTORE + ' <file>');
      const all = S.listBackups(HOME);
      if (!all.length) { console.log(`No backups yet in ${path.join(HOME, 'backups')}. The board makes one the first time it saves each day.`); return; }
      console.log(`Backups in ${path.join(HOME, 'backups')}, newest first:`);
      for (const b of all) console.log(`  ${when(b.at).padEnd(28)} ${size(b.size).padStart(9)}  ${b.ok ? `${b.lights} light${b.lights === 1 ? '' : 's'}`.padEnd(11) : 'damaged'.padEnd(11)}  ${b.name}${b.ok ? '' : ` (cannot be put back: ${b.why})`}`);
      console.log(`Put one back (with the board stopped): ${RESTORE} <name>`);
      return;
    }
    if (!words.length) fail(`Name the backup to put back: ${RESTORE} <file>. See them all: ${RESTORE} --list`);
    // Never while the board runs: it holds the data in memory and its next save would write over what was put back.
    const login = loginItemFor(HOME), uid = typeof process.getuid === 'function' ? process.getuid() : '$(id -u)';
    const stopHow = (url) => login
      ? `Its login item (${login.label}) starts it again by itself, so stop it with: launchctl bootout gui/${uid} "${login.file}"`
      : `Stop it first: ${withHome()}${SELF} stop${onPort(url || BASE)}`;
    const b = await board(HOME);
    if (b) fail(`Switchboard is running at ${b.url}, so nothing was changed. ${stopHow(b.url)}. Then run this again.`);
    let held = null; try { held = JSON.parse(fs.readFileSync(path.join(HOME, 'server.lock'), 'utf8')); } catch (e) { /* no lock: not running */ }
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    if (held && held.pid && held.host === os.hostname() && alive(held.pid)) fail(`Switchboard is starting or running (process ${held.pid}), so nothing was changed. ${stopHow(held.url)}. If nothing is running, delete ${path.join(HOME, 'server.lock')} and run this again.`);
    let r; try { r = S.restore(HOME, words[0]); } catch (e) { fail(e.message); }
    const start = login ? `launchctl bootstrap gui/${uid} "${login.file}" (or, if it is still loaded, it starts by itself in a few seconds)` : startHint(false);
    console.log(`Put back ${r.from} (${r.lights} light${r.lights === 1 ? '' : 's'}) as ${path.join(HOME, 'data.json')}.${r.kept ? `\nThe data file as it was is kept at ${r.kept}.` : ''}\nStart the board: ${start}`);
    return;
  }
  // Does a com.switchboard plist start the board b? Its SWITCHBOARD_HOME (or the usual folder) and its port
  // (SWITCHBOARD_PORT, --port, or 4747) must both match.
  function loginItemIs(plist, b) {
    if (!plist.includes('cli.js')) return false;
    const env = (k) => (plist.match(new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`)) || [])[1];
    const real = (d) => { try { return fs.realpathSync(expand(d)); } catch (e) { return path.resolve(expand(d)); } };
    const home = env('SWITCHBOARD_HOME') || path.join(os.homedir(), '.local', 'share', 'switchboard');
    const p = env('SWITCHBOARD_PORT') || (plist.match(/<string>--port<\/string>\s*<string>(\d+)<\/string>/) || [])[1] || '4747';
    return real(home) === real(b.dir) && String(portOf(b.url) || '4747') === String(p);
  }
  if (cmd === 'rotate-key') {
    // A new page key, for a link that was shared too widely or a device that is gone. The board reads its key when it
    // starts, so the old one keeps working until the board restarts; after that every old link can only look.
    const b = await board(HOME), dir = b ? b.dir : HOME, file = path.join(dir, 'page.key');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmpFile = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmpFile, require('crypto').randomBytes(16).toString('hex') + '\n', { mode: 0o600 });
    fs.chmodSync(tmpFile, 0o600); fs.renameSync(tmpFile, file); // whole or not at all, and never readable by others
    const linkHint = `Then get the new link: ${withHome()}${SELF} link${onPort(b ? b.url : BASE)} in your own terminal (or link --open, or link --copy for your phone). Open it once in each browser you use; links opened before can only look.`;
    const phone = process.env.SWITCHBOARD_PHONE_URL && /[?&]key=/.test(process.env.SWITCHBOARD_PHONE_URL) ? ' SWITCHBOARD_PHONE_URL holds the old key: put the new link there too.' : '';
    if (!b) { console.log(`New page key written to ${file}. The board is not running; it uses the new key when it starts. ${linkHint}${phone}`); return; }
    // A login item (macOS LaunchAgent) restarts only after a crash, never after a deliberate stop: stop it here, so it
    // is never left answering with the old key, and say how to start it again.
    const agentFile = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.switchboard.plist');
    // ...and only when that login item starts this very board: the same data folder and the same port. A practice board
    // on another port is never mistaken for it.
    let login = false; try { login = process.platform === 'darwin' && loginItemIs(fs.readFileSync(agentFile, 'utf8'), b); } catch (e) { /* no login item */ }
    if (!login) { console.log(`New page key written to ${file}. The board at ${b.url} still uses the old key until it restarts. Restart it now: ${withHome()}${SELF} stop${onPort(b.url)}, then ${startHint(false)}. ${linkHint}${phone}`); return; }
    let pid = null; try { pid = JSON.parse(fs.readFileSync(path.join(b.dir, 'server.lock'), 'utf8')).pid; } catch (e) { /* no lock */ }
    let stopped = false;
    if (pid) { try { process.kill(pid, 'SIGTERM'); for (let i = 0; i < 20 && !stopped; i++) { await new Promise((r) => setTimeout(r, 150)); stopped = !(await board(b.dir)); } } catch (e) { /* not ours to stop */ } }
    const uid = typeof process.getuid === 'function' ? process.getuid() : '$(id -u)';
    console.log(`New page key written to ${file}. ${stopped ? 'Your board (a login item) is stopped so it never answers with the old key.' : `Could not stop the board at ${b.url}; stop it yourself (${SELF} stop${onPort(b.url)}).`} Start it again: launchctl kickstart gui/${uid}/com.switchboard (or log out and back in). ${linkHint}${phone}`);
    return;
  }
  if (cmd === 'start') {
    const s = await startBoard({ port: port, host: flags.host, signals: true }, 'your board');
    console.log(`Switchboard is on.\n${toPerson() ? `Open it with this link (once per browser; it lets that browser approve things):\n  ${s.link}` : `It is at ${s.url}. Open it ready to approve with: ${openHint(s.url)}\n(The link with its key is printed only in a terminal.)`}\nData file: ${s.store.file}\nStop with Ctrl+C, or from another terminal: ${SELF} stop${onPort(s.url)}`);
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
    const home = flags.sim ? simHome : HOME;
    const b = await board(home);
    if (!b) { const k = keyIn(home); fail(`Switchboard is not running${flags.sim ? ' (no simulation on that port)' : ` at ${BASE}`}.${k ? ' The link will work again once it is started.' : ''} Start it with: ${startHint(flags.sim)}`); }
    const k = keyIn(b.dir); if (!k) fail(`The board at ${b.url} has no page key yet. Restart it.`);
    if (flags.at !== undefined && !flags.copy) fail('--at goes with --copy: the link for another device goes on the clipboard, never into a terminal log.');
    if (flags.copy) {
      // The link for this computer, or for another device that reaches the board at another address (tailscale serve).
      let base = b.url;
      if (flags.at !== undefined) {
        let u = null; try { u = new URL(String(flags.at)); } catch (e) { /* not a web address */ }
        if (!u || !/^https?:$/.test(u.protocol) || u.pathname.length > 1 || u.search || u.hash) fail(`--at needs the address the other device opens, like https://your-machine.your-tailnet.ts.net:8443`);
        base = u.origin;
      }
      await copyLink(`${base}/?key=${k}`);
      console.log(`Copied the key link${flags.at !== undefined ? ` for ${base}` : ''} to your clipboard. Paste it into the browser on that device once; it is remembered there.`);
      return;
    }
    // A simulation's key opens made-up data only, so it is printed wherever it is asked for.
    if (flags.open) { console.log(`Opening Switchboard at ${b.url} in the browser.`); await openLink(`${b.url}/?key=${k}`); }
    else if (flags.sim || toPerson()) console.log(`${b.url}/?key=${k}`);
    else console.log(`Switchboard is running at ${b.url}. Its link is printed only in a terminal, for the person: ${SELF} link${onPort(b.url)}. To open it in the browser on this computer: ${openHint(b.url)}`);
  } else if (cmd === 'app') {
    // A Mac app that opens this board with its key link: no terminal, one click from the Dock. It holds no key itself:
    // each click asks the running board for its link (a new key after rotate-key just works).
    if (process.platform !== 'darwin') fail(`The app is for a Mac. Elsewhere, open ${SELF} link --open, or bookmark the board after opening its link once.`);
    const dir = expand(flags.dir ? String(flags.dir) : path.join(os.homedir(), 'Applications'));
    const app = path.join(dir, 'Switchboard.app'), contents = path.join(app, 'Contents');
    const q = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
    const port = flags.port != null ? ' --port ' + Number(flags.port) : onPort(BASE);
    const home = process.env.SWITCHBOARD_HOME ? `export SWITCHBOARD_HOME=${q(HOME)}\n` : '';
    const cli = q(path.join(root, 'cli.js')), node = q(process.execPath);
    const script = `#!/bin/sh
# Switchboard.app: opens the board ready to approve. Made by "cli.js app"; run it again to remake it.
${home}if ${node} ${cli} link --open${port} >/dev/null 2>&1; then exit 0; fi
# Not running: start it in the background, then open it once it answers.
nohup ${node} ${cli} start${port} >/dev/null 2>&1 &
i=0; while [ $i -lt 20 ]; do sleep 0.5; if ${node} ${cli} link --open${port} >/dev/null 2>&1; then exit 0; fi; i=$((i+1)); done
osascript -e 'display alert "Switchboard did not start" message "Run: node cli.js start in Terminal to see why."' >/dev/null 2>&1
exit 1
`;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Switchboard</string>
<key>CFBundleDisplayName</key><string>Switchboard</string>
<key>CFBundleIdentifier</key><string>local.switchboard.open</string>
<key>CFBundleExecutable</key><string>Switchboard</string>
<key>CFBundleIconFile</key><string>Switchboard</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${require('./package.json').version}</string>
<key>LSUIElement</key><true/>
</dict></plist>
`;
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'Info.plist'), plist);
    fs.writeFileSync(path.join(contents, 'MacOS', 'Switchboard'), script, { mode: 0o755 });
    fs.chmodSync(path.join(contents, 'MacOS', 'Switchboard'), 0o755);
    // The board's own icon, as the Mac wants it (sips comes with macOS); without it the app still works.
    try { require('child_process').execFileSync('/usr/bin/sips', ['-s', 'format', 'icns', path.join(root, 'icon.png'), '--out', path.join(contents, 'Resources', 'Switchboard.icns')], { stdio: 'ignore', timeout: 20000 }); } catch (e) { /* no icon */ }
    console.log(`Made ${app}. Drag it from that folder onto your Dock. Each click opens the board ready to approve${port ? ' on' + port.replace(' --port', ' port') : ''}.`);
  } else if (cmd === 'report') {
    // Receipts from the board's own log, read where the board keeps it; what is open now comes from the board itself.
    const b = await board(HOME);
    if (!b) fail(`Switchboard is not running at ${BASE}. Start it with: ${startHint()}`);
    const days = flags.days != null ? Number(flags.days) : 7;
    if (!(days > 0 && days <= 365)) fail('--days takes a number of days from 1 to 365.');
    let events = [];
    try { events = fs.readFileSync(path.join(b.dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); } catch (e) { /* no log yet */ }
    console.log(require('./lib/report').report(events, await api(b.url, 'GET', '/api/state'), { days }));
  } else if (cmd === 'sim') {
    // A throwaway board with made-up data. Never touches your real one.
    const name = words[0] || 'morning';
    const known = Object.keys(require('./scenarios').scenarios); if (!known.includes(name)) fail(`No scenario "${name}". Try: ${known.join(', ')}`);
    const s = await startBoard({ port: simPort, host: flags.host, dir: simHome, sim: true, scenario: name, live: !flags['no-live'], signals: true }, 'a simulation');
    console.log(`Simulation "${name}" is on. Open it with this link:\n  ${s.link}\nMade-up data only. Switch scenarios from the bar at the top of the page.\nStop with Ctrl+C.`);
    if (flags.open) openLink(s.link);
  } else if (cmd === 'mcp') {
    require('./mcp');
  } else if (cmd === 'demo') {
    // Loading the examples is the person's own action, so it carries the page key of the board that is running.
    const b = await board(HOME); if (!b) notRunning();
    const r = await fetch(b.url + '/api/demo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-switchboard-key': keyIn(b.dir) }, body: JSON.stringify({ clear: !!flags.clear }) });
    if (!r.ok) fail((await r.json()).error);
    // The key link, not the bare address: a browser opened on the bare address can only look. Printed only to a terminal.
    const k = keyIn(b.dir);
    console.log(flags.clear ? 'Examples removed.' : k && toPerson() ? `Examples added. Open them with this link: ${b.url}/?key=${k}` : `Examples added. Open them ready to approve with: ${openHint(b.url)}`);
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
