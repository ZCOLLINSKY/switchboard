#!/usr/bin/env node
'use strict';
// MCP server (stdio). Gives any MCP-capable assistant tools to work the board.
// It talks to the local Switchboard server over HTTP and starts it if it is not running.
const { spawn } = require('child_process');
const path = require('path');

// A launcher that could not fill in a setting (an empty value, or "${user_config.port}" left as written) means "not set",
// here and in the board this process may start.
for (const k of ['SWITCHBOARD_HOME', 'SWITCHBOARD_PORT', 'SWITCHBOARD_URL', 'SWITCHBOARD_AGENT']) {
  const v = process.env[k]; if (v != null && (!v.trim() || v.includes('${') || (k === 'SWITCHBOARD_PORT' && !/^\d{1,5}$/.test(v.trim())))) delete process.env[k];
}
const VERSION = require('./package.json').version; // the one place the version is written
let AGENT = process.env.SWITCHBOARD_AGENT || ''; // who this assistant is on the board; set at initialize if not given
const os = require('os'), fs = require('fs');
const HOME = (process.env.SWITCHBOARD_HOME || path.join(os.homedir(), '.local', 'share', 'switchboard')).replace(/^~(?=$|\/)/, os.homedir());
let BASE = (process.env.SWITCHBOARD_URL || `http://127.0.0.1:${process.env.SWITCHBOARD_PORT || 4747}`).replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notThere = (e) => { const c = (e && e.cause && e.cause.code) || (e && e.code) || ''; return c === 'ECONNREFUSED' || c === 'ENOENT' || c === 'EADDRNOTAVAIL'; };

// One request to the board, with a time limit, and cancelled if the assistant gives up on the call.
function call(base, method, route, body, signal, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(new Error('timeout')), ms);
  const stop = () => ac.abort(new Error('cancelled'));
  if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
  return fetch(base + route, { method, signal: ac.signal, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .catch((e) => { if (ac.signal.aborted) throw Object.assign(new Error(signal && signal.aborted ? 'cancelled' : `Switchboard at ${base} did not answer within ${Math.round(ms / 1000)} seconds. It may be busy or frozen; nothing is known to have changed.`), { code: signal && signal.aborted ? 'CANCELLED' : 'TIMEOUT' }); throw e; })
    .finally(() => { clearTimeout(t); if (signal) signal.removeEventListener('abort', stop); });
}
// Claude Desktop's built-in Node is not a real node binary and refuses to start one (SelfExecBlockedError,
// ERR_MCP_NODE_HOST_NOT_NODE). There, and when SWITCHBOARD_IN_PROCESS=1, the board runs inside this connector: it is on
// while the app is open and stops with it.
const IN_PROCESS = !!process.versions.electron || process.env.SWITCHBOARD_IN_PROCESS === '1';
let here = null; // the board, when it runs in this process
async function startHere() {
  if (!here) here = require('./server').start({ dir: HOME });
  try { BASE = (await here).url; } catch (e) { here = null; throw new Error(`Switchboard could not start: ${e.code === 'EADDRINUSE' ? 'another program uses its port. Pick another port in its settings.' : e.message}`); }
}
// Start the board and wait for it. If it refuses to start, its own reason is passed on, not swallowed.
async function startBoard() {
  if (IN_PROCESS) return startHere();
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: process.env });
  let err = '', exited = null, refused = null;
  child.stderr.on('data', (d) => { err += d; }); child.on('exit', (code) => { exited = code; }); child.on('error', (e) => { refused = e; });
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    if (refused) return startHere(); // this runtime cannot start a second Node process: run the board here instead
    if (exited != null) throw new Error(`Switchboard could not start: ${err.trim() || 'it stopped at once (exit ' + exited + ')'}`);
    try { const r = await call(BASE, 'GET', '/api/health', null, null, 1000); if (r.ok) { child.stderr.destroy(); child.unref(); return; } } catch (_) { /* still starting */ }
  }
  child.stderr.destroy(); child.unref();
  throw new Error(`Switchboard was started but does not answer at ${BASE} yet.${err.trim() ? ' It said: ' + err.trim() : ''}`);
}
// When a data folder was named, the board used must be the one serving it, never a different board on the default port.
let checked = !process.env.SWITCHBOARD_HOME;
async function ensureBoard(signal) {
  if (checked) return;
  const want = path.resolve(HOME), serves = async (base) => { try { const h = await (await call(base, 'GET', '/api/health', null, signal, 2000)).json(); return h && h.name === 'switchboard' ? path.resolve(path.dirname(h.data)) : null; } catch (e) { return null; } };
  let lock = null; try { lock = JSON.parse(fs.readFileSync(path.join(HOME, 'server.lock'), 'utf8')).url; } catch (e) { /* none */ }
  if (lock && (await serves(lock)) === want) { BASE = lock; checked = true; return; }
  const at = await serves(BASE);
  if (at === want) { checked = true; return; }
  if (at) throw new Error(`Another Switchboard (data in ${at}) answers at ${BASE}, not the one for ${want}. Set SWITCHBOARD_PORT for this data folder.`);
  checked = true; // nothing answers: the normal path below starts this folder's board
}
async function api(method, route, body, signal, ms = 10000) {
  await ensureBoard(signal);
  const read = async (res) => { const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` })); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; };
  try { return await read(await call(BASE, method, route, body, signal, ms)); }
  catch (e) {
    if (!notThere(e)) {
      if (e.code === 'CANCELLED' || e.code === 'TIMEOUT' || !(e instanceof TypeError)) throw e;
      // The board went away while it had the request: it may have done it. Never send a write twice without saying so.
      throw new Error(method === 'GET' ? `Switchboard stopped while answering (${e.cause ? e.cause.code || e.cause.message : e.message}). Try again.` : 'Switchboard stopped while handling this call, so it may or may not have been done. Check with list_lights (and get_decisions) before trying again.');
    }
  }
  // Nothing listens at BASE. The board may be on another port: its lock file says where. Never start a second writer.
  try {
    const held = JSON.parse(fs.readFileSync(path.join(HOME, 'server.lock'), 'utf8'));
    if (held.url && held.url !== BASE) { try { const out = await read(await call(held.url, method, route, body, signal, ms)); BASE = held.url; return out; } catch (e2) { if (!notThere(e2)) throw e2; } }
  } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError) && !notThere(e)) throw e; }
  await startBoard();
  // The first attempt never reached a board, so sending it now is the first time, not a repeat.
  return read(await call(BASE, method, route, body, signal, ms));
}

const S = (description, extra) => Object.assign({ type: 'string', description }, extra);
const lightFields = {
  title: S('What the person sees, as an action. Example: "Reply to the venue and mark the show postponed".'),
  draft: S('The exact text that will be sent or applied if approved. Always include it for kind "approve".'),
  source: S('What came in that triggered this: the quoted message, who sent it and when.'),
  change_from: S('For a change to a record: the current value.'),
  change_to: S('For a change to a record: the new value.'),
  options: { type: 'array', items: { type: 'string' }, description: 'Answer buttons for kind "decide", "sense" or "fix". Up to 6 short labels.' },
  link: S('A page the person should open (http or https).'),
  seconds: { type: 'integer', description: 'Honest estimate of the tap itself in seconds: reading and deciding at the board. Leave out to use their measured average. For work away from the board, use work_minutes.' },
  work_minutes: { type: 'integer', description: 'For a job the person must go and do (a call, a form, a drive): minutes of work, 1 to 600. Listed apart from the quick taps.' },
  changed: S('After a request for changes: one line on what you changed ("Added the $1,008 deposit; offered Thursday only"). Shown next to their request. Keep note for background.'),
  question: S('A question back to the person, when their request needs a fact you do not have. Shown on the card; their answer comes back as a new request.'),
  for_anyone: { type: 'boolean', description: 'Let any assistant collect the decision, not only sessions like this one (this assistant started in this folder). Use it while setting up the person\'s board, and for work any session can finish.' },
  holds_up: S('What is blocked until this is handled, in a few words ("Friday payroll"). A broken job that holds something up sorts near the top.'),
  next: S('One line on what happens after they act. Example: "waits 3 days for their reply, then drafts a follow-up for you".'),
  follow_up_days: { type: 'integer', description: 'For a message to someone: days to wait for a reply before the light comes back.' },
  follow_up_draft: S('Optional follow-up text to use when the wait runs out.'),
  progress: { type: 'integer', description: 'For state "auto": percent complete, 0 to 100.' },
  batch: { type: 'integer', description: 'How many similar items this one light stands for (default 1).' },
  note: S('One short line of context.'),
  due: S('ISO date or datetime when this must be handled. Things due within a day go to the top of the queue.'),
  to: S('Who it goes to, as the person would recognise them ("Dale Henderson"). Shown on the card and returned with the decision.'),
  attachments: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, link: { type: 'string' } } }, description: 'Files the message refers to, as {name, link}. Shown as chips so "attached is the quote" can be checked.' },
  payload: { description: 'Anything you will need to act on the answer later (thread id, record id, mailbox), up to 4 KB. Stored untouched and handed back with the decision, so a new session can finish the job.' },
  key: S('A stable id for this thread, such as an email thread id. Raising again with the same key updates the same light instead of making a second one.'),
  expect_by: S('For state "auto": ISO time by which you expect to report again. If you go quiet past it, the light turns amber.'),
  value: { type: 'number', description: 'Money riding on this, in whole dollars (a quote amount, an invoice). Higher values sort first. Only set it when you know the number.' },
};
const TOOLS = [
  { name: 'raise_light', description: 'Put one thing on the person\'s Switchboard. Use it when you are blocked on them (state need_you), have sent something and are waiting on someone else (waiting_them), are running a job they should see (auto), have something lined up (queued), or an automation failed (broken). One light per thread; update it as the thread moves instead of raising a new one.',
    inputSchema: { type: 'object', required: ['area', 'title'], properties: Object.assign({
      area: S('Which container it belongs to, by name. A new name creates a new container.'),
      state: S('Who holds the ball.', { enum: ['need_you', 'waiting_them', 'auto', 'queued', 'broken'], default: 'need_you' }),
      kind: S('What you need from the person: approve (a draft to send or a change to apply), decide (pick one option), sense (look at something you cannot access and report back), todo (their own task), fix (broken automation).', { enum: ['approve', 'decide', 'sense', 'todo', 'fix'] }),
      outbound: { type: 'boolean', description: 'True if approving sends a message to another person. Outbound lights are never auto-approved.' },
      phone: S('For a text the person sends from their own phone: the recipient number. The board opens their Messages app with the draft.'),
      channel: S('How an approved draft goes out: agent (you send it after picking up the decision), sms (they send from their phone), copy (they paste it somewhere).', { enum: ['agent', 'sms', 'copy'] }),
      action_type: S('A stable name for this recurring kind of action, e.g. "listing-fix". Unedited approval streaks are tracked per type so the person can promote it to run by itself.'),
    }, lightFields) } },
  { name: 'update_light', description: 'Change a light you raised: move it to a new state as the thread progresses, update progress, replace the draft, or mark it done.',
    inputSchema: { type: 'object', required: ['id'], properties: Object.assign({ id: S('The light id.'),
      state: S('New state.', { enum: ['need_you', 'waiting_them', 'auto', 'queued', 'broken', 'done', 'dropped'] }), reason: S('Why it moved.'),
      kind: S('New kind.', { enum: ['approve', 'decide', 'sense', 'todo', 'fix'] }), area: S('Move it to this container.') }, lightFields) } },
  { name: 'list_lights', description: 'See what is on the board now. Check this before raising a light so you do not duplicate a thread.',
    inputSchema: { type: 'object', properties: { area: S('Only this container.'), state: S('Only this state.') } } },
  { name: 'get_decisions', description: 'Collect what the person decided on the lights you raised: approvals (with their final text and whether they edited it), answers, declines, "they replied". Collecting is a commitment and a claim: the person can no longer take the decision back, and nobody else is handed it for 10 minutes, so act on each one and report with complete_decision and its decision_id. Send exactly what the decision carries: its text, its "to", its attachments and its payload are what the person approved, even if the light has changed since. A decision with needs_check: true was collected before and never reported: find out whether it already went out BEFORE sending anything, and report "unsure" if you cannot tell. "sent_by_you" lists messages the person sent themselves: facts for your records, never something to send. Also returns follow-ups that need a draft from you and quick notes that need filing.',
    inputSchema: { type: 'object', properties: { all: { type: 'boolean', description: 'Also return decisions on lights raised by other assistants. Leave off unless the person asked you to take over someone else\'s work.' } } } },
  { name: 'complete_decision', description: 'Report what happened after you acted on a decision, naming the decision_id you were handed. "sent": the message went out (this is what turns the light blue and starts the follow-up clock). "done": the change was applied or the answer was handled. "failed": it definitely did not go through; say why. "unsure": you cannot tell whether it went out (a timeout, a crash mid-send); the person is asked to check, and nothing is retried blind. Never report "failed" when you are not sure.',
    inputSchema: { type: 'object', required: ['id', 'decision_id', 'outcome'], properties: { id: S('The light id.'), decision_id: S('The decision_id from get_decisions or wait_for_decision. A report for a decision that was since replaced is refused.'), outcome: S('What happened.', { enum: ['sent', 'done', 'failed', 'unsure'] }), detail: S('One plain line. Required for failed and unsure.') } } },
  { name: 'wait_for_decision', description: 'Wait up to N seconds for the person to decide one light, when you are mid-task and the answer unblocks you. Works only for a light you raised. Getting the answer this way collects it exactly as get_decisions does: the person can no longer take it back, so act on it and report with complete_decision. Returns {decided:false} if they have not decided; then carry on with other work or wait again.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: S('The light id.'), seconds: { type: 'integer', description: '1 to 50. Default 30.' } } } },
  { name: 'ack_decisions', description: 'The short form of complete_decision with outcome "done", for several lights at once. Not for messages to people: those are skipped and listed in warnings, and need complete_decision with sent, failed or unsure.',
    inputSchema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } } },
  { name: 'add_area', description: 'Create or update a container (a business, a project, school, family).',
    inputSchema: { type: 'object', required: ['name'], properties: { name: S('Container name.'), note: S('One line shown under the name.'), voice: S('How drafts for this container should sound, in the person\'s own words. Read it from list_lights before you write a draft.'), color: S('Hex color like #4C8DF6.'), wake_at: S('ISO date. Until then the container is dimmed; on that date it raises one light asking for its focus.') } } },
  { name: 'get_light', description: 'Read one light in full: its draft, what came in, note, recipient, attachments, due date, and what the person asked to change. Use it before redrafting.', inputSchema: { type: 'object', required: ['id'], properties: { id: S('The light id.') } } },
  { name: 'clear_examples', description: 'Remove the example lights and example containers once the person has real ones.', inputSchema: { type: 'object', properties: {} } },
  { name: 'open_board', description: 'Open the person\'s Switchboard in their web browser, ready to approve. Use it the first time on a computer, when they ask to see the board, or when the board says "View only in this browser". The link carries their key, so it is opened for them and never shown to you: you still cannot approve anything.', inputSchema: { type: 'object', properties: {} } },
  { name: 'setup_guide', description: 'Read this before setting up the person\'s board for the first time, or when they ask you to set Switchboard up: the questions to ask and how to put their real life on the board.', inputSchema: { type: 'object', properties: {} } },
];

// Opens the key link in the person's browser. The key goes from the board's data folder straight to the browser.
function openInBrowser(link) {
  const b = process.env.BROWSER; // the usual override, also used by the tests
  const [cmd, args, extra] = b ? [b, [link], {}] : process.platform === 'darwin' ? ['open', [link], {}]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', link], { windowsVerbatimArguments: true }] : ['xdg-open', [link], {}];
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, Object.assign({ stdio: 'ignore', detached: true, windowsHide: true }, extra));
    c.on('error', () => reject(new Error(`Could not open a browser from here. Ask the person to run this in their own terminal and open what it prints: node "${path.join(__dirname, 'cli.js')}" link`)));
    c.on('spawn', () => { c.unref(); resolve(); });
  });
}

async function callTool(name, a, signal) {
  const need = (k) => { if (typeof a[k] !== 'string' || !a[k]) throw new Error(`${k} is required (text).`); };
  if (name === 'raise_light') { const b = Object.assign({}, a, { agent: a.for_anyone ? '' : AGENT }); delete b.for_anyone; return api('POST', '/api/lights', b, signal); }
  if (['complete_decision', 'wait_for_decision', 'update_light'].includes(name)) need('id');
  if (name === 'complete_decision') { const l = await api('POST', '/api/complete', a, signal); return { id: l.id, state: l.state, warnings: l.warnings }; }
  if (name === 'wait_for_decision') { const sec = Math.min(Math.max(Number(a.seconds) || 30, 1), 50); return api('POST', '/api/wait', { id: a.id, seconds: sec, agent: AGENT }, signal, (sec + 10) * 1000); }
  if (name === 'update_light') return api('POST', '/api/lights/' + encodeURIComponent(a.id), Object.assign({}, a, { agent: AGENT }), signal);
  if (name === 'get_decisions') return api('POST', '/api/decisions', { agent: AGENT, all: a.all === true }, signal);
  if (name === 'ack_decisions') { const ids = Array.isArray(a.ids) ? a.ids : typeof a.ids === 'string' ? [a.ids] : typeof a.id === 'string' ? [a.id] : null; if (!ids) throw new Error('ids is required: a list of light ids.'); return api('POST', '/api/ack', { ids, agent: AGENT }, signal); }
  if (name === 'add_area') return api('POST', '/api/areas', a, signal);
  if (name === 'get_light') { need('id'); const v = await api('GET', '/api/state', null, signal), l = v.lights.find((x) => x.id === a.id); if (!l) throw new Error('No light with that id is open. Finished lights are not listed.'); const keep = ['id', 'title', 'state', 'kind', 'draft', 'source', 'note', 'to', 'attachments', 'options', 'link', 'due', 'value', 'key', 'changeFrom', 'changeTo', 'askedFor', 'changed', 'question', 'followUpDays', 'lastSent']; const out = {}; keep.forEach((k) => { if (l[k] != null && l[k] !== '' && !(Array.isArray(l[k]) && !l[k].length)) out[k] = l[k]; }); out.area = (v.areas.find((x) => x.id === l.area) || {}).name; if (out.due) out.due = new Date(out.due).toISOString(); return out; }
  if (name === 'clear_examples') return api('POST', '/api/demo', { clear: true }, signal);
  if (name === 'setup_guide') {
    const md = fs.readFileSync(path.join(__dirname, 'SETUP.md'), 'utf8');
    const part = (from, to) => { const a = md.indexOf(from); if (a < 0) return ''; const b = to ? md.indexOf(to, a) : -1; return md.slice(a, b < 0 ? md.length : b).trim(); };
    return { guide: [part('## 5.', '## 7.'), part('## Rules that always apply')].filter(Boolean).join('\n\n'),
      note: 'You are already connected, so skip installing anything. Wherever the guide says to give the person the link, call open_board instead.' };
  }
  if (name === 'open_board') {
    const h = await api('GET', '/api/health', null, signal); // starts the board if it is not running
    let key = ''; try { key = fs.readFileSync(path.join(path.dirname(h.data || ''), 'page.key'), 'utf8').trim(); } catch (e) { /* none */ }
    if (!h.data || !/^[a-f0-9]{32}$/.test(key)) throw new Error('The board did not give a key for this computer. Restart it, then try again.');
    await openInBrowser(`${BASE}/?key=${key}`);
    return { opened: true, board: BASE, note: 'Opened in their browser. The link is theirs and was not shown to you.' };
  }
  if (name === 'list_lights') {
    const v = await api('GET', '/api/state', null, signal);
    const areaName = (id) => (v.areas.find((x) => x.id === id) || {}).name || id;
    const want = String(a.area == null ? '' : a.area).toLowerCase();
    if (a.state === 'done' || a.state === 'dropped') throw new Error('Finished lights are not listed here. The person can search them under "What did I decide?".');
    return { board: BASE, need_you_seconds: v.seconds, counts: v.counts,
      areas: v.areas.map((x) => ({ name: x.name, note: x.note, voice: [x.voice].concat((x.rules || []).map((r) => 'Always: ' + r)).filter(Boolean).join('\n') || undefined, asleep_until: x.wakeAt ? new Date(x.wakeAt).toISOString() : null })),
      lights: v.lights.filter((l) => (!a.state || l.state === a.state) && (!want || areaName(l.area).toLowerCase() === want))
        .map((l) => ({ id: l.id, area: areaName(l.area), state: l.state, kind: l.kind, title: l.title, example: l.demo || undefined, stale: l.stale || undefined,
          follow_up_at: l.followUpAt ? new Date(l.followUpAt).toISOString() : undefined, batch: l.batch > 1 ? l.batch : undefined })) };
  }
  throw new Error(`Unknown tool ${name}`);
}

// U+2028 and U+2029 are legal inside JSON strings, but some clients split lines on them: always send them escaped.
const send = (msg) => process.stdout.write(JSON.stringify(msg).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '\n');
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const inflight = new Map(); // request id -> AbortController, so a cancelled call stops (and a wait collects nothing)
async function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: Array.isArray(msg) ? 'Batches are not supported; send one request per line.' : 'Invalid request' } });
  const { id, method, params } = msg;
  if (method === 'notifications/cancelled') { const c = inflight.get(params && params.requestId); if (c) c.abort(); return; }
  if (id === undefined || method === undefined) return; // a notification, or a reply to something we never ask
  try {
    // The folder's name plus a short fingerprint of its full path: two projects both called "app" are two names.
    if (method === 'initialize' && !AGENT) AGENT = `${(params && params.clientInfo && typeof params.clientInfo.name === 'string' && params.clientInfo.name) || 'assistant'}:${path.basename(process.cwd())}~${require('crypto').createHash('sha1').update(process.cwd()).digest('hex').slice(0, 4)}`;
    if (method === 'initialize' && IN_PROCESS) setImmediate(() => api('GET', '/api/health').catch((e) => console.error('switchboard:', e.message)));
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: VERSIONS.includes(params && params.protocolVersion) ? params.protocolVersion : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: 'switchboard', version: VERSION },
      instructions: 'Switchboard is the person\'s one screen for everything waiting on them. Raise a light instead of stopping to ask; always attach the draft; check get_decisions when you start work and between jobs. If they have not opened the board on this computer yet, call open_board.' } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      if (!params || typeof params.name !== 'string') return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call needs params.name' } });
      const ac = new AbortController(); inflight.set(id, ac);
      try {
        const out = await callTool(params.name, params.arguments && typeof params.arguments === 'object' ? params.arguments : {}, ac.signal);
        if (ac.signal.aborted) return; // cancelled: the client is not listening for this answer
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] } });
      } catch (e) {
        if (ac.signal.aborted) return;
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      } finally { inflight.delete(id); }
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    return send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
}
// Lines end at "\n" only (readline would also split inside a quoted email at U+2028).
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk; let n;
  while ((n = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, n).replace(/\r$/, ''); buf = buf.slice(n + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch (e) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    handle(msg);
  }
});
// The session ended: whatever was waiting stops, so an abandoned wait collects nothing.
process.stdin.on('end', () => { for (const c of inflight.values()) c.abort(); if (here) here.then((b) => b.close(), () => {}); setTimeout(() => process.exit(0), 200).unref(); });
