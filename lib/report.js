'use strict';
// Receipts: what the board did over the last few days, from its own append-only log (events.jsonl) and what is open now.
// Plain text, nothing estimated: every number is counted from the log. `node cli.js report [--days 7]`.
const DAY = 864e5;
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const span = (ms) => (ms == null ? '-' : ms < 90e3 ? `${Math.round(ms / 1000)} s` : ms < 90 * 60e3 ? `${Math.round(ms / 60e3)} min` : ms < 36 * 36e5 ? `${(ms / 36e5).toFixed(1)} h` : `${(ms / DAY).toFixed(1)} days`);

function report(events, view, { days = 7, now = Date.now() } = {}) {
  const from = now - days * DAY, recent = events.filter((e) => e && e.at >= from && e.at <= now);
  const raised = recent.filter((e) => e.type === 'raised');
  const askedAt = new Map(); // light id -> when it first asked the person (raised as need_you, or moved there)
  for (const e of events) if (e && e.at <= now && !askedAt.has(e.id) && e.state === 'need_you' && (e.type === 'raised' || e.type === 'updated')) askedAt.set(e.id, e.at);
  const yours = recent.filter((e) => e.type === 'decided' && e.by === 'you');
  const waits = yours.map((e) => (askedAt.has(e.id) && askedAt.get(e.id) <= e.at ? e.at - askedAt.get(e.id) : null)).filter((x) => x != null);
  const kinds = { approved: 0, answered: 0, 'asked for changes': 0, declined: 0, done: 0, dropped: 0, other: 0 };
  for (const e of yours) { const w = String(e.what || ''); const k = /^approved/.test(w) ? 'approved' : /^answered/.test(w) ? 'answered' : /^asked for changes/.test(w) ? 'asked for changes' : /^declined/.test(w) ? 'declined' : /^done/.test(w) ? 'done' : /^dropped/.test(w) ? 'dropped' : 'other'; kinds[k]++; }
  const done = recent.filter((e) => e.type === 'completed'), outcome = (o) => done.filter((e) => e.outcome === o).length;
  const collected = recent.filter((e) => e.type === 'collected'), byWho = {};
  for (const e of collected) byWho[e.by || '?'] = (byWho[e.by || '?'] || 0) + 1;
  const from_ = {}; for (const e of raised) { const k = e.agent || '(no name)'; from_[k] = (from_[k] || 0) + 1; }
  const auto = recent.filter((e) => e.type === 'decided' && e.by === 'auto').length;
  const undone = recent.filter((e) => e.type === 'undone').length;
  const open = (view && view.lights || []).filter((l) => l.state === 'need_you');
  const oldest = open.map((l) => ({ l, at: askedAt.get(l.id) || l.goldSince || l.createdAt })).filter((x) => x.at).sort((a, b) => a.at - b.at).slice(0, 3);
  const top = (o, n = 4) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ');
  const lines = [
    `Switchboard, the last ${days} day${days === 1 ? '' : 's'} (to ${new Date(now).toLocaleString()})`,
    '',
    `Came in: ${raised.length} light${raised.length === 1 ? '' : 's'}, ${raised.filter((e) => e.state === 'need_you').length} asking you${raised.length ? ` (from ${top(from_)})` : ''}.`,
    `You decided: ${yours.length}${yours.length ? ` (${Object.entries(kinds).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}${undone ? `; ${undone} taken back` : ''}.`,
    waits.length ? `Time from asking to your answer: middle ${span(median(waits))}, fastest ${span(Math.min(...waits))}, slowest ${span(Math.max(...waits))}.` : 'Time from asking to your answer: no answers yet.',
    `Picked up by assistants: ${collected.length}${collected.length ? ` (${top(byWho)})` : ''}.`,
    `Reported back: ${done.length}${done.length ? ` (${outcome('sent')} sent, ${outcome('done')} done, ${outcome('failed')} failed, ${outcome('unsure')} not sure)` : ''}.`,
    auto ? `Ran by itself under your rules: ${auto}.` : '',
    `Waiting on you now: ${open.length}${oldest.length ? `. Waiting longest: ${oldest.map((x) => `"${String(x.l.title).slice(0, 60)}" (${span(now - x.at)})`).join('; ')}` : ''}.`,
  ].filter((x) => x !== '');
  return lines.join('\n');
}

module.exports = { report };
