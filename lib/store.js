'use strict';
// The whole data model. One JSON file, one writer (the server).
// A "light" is a thread that moves between states until its loop is closed.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// approved = the person said yes and no assistant has reported it sent or applied yet.
const STATES = ['need_you', 'approved', 'waiting_them', 'auto', 'broken', 'queued', 'done', 'dropped'];
const RAISE_STATES = ['need_you', 'waiting_them', 'auto', 'broken', 'queued'];
const KINDS = ['approve', 'decide', 'sense', 'todo', 'fix'];
const CHANNELS = ['agent', 'sms', 'copy'];
const OUTCOMES = ['sent', 'done', 'failed', 'unsure'];
const DEFAULT_SECONDS = { approve: 20, decide: 15, sense: 120, todo: 60, fix: 20 };
const COLORS = ['#F5A623', '#4C8DF6', '#B5672D', '#19B3A6', '#7C63E8', '#E0528A', '#4CB05A', '#9AA6B8', '#D9534F', '#5BC0DE', '#C9B458', '#8E6CC9'];
const DAY = 864e5;
const STALE_MS = 2 * DAY;
const PROMOTE_STREAK = 10;
const HOLD_MS = 20000;        // a decision waits this long before agents can pick it up, so it can be undone
const OUT_HOLD_MS = 60000;    // a message to a person waits longer, with "Skip the wait"
const COLLECT_MS = 15 * 60e3; // an approval nobody collects in this time turns red, once an assistant has checked in
const QUIET_MS = DAY;         // no assistant has asked for decisions in this long: approvals wait for one instead
const CLAIM_MS = 10 * 60e3;   // collecting a decision is a claim on it for this long; nobody else is handed it meanwhile
const ARCHIVE_MS = 30 * DAY;  // finished lights older than this leave the main file
const DECISION_CAP = 50;      // most decisions handed out in one call
const ORDER = ['due within a day', 'people waiting on you (most money first)', 'broken jobs that hold something up', 'everything else, oldest first', 'broken background jobs'];
const SPOT_EVERY = 20;        // after the first looks, a random one in this many automatic approvals comes back
const FIRST_LOOKS = 5;        // every one of the first automatic runs comes back for a look
const BRAKE_PER_HOUR = 20;    // more automatic runs than this in an hour pauses the rule and asks
const READ_MS_PER_WORD = 150; // faster than this, a message was approved without being read
const MAX_FOLLOW_UPS = 2;     // after this many, the board asks before chasing again
const FLAG = 'Flag it';
const RAISE_FIELDS = ['area', 'title', 'state', 'kind', 'draft', 'source', 'change_from', 'changeFrom', 'change_to', 'changeTo', 'options', 'recommended', 'link', 'phone', 'channel', 'seconds', 'next', 'outbound', 'due', 'value',
  'follow_up_days', 'followUpDays', 'follow_up_draft', 'followUpDraft', 'action_type', 'actionType', 'batch', 'progress', 'note', 'unsorted', 'demo', 'by', 'agent', 'payload', 'key', 'to', 'attachments', 'expect_by', 'work_minutes', 'holds_up', 'sleep_until', 'changed', 'question'];
const FIXED_AFTER_RAISE = ['phone', 'channel', 'action_type', 'actionType', 'outbound', 'agent', 'key'];

const str = (v, max) => (v == null ? '' : clean(typeof v === 'object' ? JSON.stringify(v) : v).trim().slice(0, max));
const slug = (s) => str(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const int = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return v != null && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : dflt; };
// A bare date ("2026-11-20") means that day where the person is: the end of it for a deadline, the start for a wake-up.
// Anything before 2020 is a mistake ("12/13", or seconds where milliseconds were meant), not a date.
const Y2020 = 1577836800000, Y2100 = 4102444800000;
const time = (v, edge) => {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
    const [y, m, d] = v.trim().split('-').map(Number), x = edge === 'end' ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d);
    if (x.getFullYear() !== y || x.getMonth() !== m - 1 || x.getDate() !== d) return null; // "2026-02-30" is not a day
    return y >= 2020 && x.getTime() < Y2100 ? x.getTime() : null;
  }
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) return null;
  // A date written another way ("11/20/2026", "Nov 20, 2026") with no time of day is that whole day, like "2026-11-20".
  if (typeof v === 'string' && !/\d:\d|T\d/.test(v)) { const x = new Date(t), y = edge === 'end' ? new Date(x.getFullYear(), x.getMonth(), x.getDate(), 23, 59, 59) : new Date(x.getFullYear(), x.getMonth(), x.getDate()); return y.getFullYear() >= 2020 && y.getTime() < Y2100 ? y.getTime() : null; }
  return t > Y2020 && t < Y2100 ? t : null;
};
// Text from outside, made safe to show: no direction overrides or invisible characters that make a name or a message read
// differently on screen from what is stored; line and paragraph separators become plain new lines.
const clean = (v) => String(v).replace(/[\u202A-\u202E\u2066-\u2069\u200B\uFEFF]/g, '').replace(/[\u2028\u2029]/g, '\n');
const newId = () => crypto.randomBytes(4).toString('hex');
const AGENT_OF = (who) => str(who && who.agent, 80); // the same trimming the raise used, so a stray space never hides a decision
// Every name a caller answers to: its own, plus the earlier names a session used before it named a project (agents).
const NAMES_OF = (who) => new Set([AGENT_OF(who)].concat(Array.isArray(who && who.agents) ? who.agents.slice(0, 20).map((x) => str(x, 80)) : []).filter(Boolean));
const ago = (ms) => { const m = Math.round(ms / 60e3); return m < 90 ? `${m} minutes ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
const NAMES_A_DAY = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\btomorrow\b|\btonight\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i;
const VERBS = 'text|call|email|pay|fix|buy|order|send|book|schedule|remind|check|ask|sign|finish|start|pick|get|grab|reply|follow|renew|cancel|return|write|review|submit|print|clean|drop|bring|update|file|message|tell|find|look|set|make|plan';

// A short fingerprint of what the person is approving: the words, who they go to, what is attached, and the assistant's own note.
// An approval must carry it back.
// A recommendation is part of what the person saw (taking every recommendation must take the ones on screen); it is added
// only when there is one, so lights without one keep the fingerprint they always had.
const rev = (l) => crypto.createHash('sha1').update(JSON.stringify([l.title, l.draft, l.changeFrom, l.changeTo, l.options, l.phone, l.to || '', (l.attachments || []).map((a) => [a.name, a.link]), l.payload == null ? null : l.payload].concat(l.recommended ? [l.recommended] : []))).digest('hex');

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const ABBR = /\b(?:Dr|Mr|Mrs|Ms|St|Jr|Sr|vs|etc|Ave|Rd|Inc|Co|approx|appt|Prof|Dept|lbs?|oz|ft|hrs?|mins?|sec|est|[ap]\.m|e\.g|i\.e|[A-Z])\.\s/g;
const CONTACT = /^(?:text|call|email|message|tell|ask|remind|reply|write)\b/i;

// "Order lights, pay the fee and fix the bug" is three things, not one. When unsure, it stays one.
function splitDump(text) {
  if (String(text == null ? '' : text).trim().length > 4000) throw new Error('That is a lot for one note. Split it into a few.');
  const safe = str(text, 4000).replace(ABBR, (m) => m.replace('. ', '.\u0001')); // "Dr. Smith" is not the end of a sentence
  const and = new RegExp(`\\s+and\\s+(?:then\\s+)?(?=(?:${VERBS})\\b)`, 'i');
  const comma = new RegExp(`,\\s*(?:and\\s+)?(?:then\\s+)?(?=(?:${VERBS})\\b)`, 'i');
  const out = [];
  for (const sentence of safe.split(/\n+|;\s*|(?<!\b[A-Z])\.\s+(?=[A-Z])/)) {
    for (const piece of sentence.split(comma)) {
      // "X and <verb> …" splits only when each side is a task on its own. "Email Sam and tell him…" is one thing.
      const parts = piece.split(and).map((p) => p.trim());
      const alone = parts.length > 1 && !CONTACT.test(parts[0]) && parts.every((p) => p.split(/\s+/).length >= 2 && !/^\w+\s+(?:him|her|them|it)\b/i.test(p));
      out.push(...(alone ? parts : [piece]));
    }
  }
  const all = out.map((p) => p.replace(/\u0001/g, ' ').trim().replace(/[.,]$/, '')).filter((p) => p.length > 1).map((p) => p[0].toUpperCase() + p.slice(1));
  return all.length > 30 ? all.slice(0, 29).concat(all.slice(29).join('; ')) : all; // the twelfth light holds the rest, nothing is dropped
}

function open(dir, opts = {}) {
  dir = (dir || process.env.SWITCHBOARD_HOME || path.join(os.homedir(), '.local', 'share', 'switchboard')).replace(/^~(?=$|[\\/])/, os.homedir());
  const file = path.join(dir, 'data.json');
  const eventsFile = path.join(dir, 'events.jsonl');
  const HOLD = opts.holdMs != null ? opts.holdMs : HOLD_MS;
  const OUT_HOLD = opts.holdMs != null ? opts.holdMs : OUT_HOLD_MS;
  const COLLECT = opts.collectMs != null ? opts.collectMs : COLLECT_MS;
  let db, warnings = [], buffer = [], archived = [], truncate = false, logged = null;
  const random = opts.random || Math.random;
  // seen: when an assistant last asked for decisions (checkIn), and when a light first came in through the connector (mcp).
  const blank = () => ({ version: 3, areas: [], lights: [], streaks: {}, auto: {}, declined: {}, timing: {}, settings: {}, recipients: {}, reasons: {}, dismissed: {}, seen: { checkIn: null, mcp: null } });

  const freshId = () => { for (let i = 0; i < 50; i++) { const id = newId(); if (!db.lights.some((l) => l.id === id)) return id; } throw new Error('Could not make a new light id.'); };
  function load() {
    // A data folder another account made (a shared temporary folder, say) could point its files anywhere: refuse it.
    try { const st = fs.statSync(dir); if (process.getuid && st.uid !== process.getuid()) throw new Error(`${dir} belongs to another account. Use a folder of your own (SWITCHBOARD_HOME).`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) {
      if (e.code === 'ENOENT') { let n = 0; try { n = fs.statSync(eventsFile).size; } catch (e2) { /* no log either */ } if (n > 0 && !opts.fresh) throw new Error(`${file} is missing, but its log (events.jsonl) is there, so the board had data. Put data.json back, or move events.jsonl away to start an empty board.`); }
      if (e.code !== 'ENOENT') throw new Error(`Cannot read ${file}: ${e.message}. Fix or move the file; it was not changed. Every change is also in events.jsonl beside it.`); }
    if (raw === null && fs.existsSync(file)) throw new Error(`${file} holds no board (it says null). It was not changed. Move it away to start a fresh board.`);
    if (raw != null && (typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.lights || []) || !Array.isArray(raw.areas || []))) throw new Error(`${file} is not a Switchboard board (no list of lights). It was not changed. Move it away to start a fresh board.`);
    try { for (const f of fs.readdirSync(dir)) if (/^data\.json\.\d+\.tmp$/.test(f)) fs.unlinkSync(path.join(dir, f)); } catch (e) { /* nothing to tidy */ }
    db = Object.assign(blank(), raw || {}); bare();
    db.seen = Object.assign({ checkIn: null, mcp: null }, db.seen && typeof db.seen === 'object' ? db.seen : {});
    for (const k of Object.keys(db.reasons)) db.reasons[k] = (Array.isArray(db.reasons[k]) ? db.reasons[k] : [db.reasons[k]]).filter(Boolean).map((r) => (typeof r === 'string' ? { why: r, at: 0 } : r));
    if (!(db.version >= 3)) { db.streaks = {}; db.auto = {}; db.declined = {}; db.version = 3; } // trust is earned again under the stricter rules
    for (const l of db.lights) { // boards saved before delivery tracking
      if (l.decision && l.decision.id == null) Object.assign(l.decision, { id: newId(), collectedAt: l.decision.pickedUp ? l.decision.at : null, collectedBy: '', outcome: l.decision.pickedUp ? 'done' : null, completedAt: null, detail: '' });
      if (!l.sent) l.sent = []; if (!l.past) l.past = []; if (l.agent == null) l.agent = '';
    }
    return db;
  }
  function save() {
    // Customer names and messages live here: readable by this user only.
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch (e) { /* not ours to change */ }
    // Finished lights go to the archive before they leave the main file, so a crash in between can duplicate one, never lose it.
    if (archived.length) { fs.appendFileSync(path.join(dir, 'archive.jsonl'), archived.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 }); archived = []; }
    let target = file; try { target = fs.realpathSync(file); } catch (e) { /* not there yet */ } // a linked data file stays linked
    const tmp = target + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
    fs.renameSync(tmp, target);
    backup(target);
    // The log is append-only: every change, in order. Nothing in it is ever rewritten.
    if (truncate) { fs.writeFileSync(eventsFile, '', { mode: 0o600 }); truncate = false; }
    if (buffer.length) { fs.appendFileSync(eventsFile, buffer.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 }); if (logged) logged.push(...buffer); buffer = []; }
  }
  // Once a day, the first save copies the data file to backups/data-YYYY-MM-DD.json; the newest 14 days are kept. A damaged
  // or mistaken data file can be put back from there (stop the board, copy one over data.json, start it).
  let backedUp = '';
  function backup(from) {
    const d = new Date(), name = `data-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    if (backedUp === name || opts.sim) return;
    try {
      const b = path.join(dir, 'backups'); fs.mkdirSync(b, { recursive: true, mode: 0o700 });
      const to = path.join(b, name);
      if (!fs.existsSync(to)) fs.writeFileSync(to, fs.readFileSync(from, 'utf8'), { mode: 0o600 });
      backedUp = name;
      const all = fs.readdirSync(b).filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const f of all.slice(0, Math.max(0, all.length - 14))) fs.unlinkSync(path.join(b, f));
    } catch (e) { /* a backup is a nicety: it never stops a save */ }
  }
  // Lookup tables keyed by names people choose must not inherit anything: a container called "Constructor" is just a name.
  function bare() { for (const k of ['streaks', 'auto', 'declined', 'timing', 'settings', 'recipients', 'reasons', 'dismissed']) db[k] = Object.assign(Object.create(null), db[k] || {}); }
  // A call that threw may have changed things on its way to throwing. Put the board back as it was last saved.
  function rollback() { buffer = []; archived = []; if (fs.existsSync(file)) load(); else { db = blank(); bare(); } }
  // The first light that came in through the assistant connector: the board stops offering to connect one.
  function connectorSeen(now = Date.now()) { if (!db.seen.mcp) db.seen.mcp = now; }
  function reset() { db = blank(); bare(); buffer = []; archived = []; logged = []; truncate = true; }
  const areaName = (id) => (db.areas.find((a) => a.id === id) || {}).name || id;
  function log(type, l, extra, now) { buffer.push(Object.assign({ at: now, type, id: l.id, area: areaName(l.area), title: l.title, key: l.key || undefined }, extra)); }
  function events() {
    if (!logged) { let raw = ''; try { raw = fs.readFileSync(eventsFile, 'utf8'); } catch (e) { /* no log yet */ } logged = []; for (const x of raw.split('\n')) { if (!x) continue; try { logged.push(JSON.parse(x)); } catch (e) { /* a damaged line: skip it, keep the rest */ } } }
    return logged.concat(buffer);
  }

  const findArea = (ref) => { const k = str(ref, 60).toLowerCase(); return db.areas.find((a) => a.id === k || a.id === slug(k) || a.name.toLowerCase() === k); };
  function addArea(input, now = Date.now()) {
    if (input.fresh !== false) warnings = [];
    const name = str(input.name, 60);
    if (!name) throw new Error('name is required');
    let a = findArea(name);
    if (!a) {
      let id = slug(name) || 'area';
      while (db.areas.some((x) => x.id === id)) id += '-2';
      a = { id, name, color: COLORS[db.areas.length % COLORS.length], note: '', voice: '', wakeAt: null, demo: false, createdAt: now };
      db.areas.push(a);
      buffer.push({ at: now, type: 'container', id: a.id, area: name });
    }
    if (/^#[0-9a-f]{6}$/i.test(input.color || '')) a.color = input.color; else if (input.color != null && input.color !== '') warnings.push('color must look like #4C8DF6; ignored');
    if (input.note != null) { if (typeof input.note === 'object') warnings.push('note should be text; it was stored as text'); a.note = str(input.note, 200); }
    if (input.voice != null) { a.voice = str(input.voice, 600); if ((a.rules || []).length) warnings.push('the person\'s standing rules for this container are kept apart and still apply: ' + a.rules.join('; ')); }
    if ('wake_at' in input || 'wakeAt' in input) { const raw = input.wake_at ?? input.wakeAt, t = time(raw); if (raw != null && raw !== '' && t == null) warnings.push('wake_at is not a date; the container keeps its old wake date'); else a.wakeAt = t; }
    if (input.demo && a.createdAt === now && !db.lights.some((l) => l.area === a.id && !l.demo)) a.demo = true;
    else if (!input.demo && a.demo && input.fresh !== false) a.demo = false; // the person or an assistant named it: it is real now
    return a;
  }
  const getLight = (id) => { const l = db.lights.find((x) => x.id === id); if (!l) throw new Error(`No light with id ${id}`); return l; };
  function move(l, state, by, now, note) {
    if (l.state === state) return;
    l.history.push({ at: now, from: l.state, to: state, by: by || 'agent', note: note || '' });
    if (l.history.length > 40) l.history.splice(0, l.history.length - 40);
    l.state = state;
    l.goldSince = state === 'need_you' || state === 'broken' ? now : null;
    l.followUpAt = state === 'waiting_them' && l.followUpDays ? now + l.followUpDays * DAY : null;
    if (state !== 'need_you') l.snoozeUntil = null;
    if (state !== 'auto') l.late = false;
  }
  // Trust is granted per container and job type, and only for typed changes: a from and a to, no free text, nobody to send to.
  const ruleKey = (l) => (l.actionType ? l.area + '|' + l.actionType : '');
  const typed = (l) => !!(l.changeFrom || l.changeTo) && !l.draft && !l.outbound && !l.to && !l.phone;
  // What may run by itself is narrower still: never a money amount, and never a removal (a change to nothing).
  const MONEY = /[$€£]\s?\d|\d\s?(?:dollars?|usd|bucks)\b/i;
  const autoable = (l) => typed(l) && !!String(l.changeTo || '').trim() && !MONEY.test(l.changeFrom || '') && !MONEY.test(l.changeTo || '');
  const norm = (t) => str(t, 120).toLowerCase().replace(/\s+/g, ' ');
  function demote(key) { if (db.auto[key] || db.streaks[key]) buffer.push({ at: Date.now(), type: 'demoted', key }); delete db.auto[key]; delete db.streaks[key]; }
  // The board sometimes takes over a light's buttons (failed, not collected, keep chasing, a spot check). It remembers what
  // was there, so the light can be put back exactly, in one place.
  const overlay = (l, kind, options) => { if (!l.board) l.board = { kind: l.kind, options: l.options }; l.kind = kind; l.options = options; };
  const restore = (l) => { if (l.board) { l.kind = l.board.kind; l.options = l.board.options; l.board = null; } };
  function clearOverlays(l) { restore(l); if (l.chase) l.title = baseTitle(l.title); l.failure = ''; l.stuck = false; l.chase = false; l.spot = false; l.unsure = false; l.unreported = false; }
  const envOf = (l) => ({ to: l.to, payload: l.payload, attachments: l.attachments, area: areaName(l.area), kind: l.kind, title: l.title, changeFrom: l.changeFrom, changeTo: l.changeTo });
  const newDecision = (action, by, now, d) => Object.assign({ id: newId(), action, text: '', value: '', edited: false, by, at: now, tookMs: null, collectedAt: null, collectedBy: '', outcome: null, completedAt: null, detail: '' }, d);
  const baseTitle = (t) => t.replace(/^(?:Follow up: |Keep chasing\? |Check on: )/i, '');

  // Fields an assistant may set when raising or updating. Anything odd is reported, never silently dropped.
  function content(l, input, warn, fresh) {
    const has = (k) => input[k] != null;
    if (has('payload') && JSON.stringify(input.payload).length > 4096) throw new Error('payload is limited to 4 KB');
    const text = { title: 200, draft: 4000, source: 2000, next: 200, note: 4000, to: 120, changed: 300, question: 300 };
    if (has('draft') && String(input.draft).trim().length > text.draft) throw new Error(`draft is ${String(input.draft).trim().length} characters; the limit is ${text.draft}. Nothing is cut from a message: send a shorter one.`);
    for (const k of Object.keys(text)) if (has(k) && typeof input[k] === 'object') warn.push(`${k} should be text; it was stored as ${JSON.stringify(input[k]).slice(0, 40)}`);
    for (const k of Object.keys(text)) if (has(k)) { if (String(input[k]).trim().length > text[k]) warn.push(`${k} is longer than ${text[k]} characters and was cut; the person sees only the first ${text[k]}`); l[k] = str(input[k], text[k]); }
    if (has('draft')) l.needsDraft = false;
    if (!fresh && (has('draft') || has('source')) && l.snoozeUntil) { l.snoozeUntil = null; l.snoozes = 0; warn.push('the person had snoozed this; something new on it brings it back now'); }
    // A light with someone to send to is a message to a person, whether or not the assistant remembered to say so.
    if (l.to && !l.outbound) { l.outbound = true; warn.push('this light has a "to", so it is treated as a message to a person (outbound)'); }
    if (has('change_from') || has('changeFrom')) l.changeFrom = str(input.change_from ?? input.changeFrom, 200);
    if (has('change_to') || has('changeTo')) l.changeTo = str(input.change_to ?? input.changeTo, 200);
    if (has('follow_up_draft') || has('followUpDraft')) l.followUpDraft = str(input.follow_up_draft ?? input.followUpDraft, 4000);
    const fud = input.follow_up_days ?? input.followUpDays;
    if (fud != null) { const n = int(fud, fresh ? 1 : 0, 90, null); if (n == null) warn.push('follow_up_days must be a whole number from 1 to 90; ignored'); else l.followUpDays = n; }
    if (has('options')) { if (Array.isArray(input.options)) { if (input.options.length > 6) warn.push('only the first 6 options are kept'); if (input.options.some((o) => String(o == null ? '' : o).trim().length > 40)) warn.push('an option label was cut to 40 characters'); l.options = input.options.map((o) => str(o, 40)).filter(Boolean).slice(0, 6); } else warn.push('options must be a list of short labels; ignored'); }
    if (has('recommended') || has('options')) { // the answer the assistant recommends: one of the buttons, or none
      const r = has('recommended') ? str(input.recommended, 40) : l.recommended || '';
      if (r && !(l.options || []).includes(r)) { if (has('recommended')) warn.push(`recommended must be one of the options (${(l.options || []).join(', ') || 'none set'}); ignored`); l.recommended = ''; } else l.recommended = r;
    }
    if (has('link')) { if (/^https?:\/\//i.test(input.link)) l.link = str(input.link, 500); else if (input.link === '') l.link = ''; else warn.push('link must start with http:// or https://; ignored, the old link is kept'); }
    if (has('seconds')) { const n = int(input.seconds, 1, 28800, null); if (n == null) warn.push('seconds must be 1 to 28800; ignored'); else l.seconds = n; }
    if (has('progress')) { const n = int(input.progress, 0, 100, null); if (n == null) warn.push('progress must be 0 to 100; ignored'); else { l.progress = n; l.late = false; } }
    if (has('batch')) { const n = int(input.batch, 1, 9999, null); if (n == null) warn.push('batch must be 1 to 9999; ignored'); else l.batch = n; }
    if ('due' in input && input.due !== undefined) { const t = time(input.due, 'end'); if (input.due != null && input.due !== '' && t == null) warn.push('due is not a date; ignored'); else l.due = t; }
    if (has('value')) { const v = Number(input.value); if (Number.isFinite(v) && v > 0 && v < 1e9) l.value = Math.round(v); else { warn.push('value must be a positive number of dollars; ignored'); } }
    if (has('work_minutes')) { const n = int(input.work_minutes, 1, 600, null); if (n == null) warn.push('work_minutes must be 1 to 600; ignored'); else l.workMinutes = n; }
    if (has('holds_up')) l.holdsUp = str(Array.isArray(input.holds_up) ? input.holds_up.join(', ') : input.holds_up, 200);
    if (has('expect_by')) { const t = time(input.expect_by, 'end'); if (t == null) warn.push('expect_by is not a date; ignored'); else { l.expectBy = t; l.late = false; } }
    if (has('payload')) l.payload = input.payload;
    if (has('attachments')) {
      if (Array.isArray(input.attachments) && input.attachments.some((a) => a && a.link && !/^https?:\/\//i.test(a.link))) warn.push('an attachment link that does not start with http:// or https:// was left out');
      if (Array.isArray(input.attachments) && input.attachments.length > 6) warn.push('only the first 6 attachments are kept');
      if (Array.isArray(input.attachments)) l.attachments = input.attachments.slice(0, 6).map((a) => ({ name: str(a && a.name, 80), link: /^https?:\/\//i.test((a && a.link) || '') ? str(a.link, 500) : '' })).filter((a) => a.name);
      else warn.push('attachments must be a list of {name, link}; ignored');
    }
    if (l.draft && !l.due && NAMES_A_DAY.test(l.draft) && (has('draft') || fresh)) warn.push('the draft names a day or a date and due is empty; set due if there is a real deadline');
  }

  // Warnings only, never refusals: what would make this light quicker for the person to answer, said at raise time.
  function lint(l, warn, now) {
    if (l.kind === 'decide' && l.options.length >= 2 && !l.recommended) warn.push('this decision has options but no recommended answer; say which one you would pick (recommended) so the person can take it in one tap');
    if ((l.state === 'need_you' || l.state === 'queued') && (l.kind === 'approve' || l.outbound) && !l.draft && !l.changeFrom && !l.changeTo && !l.payload) warn.push('this light asks for approval but has no draft; attach the words or the change to approve');
    if (l.outbound && !l.to && !l.phone) warn.push('this message goes to another person but has no "to"; name the recipient');
    if (l.kind === 'todo' && !l.link) warn.push('this to-do has no link; add the page, order or file where the person does it, and say in the note what you already tried with your own tools');
    if (l.state === 'waiting_them' && l.outbound && !l.followUpDraft) warn.push('this is waiting on someone else but has no follow-up draft; attach follow_up_draft so a chase is ready when they stay quiet');
    if (l.key) {
      const day = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
      const r = history('', 100000).find((x) => x.key === l.key && x.at > now - 14 * DAY && x.at <= now && x.agent === (l.agent || '')); // only the session that asked hears the answer and the reason
      if (r) warn.push(`this key was answered before, on ${day(r.at)}: "${(r.text ? r.what.replace(/^answered: /, '') + ': ' + r.text : r.what.replace(/^answered: /, '')).slice(0, 160)}". If that still stands, you may not need to ask again; if things changed, say what changed in the note.`);
    }
  }

  function raise(input, now = Date.now()) {
    const warn = []; warnings = warn;
    const title = str(input.title, 200);
    if (!title) throw new Error('title is required');
    if (String(input.title).trim().length > 200) warn.push('title is longer than 200 characters and was cut; the person sees only the first 200');
    if (input.state != null && input.state !== '' && !RAISE_STATES.includes(input.state)) throw new Error(`state must be one of ${RAISE_STATES.join(', ')}`);
    if (input.kind != null && input.kind !== '' && !KINDS.includes(input.kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
    if (input.channel != null && input.channel !== '' && !CHANNELS.includes(input.channel)) throw new Error(`channel must be one of ${CHANNELS.join(', ')}`);
    for (const k of Object.keys(input)) if (!RAISE_FIELDS.includes(k)) warn.push(`unknown field "${k}"; ignored`);
    const agent = str(input.agent, 80), rawKey = input.key == null ? '' : typeof input.key === 'object' ? JSON.stringify(input.key) : String(input.key).trim();
    // A long key is kept whole as a fingerprint, so two threads that share their first 120 characters stay two threads.
    const key = rawKey.length > 120 ? 'h:' + crypto.createHash('sha1').update(rawKey).digest('hex') : rawKey;
    // The same key from the same assistant is the same thread: update it, never make a second light.
    if (key) {
      const same = db.lights.find((l) => l.key === key && l.agent === agent && l.state !== 'done' && l.state !== 'dropped');
      const theirs = !same && db.lights.find((l) => l.key === key && l.agent !== agent && l.state !== 'done' && l.state !== 'dropped');
      const finished = !same && !theirs && db.lights.find((l) => l.key === key && l.agent === agent);
      if (finished) warn.push(`the light with this key (${finished.id}) is already finished, so this is a new light`);
      if (theirs) warn.push(`another assistant (${theirs.agent || 'unnamed'}) already has a light for this key (${theirs.id}); this one is separate. If it is the same thread, update that light instead.`);
      if (same) {
        const patch = Object.assign({}, input);
        ['by', 'demo', 'unsorted', 'key', 'agent', 'adopt'].forEach((k) => delete patch[k]);
        // Whatever cannot change this way is said out loud, not dropped. A value that is the same as before is not a change.
        if (patch.area != null) { const a = findArea(patch.area); if (!a || a.id !== same.area) warn.push('area cannot be changed by raising again; ignored. Use update_light to move it.'); delete patch.area; }
        if (patch.phone != null && str(patch.phone, 30).replace(/[^0-9+]/g, '') === same.phone) delete patch.phone;
        if (patch.channel === same.channel) delete patch.channel;
        if ((patch.action_type ?? patch.actionType) != null && slug(patch.action_type ?? patch.actionType) === same.actionType) { delete patch.action_type; delete patch.actionType; }
        if (patch.outbound != null && (patch.outbound === true || patch.outbound === 'true') === same.outbound) delete patch.outbound;
        // A reply or a new draft on a thread that was waiting brings it back in front of the person.
        if (patch.state == null && (same.state === 'waiting_them' || same.state === 'queued') && (patch.draft != null || patch.source != null)) patch.state = 'need_you';
        update(same.id, patch, agent || 'agent', now); warnings = warn.concat(warnings); return same;
      }
    }
    const area = addArea({ name: input.area || 'Inbox', fresh: false }, now);
    const state = input.state || 'need_you';
    const phone = str(input.phone, 30).replace(/[^0-9+]/g, '');
    const l = {
      id: freshId(), area: area.id, title, state,
      kind: input.kind || (state === 'broken' ? 'fix' : 'approve'),
      draft: '', source: '', changeFrom: '', changeTo: '', options: [], recommended: '', link: '', phone,
      channel: input.channel || (phone ? 'sms' : 'agent'), seconds: null, next: '',
      outbound: input.outbound === true || input.outbound === 'true' || !!phone, to: '', attachments: [], payload: null, key, agent,
      due: null, value: null, followUpDays: 0, followUpDraft: '', followUpAt: null, followUps: 0, snoozeUntil: null, snoozes: 0, needsDraft: false,
      actionType: slug(input.action_type ?? input.actionType), batch: 1, progress: null, expectBy: null, late: false, note: '',
      workMinutes: null, holdsUp: '', own: input.by === 'you' || input.by === 'timer',
      board: null, unsure: false, unreported: false,
      unsorted: !!input.unsorted, spot: false, stuck: false, chase: false, failure: '', demo: !!input.demo,
      createdAt: now, updatedAt: now, goldSince: state === 'need_you' || state === 'broken' ? now : null,
      decision: null, undo: null, sent: [], past: [], history: [{ at: now, from: null, to: state, by: str(input.by, 40) || agent || 'agent', note: '' }],
    };
    content(l, Object.assign({}, input, { title }), warn, true);
    if (input.sleep_until != null) { const t = time(input.sleep_until, 'start'); if (t && t > now && t < now + 366 * DAY && state === 'need_you') l.snoozeUntil = t; else warn.push('sleep_until must be a date within the next year, for a light that needs the person; ignored'); }
    if (state === 'waiting_them' && l.followUpDays) l.followUpAt = now + l.followUpDays * DAY;
    if (!input.by && !input.demo) lint(l, warn, now);
    // The same thing raised again with no key (a setup run twice, a retry after a timeout) is the light already open in
    // that container, never a second one: one $1,200 quote must not show as $2,400 in play. Only a light that is still
    // open and has no decision on its way: the same change approved twice is two changes. A light with an action_type is a
    // kind of job that repeats (eight identical fixes are eight, shown as "Approve all 8"), so it is never matched, and nor
    // are the person's own notes: typing the same thing twice is their choice.
    if (!key && !l.actionType && !input.by && !input.demo) {
      const same = rev(l), twin = db.lights.find((x) => x.area === l.area && RAISE_STATES.includes(x.state) && !(x.decision && !x.decision.outcome) && !x.demo && !x.own && rev(x) === same);
      if (twin && twin.agent === agent) { warn.push(`the same light is already open (${twin.id}), so that one was returned and nothing new was raised. Give each item a stable key; to change that light, use update_light.`); return twin; }
      if (twin) warn.push(`another assistant (${twin.agent || 'unnamed'}) has the same light open (${twin.id}); this one is separate. If it is the same thing, update that light instead.`);
    }
    l.rev0 = rev(l);
    // Earned autonomy: a promoted rule skips the queue. The label alone earns nothing: the light must itself be a typed change.
    const rk = ruleKey(l), rule = db.settings.autonomy ? db.auto[rk] : null;
    let brake = false;
    if (rule && !rule.paused && (rule.agent || '') === agent && state === 'need_you' && l.kind === 'approve' && autoable(l)) {
      rule.hour = rule.hour.filter((t) => t > now - 3600e3).concat(now);
      if (rule.hour.length > BRAKE_PER_HOUR) { rule.paused = true; brake = true; } // far more than usual: stop and ask
      else {
        l.ruleKey = rk; rule.runs += 1; rule.recent.push({ title: l.title, at: now }); if (rule.recent.length > 10) rule.recent.shift();
        l.decision = newDecision('approve', 'auto', now, { text: l.changeTo });
        if (rule.runs <= FIRST_LOOKS || random() < 1 / SPOT_EVERY) {
          // Trust, but look: the first few all come back, then one now and then, at random.
          l.spot = true; overlay(l, 'decide', ['Looks right', FLAG]);
          l.note = ('Handled automatically. Does it still look right? ' + l.note).trim().slice(0, 2000);
          l.history.push({ at: now, from: 'need_you', to: 'need_you', by: 'auto', note: 'approved automatically; spot check' });
        } else move(l, 'approved', 'auto', now, 'runs by itself');
        log('decided', l, { decision: l.decision.id, by: 'auto', agent: l.agent || undefined, what: 'approved automatically', text: l.changeTo }, now);
      }
    }
    db.lights.push(l);
    log('raised', l, { state: l.state, kind: l.kind, agent }, now);
    if (brake) { const b = raise({ area: area.name, title: `"${l.actionType.replace(/-/g, ' ')}" ran ${rule.hour.length} times in the last hour. Keep going?`, kind: 'decide', options: ['Keep going', 'Turn it off'], by: 'timer', note: 'That is far more than usual, so it has stopped running by itself until you say.' }, now); b.brake = rk; }
    return l;
  }

  function update(id, patch, by, now = Date.now()) {
    const warn = []; warnings = warn;
    const l = getLight(id), d = l.decision;
    // Who is asking (agents: the other names a session raised lights under), never a field of the light.
    const asker = NAMES_OF(patch); if (patch.agents != null) { patch = Object.assign({}, patch); delete patch.agents; }
    // An assistant closing its own light (close_light): finished work only, never one the person has decided and nobody has settled.
    if (patch.closing != null) {
      const closing = patch.closing === true; patch = Object.assign({}, patch); delete patch.closing;
      if (closing) {
        if (patch.state !== 'done' && patch.state !== 'dropped') throw new Error('A light is closed as done or dropped.');
        if (l.own) throw new Error('This is the person\'s own note; only the person closes it.');
        if (l.agent && !asker.has(l.agent)) throw new Error(`This light belongs to ${l.agent}; only a session with that name can close it.`);
        if (!l.agent && !asker.size) throw new Error('Say who is closing it: send agent with closing.');
        if ((d && !d.outcome) || l.unsure || l.unreported) throw new Error('The person decided this and it has not been settled yet. Collect the decision and report it with complete_decision first; then close the light.');
      }
    }
    // A relay that carries the person's answers to another list may take over a light raised with no name (an import, a
    // set-up), so no other assistant is handed those answers. Never someone else's light, never the person's own note, and
    // never while a decision on it is out: that decision would change hands mid-flight.
    if (patch.adopt != null) {
      if (patch.adopt === true || patch.adopt === 'true') {
        const who = AGENT_OF(patch);
        if (!who) throw new Error('Say who is adopting it: send agent with adopt.');
        if (l.agent && l.agent !== who) throw new Error(`This light belongs to ${l.agent}; only a light raised with no name can be adopted.`);
        if (l.own) throw new Error('This is the person\'s own note; it cannot be adopted.');
        if (!l.agent && ((d && (!d.outcome || d.outcome === 'unsure' || d.outcome === 'failed')) || l.unsure || l.unreported)) throw new Error('The person decided this and it has not been settled yet. Collect it and complete it first, then adopt the light.');
        if (!l.agent && l.key && db.lights.some((x) => x !== l && x.key === l.key && x.agent === who && x.state !== 'done' && x.state !== 'dropped')) throw new Error(`${who} already has an open light for this key; adopting this one would make two.`);
        if (!l.agent) { l.agent = who; l.history.push({ at: now, from: l.state, to: l.state, by: who, note: 'adopted' }); log('adopted', l, { by: who }, now); }
      }
      patch = Object.assign({}, patch); delete patch.adopt;
    }
    if (patch.kind != null && !KINDS.includes(patch.kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
    if (patch.state != null && !STATES.includes(patch.state)) throw new Error(`state must be one of ${STATES.join(', ')}`);
    // The person said yes to specific words, for a specific person, with specific files. Until an assistant has collected
    // that decision, only notes about the work may change; everything that was approved is frozen, and so is the state.
    if (patch.state === 'approved') throw new Error('Only the person can approve. "approved" cannot be set by an update.');
    // After collection it stays frozen until the assistant reports: a new message on the thread must not slip in under an
    // approval that is being sent, and the change that was approved must be the one applied.
    if (d && !d.outcome && d.by !== 'auto' && (!d.collectedAt || d.action === 'approve')) {
      const harmless = ['id', 'by', 'agent', 'reason', 'note', 'changed', 'progress', 'expect_by', 'seconds', 'work_minutes', 'holds_up', 'next', 'unsorted'].concat(d.collectedAt ? ['state'] : []);
      const blocked = Object.keys(patch).filter((k) => patch[k] != null && !harmless.includes(k));
      if (blocked.length) throw new Error(d.collectedAt
        ? `An assistant is acting on the person's approval of this light and has not reported back, so ${blocked.join(', ')} cannot change yet. Report it with complete_decision first; then raise the new message (the same key brings it back to the person).`
        : `The person already approved this and nobody has collected the decision, so ${blocked.join(', ')} cannot change. Collect it with get_decisions and complete it before changing the light.`);
    }
    // New words on a card the board put up (it failed, or it is asking whether to keep chasing) make it a new request.
    // While the person is being asked whether a message went out, the thread waits for their answer.
    const CONTENT = ['title', 'draft', 'source', 'to', 'attachments', 'payload', 'change_from', 'changeFrom', 'change_to', 'changeTo', 'options', 'recommended', 'kind', 'link'];
    const touches = Object.keys(patch).some((k) => patch[k] != null && CONTENT.includes(k));
    if (touches && l.snoozes) l.snoozes = 0; // something new: a fresh start for snoozing
    if (touches && patch.state == null) {
      if (l.unsure) throw new Error('The person is being asked whether the last message went out. Wait for their answer before changing this light, or name state need_you to replace that question.');
      if (l.failure || l.chase) {
        clearOverlays(l); if (d) l.past.push(d); l.decision = null; l.undo = null;
        if (l.state !== 'need_you') move(l, 'need_you', by, now, 'changed after it failed'); else l.goldSince = now;
        warn.push('this light was showing a failure or a "keep chasing?" question; your change replaces it with a new request for the person');
      }
      // The person's own note, turned into something to approve by an assistant, becomes that assistant's to act on.
      if (l.snoozes) l.snoozes = 0;
      if (l.own && by !== 'you') { l.own = false; if (!l.agent) l.agent = str(patch.agent, 80); if (patch.draft && l.kind === 'todo' && patch.kind == null) l.kind = 'approve'; warn.push('this was the person\'s own note; once they approve it, the decision is handed to you'); }
    }
    // Something that ran by itself is frozen the same way until it is reported, and while the person's look at it is open:
    // an assistant may say it broke (or, once nobody is looking, that it is done), and nothing else.
    if (d && d.by === 'auto' && (!d.outcome || l.spot)) {
      const harmless = ['id', 'by', 'agent', 'reason', 'progress', 'expect_by', 'next'];
      const blocked = Object.keys(patch).filter((k) => patch[k] != null && !harmless.includes(k) && !(k === 'state' && (patch.state === 'broken' || (patch.state === 'done' && !l.spot))));
      if (blocked.length) throw new Error(`This one ran by itself and ${l.spot ? 'the person is being asked to look at it' : 'has not been reported yet'}, so ${blocked.join(', ')} cannot change. Report it with complete_decision, or set state to broken if it went wrong.`);
    }
    if (d && d.collectedAt && !d.outcome && patch.agent != null && asker.has(d.collectedBy) && d.claimUntil) d.claimUntil = now + CLAIM_MS; // still working on it
    if (patch.state === 'need_you' || patch.state === 'broken') clearOverlays(l); // back to asking: nothing stale left on the card
    for (const k of Object.keys(patch)) if (!RAISE_FIELDS.includes(k) && k !== 'id' && k !== 'reason' && k !== 'adopt') warn.push(`unknown field "${k}"; ignored`);
    for (const k of FIXED_AFTER_RAISE) if (patch[k] != null && k !== 'agent') warn.push(`${k} cannot be changed after a light is raised; ignored. Raise a new light instead.`);
    const fudWas = l.followUpDays;
    content(l, patch, warn, false);
    if (l.followUpDays !== fudWas && l.state === 'waiting_them' && patch.state == null) {
      const since = (l.history.slice().reverse().find((h) => h.to === 'waiting_them') || {}).at || now;
      l.followUpAt = l.followUpDays ? since + l.followUpDays * DAY : null;
    }
    if (patch.kind) l.kind = patch.kind;
    if (patch.area) { l.area = addArea({ name: patch.area, fresh: false }, now).id; l.unsorted = false; }
    if (patch.unsorted === false) l.unsorted = false;
    if (patch.state != null) {
      // An automatic approval that went wrong loses its autonomy until it earns it back.
      if (patch.state === 'broken' && d && d.by === 'auto' && l.actionType) demote(l.ruleKey || ruleKey(l));
      if (patch.state === 'broken' && !patch.kind && l.kind === 'approve' && !l.draft && !l.changeFrom && !l.changeTo) l.kind = 'fix';
      if (patch.state === 'need_you' && d && d.action === 'redo' && !d.outcome) Object.assign(d, { outcome: 'done', completedAt: now, collectedAt: d.collectedAt || now });
      if (patch.state === 'need_you' || patch.state === 'broken') { if (d) l.past.push(d); l.decision = null; l.undo = null; }
      if (patch.state === 'done' && d && !d.outcome) Object.assign(d, { outcome: 'done', completedAt: now, collectedAt: d.collectedAt || now });
      move(l, patch.state, by, now, str(patch.reason, 200));
    }
    l.updatedAt = now;
    log('updated', l, { by: by || 'agent', state: l.state, fields: Object.keys(patch).filter((k) => k !== 'id') }, now);
    return l;
  }

  // How long a tap of this job type takes: the last ten, per type. Anything over five minutes was an interruption, not a tap.
  // Taps with no stated time feed the estimate for unstated lights. Taps WITH a stated time are kept as pairs
  // (took / stated), and only those pairs correct an assistant's own number.
  const timingOf = (k) => { const t = db.timing[k]; return !t ? null : { took: t.took || (t.avg ? [Math.round(t.avg)] : []), pairs: t.pairs || [] }; };
  function recordTiming(l, tookMs, undo) {
    const s = Number(tookMs) / 1000;
    if (!(s >= 1 && s <= 300) || l.demo) return;
    if (undo) undo.timing = { k: l.actionType || l.kind, was: JSON.stringify(db.timing[l.actionType || l.kind] || null) };
    const k = l.actionType || l.kind, t = (db.timing[k] = timingOf(k) || { took: [], pairs: [] });
    if (l.seconds) { t.pairs.push(Math.round((s / l.seconds) * 100) / 100); if (t.pairs.length > 10) t.pairs.shift(); }
    else { t.took.push(Math.round(s)); if (t.took.length > 10) t.took.shift(); }
  }
  // The hold before an assistant may collect: none for your own to-dos and broken-job answers, longest for messages to people.
  const holdFor = (l, action, wasBroken) => (l.own || l.kind === 'todo' ? 0 : wasBroken ? 5000 : action === 'approve' && l.outbound ? OUT_HOLD : HOLD);
  const pushSent = (l, text, now) => { if (text) l.sent.push({ text, at: now }); if (l.sent.length > 20) l.sent.shift(); };

  // What the person does from the screen.
  function act(id, action, p = {}, now = Date.now()) {
    const l = getLight(id);
    if (action === 'undo') {
      if (l.decision && l.decision.collectedAt && l.decision.by !== 'auto' && !l.decision.outcome && !(l.undo && l.undo.fields && l.undo.fields.decision && l.undo.fields.decision.outcome)) throw new Error('Too late: your assistant already has it.');
      if (!l.undo) throw new Error('Nothing to undo on this one.');
      if (l.undo.created) { db.lights.splice(db.lights.indexOf(l), 1); log('undone', l, { what: 'note removed' }, now); return l; }
      const u = l.undo, was = l.decision;
      Object.assign(l, u.fields, { undo: null, updatedAt: now });
      if (u.rule) { const was = JSON.parse(u.rule.was); if (was) db.auto[u.rule.key] = was; else delete db.auto[u.rule.key]; if (u.rule.streak && u.rule.streak !== 'null') db.streaks[u.rule.key] = JSON.parse(u.rule.streak); }
      if (u.timing) { const t = JSON.parse(u.timing.was); if (t) db.timing[u.timing.k] = t; else delete db.timing[u.timing.k]; }
      if (u.recipient) { if (u.recipient.was) db.recipients[u.recipient.k] = u.recipient.was; else delete db.recipients[u.recipient.k]; }
      // U5: taking back an edited approval keeps the person's words in the box, not the assistant's draft
      if (u.action === 'approve' && was && was.edited && was.text) { l.draft = was.text; l.rev0 = rev(l); }
      if (u.key) {
        const nowSt = JSON.stringify(db.streaks[u.key] || null);
        if (u.after == null || nowSt === u.after) { if (u.streak === 'null') delete db.streaks[u.key]; else db.streaks[u.key] = JSON.parse(u.streak); }
        else if (u.counted && db.streaks[u.key]) db.streaks[u.key].n = Math.max(0, db.streaks[u.key].n - 1); // later taps stand; only this one is removed
      }
      if (u.reason) { const rs = db.reasons[u.reason.area] || [], i = rs.findIndex((r) => r.at === u.reason.at && r.why === u.reason.why); if (i >= 0) rs.splice(i, 1); }
      if (u.sent) l.sent.pop();
      l.history.push({ at: now, from: u.from, to: l.state, by: 'you', note: 'undone' });
      const back = l.decision;
      if (was && (!back || back.id !== was.id)) log('undone', l, { decision: was.id }, now);
      else log('undone', l, { decision: null, what: u.action }, now);
      // A decision that an earlier tap had withdrawn is standing again: the record must say so.
      if (back && (!was || back.id !== was.id)) log('restored', l, { decision: back.id }, now);
      return l;
    }
    // Taking a tap back restores what that tap changed, and nothing else: an assistant's newer draft is not rolled back by undoing a snooze.
    const fields = action === 'snooze' ? { snoozeUntil: l.snoozeUntil, snoozes: l.snoozes } : action === 'move' ? { area: l.area, unsorted: l.unsorted } : { state: l.state, kind: l.kind, decision: l.decision ? Object.assign({}, l.decision) : null, spot: l.spot, board: l.board ? Object.assign({}, l.board) : null, unsure: l.unsure, unreported: l.unreported, followUps: l.followUps, followUpAt: l.followUpAt, followUpDays: l.followUpDays, snoozeUntil: l.snoozeUntil, snoozes: l.snoozes, goldSince: l.goldSince, area: l.area, unsorted: l.unsorted,
      stuck: l.stuck, chase: l.chase, failure: l.failure, options: l.options, title: l.title, needsDraft: l.needsDraft, draft: l.draft, rev0: l.rev0, askedFor: l.askedFor || null };
    const wasBroken = l.state === 'broken';
    const sk = ruleKey(l);
    const undo = { fields, key: sk, streak: JSON.stringify(db.streaks[sk] || null), from: l.state, at: now, action };
    const asking = l.state === 'need_you' || l.state === 'broken';
    // A tap only counts on a light that is still asking. A stale tab or a second device cannot re-issue a decision.
    if (['approve', 'no', 'answer', 'done'].includes(action) && !asking) throw new Error('This one is already handled.');
    if (['answer', 'no', 'done', 'redo'].includes(action) && p.rev != null && p.rev !== rev(l)) throw new Error('This changed. Look again.');
    if (action === 'answer' && l.kind === 'approve') throw new Error('This one needs an approval, not an answer. Look again.');
    const took = Number(p.tookMs) >= 0 && Number(p.tookMs) < 6e5 ? Math.round(Number(p.tookMs)) : null;
    if (action === 'release' || action === 'release_at') {
      const d = l.decision; if (!d || d.collectedAt) throw new Error('Nothing is being held on this one.');
      const until = time(p.until);
      if (action === 'release_at' && !(until > now && until <= now + DAY)) throw new Error('Pick a time within the next day.');
      d.releaseAt = action === 'release' ? now : until; l.updatedAt = now; log('released', l, { decision: d.id, at: d.releaseAt }, now); return l;
    }
    const decide = (d, what) => { l.askedFor = null; l.changed = ''; l.question = ''; if (l.decision) l.past.push(l.decision); l.decision = newDecision(action, 'you', now, Object.assign({ tookMs: took, releaseAt: now + holdFor(l, action, wasBroken), env: envOf(l) }, d)); log('decided', l, { decision: l.decision.id, by: 'you', agent: l.agent || undefined, what, to: l.to || undefined, text: l.decision.text || (action === 'approve' && (l.changeFrom || l.changeTo) ? `${l.changeFrom || '(empty)'} → ${l.changeTo || '(removed)'}` : '') }, now); };
    const value = str(p.value, 40);
    if (action === 'answer' && (l.board || l.brake) && !l.options.includes(value)) throw new Error(`Pick one of the buttons: ${l.options.join(', ')}.`);

    if (action === 'answer' && l.spot && !l.failure && !l.unsure) {
      // The automatic approval already stands; this only records the glance.
      const rk = l.ruleKey || sk;
      if (value === FLAG) { if (db.auto[rk]) undo.rule = { key: rk, was: JSON.stringify(db.auto[rk]) }; demote(rk); Object.assign(l.decision, { spot: 'flagged', spotAt: now, outcome: null, collectedAt: null, claimUntil: null }); }
      else Object.assign(l.decision, { spot: 'ok', spotAt: now });
      log('decided', l, { decision: l.decision.id, by: 'you', agent: l.agent || undefined, what: value === FLAG ? 'flagged' : 'spot check passed', text: '' }, now);
      move(l, value === FLAG || !l.decision.outcome ? 'approved' : 'done', 'you', now, value === FLAG ? 'flagged; back to asking every time' : 'spot check passed');
      l.spot = false;
    } else if (action === 'answer' && l.brake) {
      const rule = db.auto[l.brake];
      undo.rule = { key: l.brake, was: JSON.stringify(rule || null), streak: JSON.stringify(db.streaks[l.brake] || null) };
      if (value === 'Turn it off') demote(l.brake); else if (value === 'Keep going' && rule) { rule.paused = false; rule.hour = []; }
      move(l, 'done', 'you', now, value);
    } else if (action === 'redo') {
      // "Ask for changes": one line of what should change goes back to the assistant, and is kept so a repeat can become a standing rule.
      if (l.kind !== 'approve' || !asking) throw new Error('This one can\'t take a note.');
      const why = str(p.why, 300);
      if (!why) throw new Error('Write a short note first.');
      decide({ text: why }, 'asked for changes: ' + why);
      // Kept on the light so the redraft can be checked against the note: what was asked, and what it said before.
      l.askedFor = { why, at: now, before: l.draft, beforeChange: l.changeTo || '', noAssistant: !!l.demo };
      (db.reasons[l.area] = db.reasons[l.area] || []).push({ why, at: now }); if (db.reasons[l.area].length > 40) db.reasons[l.area].shift();
      undo.reason = { area: l.area, at: now, why };
      if (sk) delete db.streaks[sk];
      move(l, 'queued', 'you', now, 'asked for changes: ' + why);
      if (l.demo) { Object.assign(l.decision, { outcome: 'done', completedAt: now, collectedAt: now }); move(l, 'need_you', 'example', now, 'examples have no assistant'); }
    } else if (action === 'answer' && l.stuck) {
      // Approved, but no assistant came for it.
      l.stuck = false; restore(l);
      if (value === 'Take it back') { l.past.push(l.decision); log('undone', l, { decision: l.decision.id }, now); l.decision = null; move(l, 'need_you', 'you', now, 'taken back'); }
      else { l.decision.watchFrom = now; move(l, 'approved', 'you', now, 'keep waiting'); }
      l.rev0 = rev(l);
    } else if (action === 'answer' && (l.failure || l.unsure)) {
      const old = l.decision; restore(l);
      if (!old) { l.failure = ''; l.unsure = false; move(l, 'need_you', 'you', now, 'nothing to retry'); }
      else if (value === 'Try again' || value === 'It did not go out' || value === 'It was not done') {
        // The SAME decision again, never a fresh approval: a declined change must not come back as a yes, and an answer keeps its value.
        l.past.push(old);
        l.decision = newDecision(old.action, old.by, now, { text: old.text, value: old.value, edited: old.edited, original: old.original, env: old.env, retryOf: old.id, releaseAt: now + holdFor(l, old.action, false), spot: old.spot === 'flagged' ? 'flagged' : undefined, spotAt: old.spot === 'flagged' ? now - HOLD : undefined });
        log('decided', l, { decision: l.decision.id, by: old.by, agent: l.agent || undefined, what: 'retried', text: old.text || '' }, now);
        l.failure = ''; l.unsure = false; l.unreported = false; l.spot = false;
        move(l, old.action === 'approve' ? 'approved' : old.action === 'redo' ? 'queued' : 'done', 'you', now, 'try again');
      } else if (value === 'It went out' || value === 'It went out after all' || value === 'It was done') {
        // The person checked: it did go. Close it as sent; nothing is sent again.
        Object.assign(old, { outcome: old.action === 'approve' && l.outbound ? 'sent' : 'done', completedAt: now, detail: 'the person confirmed it' + (l.outbound ? ' went out' : ' was done') });
        log('completed', l, { decision: old.id, outcome: old.outcome, detail: old.detail }, now);
        l.failure = ''; l.unsure = false; l.unreported = false;
        const to = (old.env && old.env.to) || l.to;
        if (old.action === 'approve') { pushSent(l, old.text, now); undo.sent = true; if (to) { undo.recipient = { k: norm(to), was: db.recipients[norm(to)] || null }; db.recipients[norm(to)] = now; } }
        move(l, old.action === 'approve' && l.followUpDays ? 'waiting_them' : 'done', 'you', now, 'went out after all');
      } else { l.failure = ''; l.unsure = false; move(l, 'done', 'you', now, 'left as failed'); }
      l.rev0 = rev(l);
    } else if (action === 'answer' && l.chase) {
      l.chase = false; restore(l);
      if (value === 'Stop following up') { decide({ action: 'stopped' }, 'stopped following up'); l.followUpDays = 0; move(l, 'done', 'you', now, 'stopped following up'); }
      else { l.kind = 'approve'; l.title = ('Follow up: ' + baseTitle(l.title)).slice(0, 200); if (l.followUpDraft) { l.draft = l.followUpDraft; l.followUpDraft = ''; l.needsDraft = false; } else { l.needsDraft = true; l.draft = ''; } l.followUps = MAX_FOLLOW_UPS; l.goldSince = now; }
      l.rev0 = rev(l);
    } else if (action === 'approve') {
      if (l.kind !== 'approve') throw new Error('This one needs an answer, not an approval.');
      const text = p.text != null ? str(p.text, 4000) : l.draft;
      if (l.needsDraft && !text && l.channel === 'agent') throw new Error('Write the message first.');
      if (l.outbound && !text.trim() && l.channel === 'agent') throw new Error('There is no message to send yet.');
      // Approve exactly what was on screen. Without a rev, only a light no assistant has changed since the board last set it.
      if ((p.rev != null ? p.rev : l.rev0) !== rev(l)) throw new Error('This changed. Look again.');
      const edited = text !== l.draft;
      decide({ text, edited, original: edited ? l.draft : '' }, edited ? 'approved with edits' : 'approved');
      // The streak counts single taps with the change on screen, and remembers which days they fell on. Bulk taps do not count.
      if (sk && edited) delete db.streaks[sk];
      else if (sk && typed(l) && p.rev != null && !p.bulk) { let st = db.streaks[sk]; if (!st || (st.agent || '') !== l.agent) st = db.streaks[sk] = { n: 0, days: [], agent: l.agent }; /* trust is earned by one assistant, not by a label anyone can reuse */ st.n += 1; undo.counted = true; st.samples = (st.samples || []).concat(`${l.changeFrom || '(empty)'} → ${l.changeTo || '(removed)'}`).slice(-3); const day = new Date(now).toDateString(); if (!st.days.includes(day)) st.days.push(day); }
      // Approved faster than it can be read: hold it twice as long, and say so.
      if (l.outbound && l.channel === 'agent' && !l.demo && !edited && took != null && took < text.split(/\s+/).length * READ_MS_PER_WORD) { l.decision.releaseAt += OUT_HOLD; l.decision.fast = true; }
      if (l.outbound && l.to && l.channel !== 'agent') { undo.recipient = { k: norm(l.to), was: db.recipients[norm(l.to)] || null }; db.recipients[norm(l.to)] = now; }
      recordTiming(l, p.tookMs, undo);
      if (l.channel !== 'agent' || l.demo) {
        // The person sent it from their own phone or pasted it themselves (or it is an example): it has gone.
        if (l.outbound) { pushSent(l, text, now); undo.sent = true; }
        // Nothing is left for an assistant to do. It is told once, as a fact, never handed this as work.
        Object.assign(l.decision, { outcome: 'sent', completedAt: now, manual: true });
        move(l, l.outbound && l.followUpDays ? 'waiting_them' : 'done', 'you', now, 'sent by you');
      } else move(l, 'approved', 'you', now, edited ? 'approved with edits' : 'approved'); // not sent yet: an assistant still has to do it
    } else if (action === 'no') {
      decide({}, 'declined');
      if (sk) delete db.streaks[sk];
      move(l, 'done', 'you', now, 'declined');
    } else if (action === 'answer') {
      const text = str(p.text, 4000);
      if (!value && !text) throw new Error('answer needs a value or text');
      decide({ value, text }, 'answered: ' + (value || text.slice(0, 60)));
      recordTiming(l, p.tookMs, undo);
      move(l, 'done', 'you', now, 'answered: ' + (value || text.slice(0, 60)));
    } else if (action === 'done') {
      decide({}, 'done');
      recordTiming(l, p.tookMs, undo);
      move(l, 'done', 'you', now, 'done');
    } else if (action === 'snooze') {
      if (!asking) throw new Error('Only something waiting on you can be snoozed.');
      const until = time(p.until);
      if (l.snoozes >= 2 && !until) throw new Error('Snoozed twice already. Do it, drop it, or give it a date.');
      if (p.until != null && p.until !== '') {
        if (until == null) throw new Error('That is not a date.');
        if (until <= now) throw new Error('Pick a time that has not passed yet.');
        if (until > now + 366 * DAY) throw new Error('Pick a day within the next year.');
      }
      const days = int(p.days, 1, 60, p.days == null || p.days === '' ? 2 : null);
      if (days == null) throw new Error('Snooze for 1 to 60 days, or pick a date.');
      l.snoozeUntil = until || now + days * DAY;
      if (l.due && l.snoozeUntil > l.due - 2 * 3600e3) { l.snoozeUntil = Math.max(now + 60e3, l.due - 2 * 3600e3); undo.capped = true; }
      l.snoozes += 1;
      l.history.push({ at: now, from: l.state, to: l.state, by: 'you', note: 'snoozed' });
      log('snoozed', l, { until: l.snoozeUntil }, now);
    } else if (action === 'wake') {
      if (!l.snoozeUntil) throw new Error('This one is not snoozed.');
      l.snoozeUntil = null; l.history.push({ at: now, from: l.state, to: l.state, by: 'you', note: 'woken early' }); log('woken', l, {}, now);
    } else if (action === 'drop') {
      if (l.decision && l.decision.collectedAt && !l.decision.outcome && l.decision.by !== 'auto') throw new Error('Too late: your assistant already has it. Wait for its report.');
      if (l.brake && db.auto[l.brake]) { undo.rule = { key: l.brake, was: JSON.stringify(db.auto[l.brake]), streak: JSON.stringify(db.streaks[l.brake] || null) }; demote(l.brake); } // dropping "Keep going?" means no, not "ask again never"
      decide({}, 'dropped');
      move(l, 'dropped', 'you', now, 'dropped');
    } else if (action === 'replied') {
      // "They got back to me": the chasing ends and the assistant is told.
      if (l.state !== 'waiting_them' && !(l.state === 'need_you' && (l.followUps || l.chase))) throw new Error('This one is not waiting on anyone.');
      decide({}, 'they replied'); l.chase = false; l.followUpDays = 0;
      move(l, 'done', 'you', now, 'they replied');
    } else if (action === 'stop_followups') {
      if (l.state === 'waiting_them') { l.followUpDays = 0; l.followUpAt = null; l.history.push({ at: now, from: l.state, to: l.state, by: 'you', note: 'stopped following up' }); }
      else if (l.state === 'need_you' && (l.followUps || l.chase)) { decide({ action: 'stopped' }, 'stopped following up'); l.chase = false; l.followUpDays = 0; move(l, 'done', 'you', now, 'stopped following up'); }
      else throw new Error('This one is not waiting on anyone.');
    } else if (action === 'move') {
      l.area = addArea({ name: p.area, fresh: false }, now).id; l.unsorted = false;
      log('moved', l, { to: areaName(l.area) }, now);
    } else throw new Error('That is not something this board can do. Reload the page.');
    if (sk) undo.after = JSON.stringify(db.streaks[sk] || null);
    l.undo = undo;
    l.updatedAt = now;
    return l;
  }

  // The same action on several lights. Messages to people are never sent in bulk.
  function bulk(ids, action, p = {}, now = Date.now()) {
    if (!['approve', 'no', 'done', 'drop', 'snooze', 'undo', 'recommended'].includes(action)) throw new Error(`Cannot do "${action}" in bulk`);
    if ((ids || []).length > 200) throw new Error('At most 200 lights at once.');
    const ls = (ids || []).map(getLight);
    if (action === 'approve' && ls.some((l) => l.outbound)) throw new Error('Messages to people are approved one at a time.');
    // Taking every recommendation: each light is answered with its own recommended button, on its own hold. Only questions
    // with a recommendation the person has seen as it is now; never a message to a person.
    if (action === 'recommended') {
      if (ls.some((l) => l.outbound)) throw new Error('Messages to people are answered one at a time.');
      const without = ls.filter((l) => !l.recommended || !(l.options || []).includes(l.recommended) || l.state !== 'need_you');
      if (without.length) throw new Error(`${without.length === 1 ? 'One of these has' : without.length + ' of these have'} no recommended answer now: answer ${without.length === 1 ? 'it' : 'them'} one at a time.`);
      const revs = p.revs || {};
      for (const l of ls) if ((revs[l.id] != null ? revs[l.id] : l.rev0) !== rev(l)) throw new Error('This changed. Look again.');
      const each = p.tookMs != null && ls.length ? Number(p.tookMs) / ls.length : undefined;
      return ls.map((l) => act(l.id, 'answer', { value: l.recommended, rev: revs[l.id], tookMs: each, bulk: true }, now));
    }
    const revs = p.revs || {};
    if (action === 'approve') for (const l of ls) if ((revs[l.id] != null ? revs[l.id] : l.rev0) !== rev(l)) throw new Error('This changed. Look again.');
    const each = p.tookMs != null && ls.length ? Number(p.tookMs) / ls.length : undefined;
    return ls.map((l) => act(l.id, action, Object.assign({}, p, { tookMs: each, rev: revs[l.id], bulk: true }), now));
  }

  // What an assistant reports after acting on a decision. "sent" is what turns a message blue. A report names the decision
  // it is about: a late report for a decision that was since replaced changes nothing.
  function complete(id, outcome, detail, now = Date.now(), decisionId) {
    if ((outcome === 'failed' || outcome === 'unsure') && !str(detail, 500)) throw new Error('Say what happened in one plain line (detail), so the person knows what to check.');
    if (!OUTCOMES.includes(outcome)) throw new Error('outcome must be sent, done or failed (or unsure, when you cannot tell whether it went out)');
    const l = getLight(id), d = l.decision;
    if (!d && decisionId && (l.past || []).some((x) => x.id === decisionId && x.action === 'redo' && x.outcome === 'done')) { warnings = ['that decision was already closed (a redraft closes its request for changes); nothing was changed']; return l; }
    if (!d) throw new Error('Nothing has been decided on this light.');
    if (decisionId && decisionId !== d.id && (l.past || []).some((x) => x.id === decisionId && x.action === 'redo' && x.outcome === 'done')) { warnings = ['that decision was already closed (a redraft closes its request for changes); nothing was changed']; return l; }
    if (decisionId && decisionId !== d.id) throw new Error('That report is for an earlier decision on this light, which has since been replaced. Nothing was changed.');
    warnings = [];
    const message = d.action === 'approve' && l.outbound;
    if ((l.state === 'done' || l.state === 'dropped') && (d.outcome === 'failed' || d.outcome === 'unsure')) {
      if (outcome === 'sent') { Object.assign(d, { outcome: 'sent', completedAt: now, detail: str(detail, 500) }); if (message || d.action === 'approve') pushSent(l, d.text, now); log('completed', l, { decision: d.id, outcome, detail: d.detail }, now); }
      else warnings.push('the person already closed this one; nothing was changed');
      return l;
    }
    if (message && outcome === 'done') throw new Error('This is a message to a person. Report "sent" if it went out, "failed" if it did not, or "unsure" if you cannot tell.');
    if (d.outcome && d.outcome !== 'failed' && d.outcome !== 'unsure') {
      // A repeat changes nothing, and says so. One exception: a failure found out later ("it bounced") always wins.
      if (outcome !== 'failed' || d.manual) { if (outcome !== d.outcome) warnings.push(`already reported as ${d.outcome}${d.manual ? ' (the person sent it themselves)' : ''}; nothing was changed`); return l; }
      const last = l.sent[l.sent.length - 1]; if (last && last.text === d.text) l.sent.pop();
    }
    if (d.by !== 'auto' && !d.collectedAt && now < (d.releaseAt != null ? d.releaseAt : d.at)) throw new Error('That decision has not been released yet. The person can still take it back; wait for get_decisions to hand it to you.');
    Object.assign(d, { outcome, completedAt: now, detail: str(detail, 500), collectedAt: d.collectedAt || now });
    l.undo = null; l.stuck = false; l.unreported = false;
    if (outcome === 'failed' && d.by === 'auto' && (l.ruleKey || ruleKey(l))) demote(l.ruleKey || ruleKey(l));
    if (outcome === 'failed' || outcome === 'unsure') {
      restore(l);
      if (outcome === 'unsure') { l.unsure = true; l.failure = ''; overlay(l, 'decide', ['It went out', 'It did not go out']); }
      else { l.unsure = false; l.failure = d.detail || 'no reason was given'; overlay(l, 'fix', d.action === 'approve' && l.outbound ? ['Try again', 'It went out after all', 'Leave it'] : ['Try again', 'Leave it']); }
      move(l, 'broken', 'agent', now, outcome + (d.detail ? ': ' + d.detail : ''));
      l.goldSince = now; l.rev0 = rev(l);
    } else if (l.state === 'approved' || l.state === 'broken') {
      l.failure = ''; l.unsure = false; restore(l);
      const went = d.action === 'approve' && (l.outbound || outcome === 'sent'), to = (d.env && d.env.to) || l.to;
      if (went) { pushSent(l, d.text, now); if (to) db.recipients[norm(to)] = now; }
      move(l, went && l.followUpDays ? 'waiting_them' : 'done', 'agent', now, outcome); // the follow-up clock starts here, at delivery
    }
    l.updatedAt = now;
    log('completed', l, { decision: d.id, outcome, detail: d.detail }, now);
    return l;
  }
  // The older, simpler report: "handled".
  function ack(ids, now = Date.now(), who = {}) {
    let n = 0; const skipped = [], unseen = [];
    for (const id of ids || []) { const l = db.lights.find((x) => x.id === id); if (l && l.decision && !l.decision.outcome) {
      if (!l.decision.collectedAt || (who.agent != null && l.decision.collectedBy && !NAMES_OF(who).has(l.decision.collectedBy))) { unseen.push(id); continue; }
      // "Handled" is not enough for a message to a person: that needs sent, failed or unsure.
      if (l.decision.action === 'approve' && l.outbound) { skipped.push(id); continue; }
      complete(id, 'done', '', now); n++; } }
    warnings = [].concat(skipped.length ? [`not acknowledged (messages to people need complete_decision with sent, failed or unsure): ${skipped.join(', ')}`] : [], unseen.length ? [`not acknowledged (you were never handed these decisions; collect them with get_decisions first): ${unseen.join(', ')}`] : []);
    return n;
  }

  // A board no assistant has asked for decisions in a day (Claude Desktop between chats, say): an approval nobody has
  // collected is waiting for one to check in, which is not a fault, so it does not turn red. Once one has checked in,
  // an approval it leaves for 15 minutes does.
  const unvisited = (now) => db.seen.checkIn == null || now - db.seen.checkIn > QUIET_MS;
  const overdue = (l, now) => { const d = l.decision; return l.state === 'approved' && !!d && !d.collectedAt && !l.demo && now - (d.watchFrom || d.releaseAt || d.at) > COLLECT; };
  // Who has to check in for a light. A chat session can collect a light raised with no name, or by a chat assistant (a
  // Claude Desktop chat, or a client:folder session); a light a program raised under its own name (a relay, a script)
  // waits for that program, and a chat would collect nothing.
  const waitingFor = (l) => {
    if (!l.agent) return 'Waiting for an assistant to check in. Start a chat and say \u201ccheck my Switchboard\u201d.';
    return /^claude-desktop(?::|$)/.test(l.agent) || l.agent.includes(':') ? `Waiting for ${l.agent} to check in. Start a chat and say \u201ccheck my Switchboard\u201d.` : `Waiting for ${l.agent} to check in. Only it can collect this one.`;
  };
  // Time passing: quiet threads come back, uncollected approvals go red, snoozes end, sleeping areas wake.
  function tick(now = Date.now()) {
    let changed = false;
    for (const l of db.lights) {
      const d = l.decision;
      if (overdue(l, now) && !unvisited(now)) {
        // Nothing is erased: the title, the text and the decision all stay. Only the colour changes.
        l.stuck = true; overlay(l, 'fix', ['Keep waiting', 'Take it back']);
        move(l, 'broken', 'timer', now, 'approved but not collected by any assistant');
        l.rev0 = rev(l); l.updatedAt = now; changed = true;
      }
      if (l.state === 'waiting_them' && l.followUpAt && l.followUpAt <= now) {
        move(l, 'need_you', 'timer', now, 'no reply; follow-up due');
        if (d) { l.past.push(d); l.decision = null; } l.undo = null;
        l.followUps = (l.followUps || 0) + 1;
        const base = baseTitle(l.title);
        if (l.followUps > MAX_FOLLOW_UPS) {
          l.chase = true; overlay(l, 'decide', ['One more follow-up', 'Stop following up']); l.title = ('Keep chasing? ' + base).slice(0, 200);
          l.draft = ''; l.needsDraft = false;
        } else if (!l.outbound) {
          l.kind = 'todo'; l.title = ('Check on: ' + base).slice(0, 200); l.needsDraft = false;
        } else {
          l.kind = 'approve'; l.title = ('Follow up: ' + base).slice(0, 200);
          if (l.followUpDraft) { l.draft = l.followUpDraft; l.followUpDraft = ''; l.needsDraft = false; }
          else { l.draft = ''; l.needsDraft = true; } // what was sent before is kept in l.sent
        }
        l.rev0 = rev(l);
        l.updatedAt = now; changed = true;
        log('came back', l, { followUps: l.followUps }, now);
      }
      // Collected, then silence: the assistant may have sent it and died, or never sent it. Say so; do not guess.
      if (d && d.collectedAt && !d.outcome && d.claimUntil && now > d.claimUntil && !l.unreported && !l.demo && l.state === 'approved') {
        // Ask the person, the same way as an assistant's "not sure": nothing is sent again until they say.
        l.unreported = true; l.unsure = true; overlay(l, 'decide', d.action === 'approve' && l.outbound ? ['It went out', 'It did not go out'] : ['It was done', 'It was not done']);
        move(l, 'broken', 'timer', now, 'collected and never reported'); l.rev0 = rev(l); l.updatedAt = now; changed = true;
      }
      if (l.snoozeUntil && l.snoozeUntil <= now) { l.snoozeUntil = null; changed = true; } // its age is kept: a snooze must not make an old light look new
      if (l.state === 'auto' && l.expectBy && l.expectBy < now && !l.late) { l.late = true; changed = true; }
    }
    // Finished long ago: out of the main file, into the archive. The log keeps the history.
    const old = db.lights.filter((l) => (l.state === 'done' || l.state === 'dropped') && now - l.updatedAt > ARCHIVE_MS && !(l.decision && l.decision.manual && !l.decision.toldAt && l.agent && now - l.updatedAt < 3 * ARCHIVE_MS) && (l.own || !l.decision || l.decision.outcome || now - l.updatedAt > 3 * ARCHIVE_MS));
    if (old.length) { const gone = new Set(old); for (const x of old) archived.push(x); db.lights = db.lights.filter((l) => !gone.has(l)); changed = true; }
    for (const a of db.areas) {
      if (a.wakeAt && a.wakeAt <= now) {
        a.wakeAt = null; changed = true;
        raise({ area: a.name, title: `${a.name} is back. What is next for it?`, kind: 'todo', by: 'timer', demo: a.demo, note: 'Type the next thing in the bar at the top, or ask your assistant to add it. Then tap Done.' }, now);
      }
    }
    return changed;
  }

  // The tap, in seconds. An assistant's own number is corrected by how long this job type really takes. null = not timed yet.
  const estimate = (l) => {
    const t = timingOf(l.actionType || l.kind);
    if (l.seconds) return t && t.pairs.length >= 3 ? Math.max(1, Math.round(l.seconds * Math.min(20, Math.max(0.5, median(t.pairs))))) : l.seconds;
    return t && t.took.length ? Math.max(1, median(t.took)) : null;
  };
  // Order of the queue, by meaning (the ORDER list says it in words): 0 due within a day, 1 a person waiting on you,
  // 2 a broken job that holds something up, 3 everything else by age, 4 broken background jobs.
  const tier = (l, now) => (l.due && l.due <= now + DAY ? 0 : l.state === 'need_you' && l.outbound ? 1 : l.state === 'broken' ? (l.holdsUp || l.outbound ? 2 : 4) : 3);

  // Everything the screen needs, computed in one place.
  function view(now = Date.now()) {
    const live = db.lights.filter((l) => l.state !== 'done' && l.state !== 'dropped');
    const out = (l) => {
      const e = estimate(l), t = tier(l, now), est = e || DEFAULT_SECONDS[l.kind] || 30, waitingCheckIn = overdue(l, now) && unvisited(now);
      const o = Object.assign({}, l, { firstTime: l.state === 'need_you' && l.outbound && !!l.to && !l.source && !db.recipients[norm(l.to)], noRecipient: l.state === 'need_you' && l.outbound && l.channel === 'agent' && !l.to && !l.phone, rev: rev(l), est, unsized: e == null && !l.workMinutes, chore: !!l.workMinutes || (l.seconds || 0) > 900, tier: t, keep: t === 0 || t === 2, stale: !!l.goldSince && now - l.goldSince > STALE_MS && !l.stuck, snoozed: !!l.snoozeUntil && l.snoozeUntil > now,
        waitingCheckIn, alert: waitingCheckIn ? waitingFor(l) : l.unreported && l.decision ? `Collected ${ago(now - l.decision.collectedAt)} by ${l.decision.collectedBy || 'an assistant'} and never reported. Did it ${l.outbound ? 'go out' : 'happen'}?` : l.unsure ? `Your assistant is not sure this went out${l.decision && l.decision.detail ? ' (' + l.decision.detail + ')' : ''}. Check before anything is sent again.` : l.stuck && l.decision ? `Approved ${ago(now - l.decision.at)}. No assistant has collected it.` : l.failure ? `It did not go through: ${l.failure}` : '',
        redraftWaiting: l.state === 'queued' && !!l.decision && l.decision.action === 'redo' && !l.decision.outcome, canTakeBack: !!(l.undo && l.decision && !l.decision.collectedAt && l.decision.by === 'you' && !l.decision.outcome), approvedText: l.decision && (l.state === 'approved' || l.stuck || l.failure || l.unsure) ? l.decision.text : '', lastSent: l.sent.length ? l.sent[l.sent.length - 1] : null });
      delete o.history; delete o.undo; delete o.past; delete o.payload; delete o.sent; delete o.decision;
      return o;
    };
    const lights = live.map(out);
    const asleep = new Set(db.areas.filter((a) => a.wakeAt && a.wakeAt > now).map((a) => a.id));
    const queue = lights.filter((l) => (l.state === 'need_you' || l.state === 'broken') && !asleep.has(l.area) && (!l.snoozed || (l.due && l.due <= now + DAY))).sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier === 0) return a.due - b.due;
      if (a.tier === 1 && (a.value || 0) !== (b.value || 0)) return (b.value || 0) - (a.value || 0); // money orders people, never outranks them
      return a.goldSince - b.goldSince;
    });
    const taps = queue.filter((l) => !l.chore && !l.unsized), chores = queue.filter((l) => l.chore);
    const hours = new Date(now).getHours() * 60 + new Date(now).getMinutes(), quiet = hours < 450 || hours >= 1110; // outside 7:30 am to 6:30 pm
    const morning = new Date(now); if (hours >= 465) morning.setDate(morning.getDate() + 1); morning.setHours(7, 45, 0, 0);
    const count = (s) => lights.filter((l) => l.state === s && !l.snoozed).length; // rows, everywhere; a batch shows its size on its own row
    const upcoming = lights.map((l) => (l.state === 'waiting_them' ? l.followUpAt : l.snoozed ? l.snoozeUntil : null)).filter(Boolean).sort((a, b) => a - b);
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const cleared = db.lights.filter((l) => l.decision && l.decision.by === 'you' && l.decision.action !== 'redo' && l.decision.at >= today.getTime());
    const named = (key) => { const i = key.indexOf('|'); return { key, area: areaName(key.slice(0, i)), type: key.slice(i + 1) }; };
    const eligible = (key) => { const st = db.streaks[key]; return !!st && st.n >= PROMOTE_STREAK && st.days.length >= 3 && !db.auto[key]; };
    // The offer exists only when the person has switched autonomy on. Streaks are counted either way.
    const promote = db.settings.autonomy ? Object.keys(db.streaks).filter((k) => eligible(k) && !db.declined[k]).map((k) => Object.assign(named(k), { streak: db.streaks[k].n, samples: db.streaks[k].samples || [] })) : [];
    const autonomy = { enabled: !!db.settings.autonomy, declined: Object.keys(db.declined).filter((k) => !db.auto[k]).map((k) => Object.assign(named(k), { streak: (db.streaks[k] || {}).n || 0 })), rules: Object.keys(db.auto).map((k) => Object.assign(named(k), { since: db.auto[k].since, runs: db.auto[k].runs, paused: !!db.auto[k].paused, recent: db.auto[k].recent.slice().reverse() })),
      earning: Object.keys(db.streaks).filter((k) => !db.auto[k]).map((k) => Object.assign(named(k), { streak: db.streaks[k].n, days: db.streaks[k].days.length })) };
    // A reason given twice in one container is offered as a standing rule for its drafts.
    const suggest = [];
    for (const a of db.areas) { const seen = Object.create(null); for (const r of db.reasons[a.id] || []) { const k = r.why.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); (seen[k] = seen[k] || []).push(r.why); }
      for (const k of Object.keys(seen)) if (seen[k].length >= 2 && !db.dismissed[a.id + '|' + k] && !(a.rules || []).some((r) => r.toLowerCase() === seen[k][0].toLowerCase()) && !(a.voice || '').toLowerCase().includes(seen[k][0].toLowerCase())) suggest.push({ area: a.id, name: a.name, why: seen[k][0], times: seen[k].length }); }
    // Everything still inside its undo window, newest first. Built here so a reload keeps it.
    const said = { approve: 'Approved', no: 'Declined', answer: 'Answered', done: 'Done', drop: 'Dropped', snooze: 'Snoozed', move: 'Moved', note: 'Filed', replied: 'They replied', stop_followups: 'Stopped following up', redo: 'Asked for changes' };
    // "until" is when an assistant may take it. It stays listed at least a short while so a slip can always be taken back.
    const heldUntil = (l) => (l.decision && l.decision.releaseAt != null && l.undo.action !== 'snooze' && l.undo.action !== 'move' && l.undo.action !== 'note' ? l.decision.releaseAt : l.undo.at + HOLD);
    const held = db.lights.filter((l) => l.undo && now < Math.max(heldUntil(l), l.undo.at + HOLD) && !(l.decision && l.decision.collectedAt && l.decision.by !== 'auto' && !l.decision.outcome))
      .sort((a, b) => b.undo.at - a.undo.at).map((l) => { const until = heldUntil(l), msg = l.undo.action === 'approve' && l.outbound && l.channel === 'agent';
        return { id: l.id, title: l.title, area: l.area, what: said[l.undo.action] || 'Changed', until, fast: !!(l.decision && l.decision.fast), release: msg && until > now, quiet: msg && quiet, morning: msg && quiet ? morning.getTime() : null }; });
    return {
      now, areas: db.areas.map((a) => Object.assign({}, a, { recentNotes: Array.from(new Set((db.reasons[a.id] || []).slice().reverse().map((r) => r.why))).slice(0, 4) })), lights, queue: queue.map((l) => l.id), held, order: ORDER,
      counts: { need_you: count('need_you'), broken: count('broken'), approved: count('approved'), waiting_them: count('waiting_them'), auto: lights.filter((l) => l.state === 'auto' && !l.late).length, queued: count('queued'), late: lights.filter((l) => l.late).length,
        snoozed: lights.filter((l) => l.snoozed && (l.state === 'need_you' || l.state === 'broken')).length, unreported: lights.filter((l) => l.unreported).length,
        uncollected: db.lights.filter((l) => l.decision && l.decision.by === 'you' && !l.decision.collectedAt && !l.decision.outcome && !l.own && !l.demo && (l.state === 'done' || l.state === 'queued') && now - (l.decision.releaseAt || l.decision.at) > COLLECT).length },
      // The headline counts taps. Work away from the board and lights nobody has timed yet are counted apart, never guessed in.
      seconds: taps.reduce((n, l) => n + l.est, 0), chores: { count: chores.length, minutes: chores.reduce((n, l) => n + (l.workMinutes || Math.round(l.est / 60)), 0) },
      unsized: queue.filter((l) => l.unsized && !l.chore).length, nextLightAt: upcoming[0] || null,
      clearedToday: cleared.length, spentToday: Math.round(cleared.reduce((n, l) => n + (l.decision.tookMs || 0), 0) / 1000),
      promote, autonomy, suggest, auto: Object.keys(db.auto), holdMs: HOLD, lastCheckIn: db.seen.checkIn, connected: !!db.seen.mcp,
      hasDemo: db.lights.some((l) => l.demo) || db.areas.some((a) => a.demo),
    };
  }

  // Hand one decision to an assistant. The first hand-over collects it, and every hand-over is a claim: nobody else is
  // handed it until the claim lapses. What comes back is what the person approved, frozen at the tap, not the light as it is now.
  function hand(l, now, who) {
    const d = l.decision, before = !!d.collectedAt, e = d.env || {};
    // Collected under the light's own name when that is one of the caller's, so its report and its claim match later.
    if (!before) { d.collectedAt = now; d.collectedBy = l.agent && NAMES_OF(who).has(l.agent) ? l.agent : AGENT_OF(who); l.undo = null; log('collected', l, { decision: d.id, by: d.collectedBy }, now); }
    d.claimUntil = now + CLAIM_MS;
    if (l.stuck && l.state === 'broken' && d.action === 'approve') { l.stuck = false; restore(l); move(l, 'approved', 'agent', now, 'collected'); }
    return { id: l.id, area: e.area || areaName(l.area), title: e.title || l.title, kind: e.kind || l.kind, action_type: l.actionType, note: l.note,
      decision_id: d.id, collected_before: before, needs_check: before || undefined, retry_of: d.retryOf || undefined, action: d.action, value: d.value, text: d.text, edited: d.edited,
      original_draft: d.original || (d.action === 'redo' && l.askedFor ? l.askedFor.before : '') || '', draft_now: d.action === 'redo' ? l.draft : undefined, source: d.action === 'redo' ? (l.source || undefined) : undefined, decided_by: d.by, decided_at: new Date(d.at).toISOString(), state_now: l.state,
      to: (d.env ? e.to : l.to) || undefined, key: l.key || undefined, payload: (d.env ? e.payload : l.payload) == null ? undefined : (d.env ? e.payload : l.payload),
      attachments: (d.env ? e.attachments : l.attachments) || [], flagged: d.spot === 'flagged' || undefined,
      change_from: (d.env && e.changeFrom != null ? e.changeFrom : l.changeFrom) || undefined, change_to: (d.env && e.changeTo != null ? e.changeTo : l.changeTo) || undefined };
  }
  const releaseOf = (d) => (d.spotAt ? d.spotAt + HOLD : d.releaseAt != null ? d.releaseAt : d.at + HOLD); // when an assistant may take it
  const released = (d, now) => d.by === 'auto' || now >= releaseOf(d);
  const claimed = (d, now) => !!d.claimUntil && now < d.claimUntil;

  // What assistants pick up: the person's answers, follow-ups that need a draft, and unsorted notes.
  // needs_check on a decision means it was collected before and never reported: find out whether it went out before sending.
  // When each assistant name last asked (for decisions, or for a count at the start of a session). A light whose owner
  // has not asked since its decision became collectable may belong to a session that has ended.
  const sawAgent = (who, now) => { const m = db.seen.agents || (db.seen.agents = {}); for (const n of NAMES_OF(who)) m[n] = now; };
  function decisions(now = Date.now(), who = {}) {
    db.seen.checkIn = now; // an assistant is around: an approval it leaves turns red after 15 minutes
    sawAgent(who, now);
    // A light raised with no name belongs to whoever comes for it first.
    // only: this assistant's own lights, never ones raised with no name (a relay must not take another session's work).
    const me = AGENT_OF(who), names = NAMES_OF(who), mine = (l) => (who.only ? !!me && l.agent === me : who.all || !l.agent || names.has(l.agent));
    const brief = (l) => ({ id: l.id, area: areaName(l.area), title: l.title, kind: l.kind, action_type: l.actionType, note: l.note });
    // Never the person's own notes and to-dos: no assistant raised them, so no assistant should act on them.
    const own = (l) => l.own; // made by the person (the bar) or by the board's own timer
    const ready = (l) => l.decision && !l.decision.outcome && !l.demo && !own(l) && mine(l) && !l.unsure && !l.unreported && released(l.decision, now) && !claimed(l.decision, now);
    // Orphans, for a relay that asks for them (who.orphans: how long to wait, in ms): a decision on another assistant's
    // light that its owner has never collected and has not asked for since it became collectable, after that wait. Never a
    // message to a person (only a session that can send it may take that), never a light with no name (anyone can take
    // that already), never the person's own.
    const wait = Number(who.orphans) > 0 ? Number(who.orphans) : 0, seenAt = db.seen.agents || {};
    const orphan = (l) => !!wait && !!l.agent && !names.has(l.agent) && !l.outbound && !!l.decision && !l.decision.outcome && !l.decision.collectedAt
      && !l.demo && !own(l) && !l.unsure && !l.unreported && released(l.decision, now) && !claimed(l.decision, now)
      && now - releaseOf(l.decision) >= wait && !(seenAt[l.agent] >= releaseOf(l.decision));
    const orphans = new Set(wait ? db.lights.filter((l) => !ready(l) && orphan(l)).map((l) => l.id) : []);
    const all = db.lights.filter((l) => ready(l) || orphans.has(l.id));
    // Things the person sent themselves ("I sent it"): told once, as facts. Never work to do.
    const told = [];
    for (const l of db.lights) {
      if (l.demo || !mine(l)) continue;
      for (const d of [l.decision].concat(l.past || [])) if (d && d.manual && !d.toldAt && d.outcome === 'sent' && now >= d.at + HOLD) { d.toldAt = now; told.push({ l, d }); }
    }
    // What the caller cannot have yet, said instead of an empty list that reads as "nothing was decided": its own answers
    // still in the person's undo window, and answers ready for other sessions (counted, never handed over).
    let held = 0, next = null, others = 0;
    for (const l of db.lights) {
      const d = l.decision;
      if (!d || d.outcome || l.demo || own(l) || l.unsure || l.unreported) continue;
      if (mine(l)) { if (!released(d, now)) { held++; next = next == null ? releaseOf(d) : Math.min(next, releaseOf(d)); } }
      else if (released(d, now) && !claimed(d, now)) others++;
    }
    return Object.assign({
      decisions: all.slice(0, DECISION_CAP).map((l) => (orphans.has(l.id) ? Object.assign(hand(l, now, who), { orphan: true, raised_by: l.agent }) : hand(l, now, who))), more: Math.max(0, all.length - DECISION_CAP),
      sent_by_you: told.map(({ l, d }) => Object.assign(brief(l), { text: d.text, to: (d.env && d.env.to) || undefined, sent_at: new Date(d.at).toISOString() })),
      need_drafts: db.lights.filter((l) => l.needsDraft && l.state === 'need_you' && !l.demo && mine(l)).map((l) => Object.assign(brief(l), { sent_before: l.sent.map((s) => s.text) })),
      unsorted: db.lights.filter((l) => l.unsorted && l.state === 'need_you' && !l.demo).map(brief),
    }, held ? { held, next_release_at: new Date(next).toISOString() } : {}, others ? { ready_for_other_sessions: others } : {});
  }
  // Why this assistant may not collect a light's decision, or '' when it may. Waiting collects, so it follows the same rule
  // as get_decisions: only the assistant that raised the light (or one told to take over), or anyone for a light with no name.
  function notYours(id, who = {}) {
    const l = getLight(id);
    // The name itself is not handed back: it would tell any caller exactly what to call itself.
    return l.agent && !who.all && !NAMES_OF(who).has(l.agent) ? 'raised by another session, or under a project this call does not name; only a session with that light\'s name can collect it' : '';
  }
  // One light's decision, for an assistant that is waiting on it. Collects that one only.
  function decisionFor(id, now = Date.now(), who = {}) {
    const l = getLight(id), d = l.decision;
    db.seen.checkIn = now; sawAgent(who, now);
    if (notYours(id, who)) return null;
    if (d && d.manual && d.outcome === 'sent' && now >= d.at + HOLD) { d.toldAt = d.toldAt || now; return { id: l.id, decision_id: d.id, sent_by_you: true, text: d.text, to: (d.env && d.env.to) || undefined, state_now: l.state }; }
    if (!d || d.outcome || l.demo || l.own || l.unsure || l.unreported || !released(d, now) || claimed(d, now)) return null;
    return hand(l, now, who);
  }

  // What is waiting for one assistant, counted, collecting nothing: a relay can look as often as it likes and start work
  // only when there is some. Counts only, never the content: reading the content is what collecting is for.
  function pending(now = Date.now(), who = {}) {
    sawAgent(who, now); // a session starting up asks for its count: it is alive, so its answers are not orphans
    const me = AGENT_OF(who), mine = (l) => (who.only ? !!me && l.agent === me : !l.agent || l.agent === me);
    let decisions = 0, held = 0, unreported = 0, told = 0, next = null;
    for (const l of db.lights) {
      if (l.demo || !mine(l)) continue;
      const d = l.decision;
      if (d && !d.outcome && !l.own && !l.unsure && !l.unreported) {
        if (!released(d, now)) { held++; const at = releaseOf(d); next = next == null ? at : Math.min(next, at); }
        else if (claimed(d, now)) unreported++;
        else decisions++;
      }
      for (const x of [d].concat(l.past || [])) if (x && x.manual && !x.toldAt && x.outcome === 'sent' && now >= x.at + HOLD) told++;
    }
    return { now, decisions, held, unreported, sent_by_you: told, next_release_at: next };
  }

  // Brain dump: file it somewhere sensible now; an agent can refine it later.
  function dump(text, now = Date.now()) {
    const parts = splitDump(text);
    if (!parts.length) throw new Error('Type something first.');
    return parts.map((t) => {
      // Whole words only: "tonight" is not "Night classes", "administer" is not "House admin".
      const stem = (w) => (w.endsWith('ss') ? w : w.replace(/(?:es|s)$/, ''));
      const said = t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).map(stem);
      const hit = db.areas.find((a) => a.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length > 3 && said.includes(stem(w))));
      const l = raise({ area: hit ? hit.name : 'Inbox', title: t.slice(0, 200), note: t.length > 200 ? t : '', kind: 'todo', by: 'you', unsorted: true }, now);
      l.undo = { created: true, at: now, action: 'note' };
      return l;
    });
  }

  // "I have N minutes": what is due today or holding something up goes in first, if it fits. The rest fill the gap in
  // order, and no single one of those may take more than half of it.
  function fit(minutes, now = Date.now()) {
    const v = view(now), byId = new Map(v.lights.map((l) => [l.id, l])), q = v.queue.map((id) => byId.get(id));
    const size = (l) => (l.workMinutes ? l.workMinutes * 60 : l.est), total = Math.max(1, Math.round(Number(minutes) || 0)) * 60;
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    let left = total; const picked = new Set();
    const take = (l) => { picked.add(l.id); left -= size(l); };
    for (const l of q) if (((l.due && l.due <= end.getTime()) || l.tier === 2) && size(l) <= left) take(l);
    const rest = q.filter((l) => !picked.has(l.id) && !l.chore), before = picked.size;
    for (const l of rest) if (size(l) <= left && size(l) <= total / 2) take(l);
    if (picked.size === before && !before) for (const l of rest) if (size(l) <= left) take(l);
    return { minutes: total / 60, ids: v.queue.filter((id) => picked.has(id)), seconds: total - left };
  }

  // "Did I ever renew that?" Read from the log, so it survives anything that later happens to the light.
  function history(q, limit = 60) {
    const words = str(q, 100).toLowerCase().split(/\s+/).filter(Boolean);
    const all = events(), undone = new Set();
    for (const e of all) { if (e.type === 'undone' && e.decision) undone.add(e.decision); else if (e.type === 'restored') undone.delete(e.decision); }
    const outcome = {}, doneAt = {}; all.forEach((e) => { if (e.type === 'completed') { outcome[e.decision] = e.outcome; doneAt[e.decision] = e.at; } });
    const approval = (e) => /^approved|^retried/.test(e.what || '');
    return all.filter((e) => e.type === 'decided' && !undone.has(e.decision))
      .map((e) => ({ id: e.id, key: e.key, area: e.area, title: e.title, at: e.at, by: e.by, agent: e.agent || '', to: e.to || '', sentAt: approval(e) && outcome[e.decision] === 'sent' ? doneAt[e.decision] : null,
        what: e.what + (approval(e) && outcome[e.decision] === 'sent' ? ', sent' : approval(e) && outcome[e.decision] === 'failed' ? ', failed to send' : ''), text: e.text || '' }))
      .filter((r) => words.every((w) => (r.title + ' ' + r.area + ' ' + r.text + ' ' + r.what + ' ' + r.to).toLowerCase().includes(w)))
      .sort((a, b) => b.at - a.at).slice(0, limit);
  }

  // Only a real streak can be promoted, and only while the person has autonomy switched on.
  function promote(key, yes, now = Date.now()) {
    key = str(key, 200);
    if (!yes) { db.declined[key] = true; return { key, auto: false }; }
    if (!db.settings.autonomy) throw new Error('"Runs by itself" is switched off. Turn it on first.');
    const st = db.streaks[key];
    if (!st || st.n < PROMOTE_STREAK || st.days.length < 3) throw new Error('Only a real streak can be promoted: ten single approvals of the same typed change, on three different days.');
    db.auto[key] = { since: now, runs: 0, paused: false, recent: [], hour: [], agent: st.agent || '' };
    buffer.push({ at: now, type: 'promoted', key });
    return { key, auto: true };
  }
  function renameArea(id, name) {
    const a = db.areas.find((x) => x.id === id); if (!a) throw new Error('No such container');
    const n = str(name, 60); if (!n) throw new Error('name is required');
    if (db.areas.some((x) => x !== a && x.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a container called ${n}.`);
    buffer.push({ at: Date.now(), type: 'container renamed', id, from: a.name, area: n }); a.name = n; a.demo = false; return a;
  }
  function removeArea(id) {
    const a = db.areas.find((x) => x.id === id); if (!a) throw new Error('No such container');
    const open = db.lights.filter((l) => l.area === id && l.state !== 'done' && l.state !== 'dropped').length;
    if (open) throw new Error(`${a.name} still has ${open} open light${open === 1 ? '' : 's'}. Move or finish ${open === 1 ? 'it' : 'them'} first.`);
    db.areas = db.areas.filter((x) => x !== a); buffer.push({ at: Date.now(), type: 'container removed', id, area: a.name }); return { ok: true };
  }
  function unlearn(areaId, line) {
    const a = db.areas.find((x) => x.id === areaId); if (!a) throw new Error('No such container');
    const t = str(line, 300); a.rules = (a.rules || []).filter((r) => r !== t);
    a.voice = (a.voice || '').split('\n').filter((x) => x !== t).join('\n');
    buffer.push({ at: Date.now(), type: 'rule removed', area: a.name, what: t }); return a;
  }
  function reoffer(key) { delete db.declined[str(key, 200)]; return { key }; }
  function setting(name, value) { if (name !== 'autonomy') throw new Error(`Unknown setting ${name}`); if (typeof value !== 'boolean') throw new Error('autonomy must be true or false'); db.settings.autonomy = value; buffer.push({ at: Date.now(), type: 'setting', name, value: !!value }); return db.settings; }
  // Turn a repeated "Ask for changes" note into a line of the container's voice note, or dismiss the offer.
  function learn(areaId, why, yes) {
    const a = db.areas.find((x) => x.id === areaId); if (!a) throw new Error('No such container');
    const k = str(why, 300).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const line = str(why, 300);
    if (yes) { a.rules = (a.rules || []).filter((r) => r !== line).concat(line).slice(-20); log('rule', { id: '', area: a.id, title: line }, { what: 'always: ' + line }, Date.now()); }
    else db.dismissed[a.id + '|' + k] = true;
    return a;
  }

  function seedDemo(now = Date.now()) {
    if (db.lights.some((l) => l.demo)) return; // loading the examples twice must not double them
    const A = (name, note, extra) => findArea(name) || addArea(Object.assign({ name, note, demo: true }, extra), now);
    A('Main business', 'Example area. Rename it to your business.');
    A('Side project', 'Example area.');
    A('Admin', 'Bills, forms, renewals.');
    A('Family', 'Pickups, games, appointments.');
    A('Someday', 'Asleep until its wake date.', { wake_at: now + 45 * DAY });
    const R = (o) => raise(Object.assign({ demo: true, by: 'example' }, o), now);
    R({ area: 'Main business', title: 'Reply to a customer asking about pricing', kind: 'approve', outbound: true, follow_up_days: 3, action_type: 'customer-reply', value: 1200, to: 'a customer',
      source: 'Email from a customer, 9:12 am: "Do you offer a monthly plan, and what does it include?"',
      draft: 'Hi, thanks for asking. Yes, we have a monthly plan. It includes setup, updates and support. Want me to send the details?',
      next: 'your assistant sends it, then it waits 3 days for a reply' });
    R({ area: 'Side project', title: 'Fix a typo on the pricing page', kind: 'approve', action_type: 'site-fix', change_from: 'Monthy plan', change_to: 'Monthly plan', seconds: 10 });
    R({ area: 'Side project', title: 'Two events look like duplicates. Which one stays?', kind: 'decide', options: ['Keep the first', 'Keep the second', 'Keep both'] });
    R({ area: 'Admin', title: 'Read one page for me (it needs your login)', kind: 'sense', link: 'https://example.com/', options: ['No changes', 'Changed'], note: 'Robots may not open this page. Open it, then tap what you saw.' });
    R({ area: 'Main business', title: 'Quote sent to a new client', state: 'waiting_them', outbound: true, follow_up_days: 2, note: 'The ball is in their court.' });
    R({ area: 'Side project', title: 'Outreach notes with no reply yet', state: 'waiting_them', batch: 6, follow_up_days: 5 });
    R({ area: 'Side project', title: 'Nightly test run', state: 'auto', progress: 70 });
    R({ area: 'Admin', title: 'Weekly backup', state: 'auto' });
    R({ area: 'Side project', title: 'Daily data refresh has not run since Tuesday', state: 'broken', options: ['Run it now', 'Leave it'] });
    R({ area: 'Side project', title: 'Next release', state: 'queued' });
    R({ area: 'Family', title: 'Add your first thing: type it in the bar at the top', kind: 'todo' });
  }
  function clearDemo() {
    buffer.push({ at: Date.now(), type: 'examples cleared' });
    db.lights = db.lights.filter((l) => !l.demo);
    db.areas = db.areas.filter((a) => !a.demo || db.lights.some((l) => l.area === a.id));
    db.areas.forEach((a) => { a.demo = false; });
  }

  load();
  return { dir, file, load, save, reset, rollback, get db() { return db; }, get warnings() { return warnings; }, addArea, raise, update, act, bulk, complete, ack, tick, view, decisions, decisionFor, notYours, connectorSeen, pending, dump, fit, history, promote, demote, setting, learn, unlearn, reoffer, renameArea, removeArea, seedDemo, clearDemo };
}

module.exports = { open, rev, splitDump, STATES, KINDS, CHANNELS, OUTCOMES, ORDER, DAY, PROMOTE_STREAK, HOLD_MS, OUT_HOLD_MS, COLLECT_MS, QUIET_MS, CLAIM_MS, SPOT_EVERY, FLAG };
