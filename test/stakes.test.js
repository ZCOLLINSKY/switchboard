'use strict';
// Stakes: how carefully the person must read a light before saying yes. High lights are answered one at a time and are
// never part of a group tap; read lights are listed before a group tap; safe lights may be taken together. An assistant
// may declare stakes, and its word can only raise what the board reads in the light. Also here: broken lights pinned
// first, one counting unit for every number on the page, and a timestamped copy of the data file before a release.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { open, rev, stakes, snapshot, DAY } = require('../lib/store');
const { scenarios } = require('../scenarios');
const recs = require('./fixtures/recs29.json').lights;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stakes-'));
const fresh = () => open(tmp(), {});
const T = new Date(2026, 10, 16, 10, 0, 0).getTime();
const AG = 'claude-code:around-lex';
const yn = (s, title, extra) => s.raise(Object.assign({ agent: AG, area: 'Around Lex', title, kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes' }, extra), T);
const guess = (l) => stakes(Object.assign({ options: [], batch: 1 }, l));

test('the 29 hand-checked recommendations: none of the high ones lands in safe, and eed6997c is high', () => {
  assert.equal(recs.length, 29);
  for (const l of recs) assert.equal(guess(l).stakes, l.expect, `${l.id} "${l.title}"`);
  const high = recs.filter((l) => (l.handChecked || l.expect) === 'high');
  assert.equal(high.length, 11);
  for (const l of high) assert.notEqual(guess(l).stakes, 'safe', l.id);
  assert.equal(guess(recs.find((l) => l.id === 'eed6997c')).stakes, 'high');
  // The same lights raised on a board come out the same way, and the board says it guessed.
  const s = fresh();
  for (const l of recs) s.raise(Object.assign({ agent: AG, area: 'Around Lex', kind: 'decide' }, l, { id: undefined, expect: undefined, handChecked: undefined, why: undefined }), T);
  const v = s.view(T);
  for (const l of v.lights) { const want = recs.find((r) => r.title === l.title).expect; assert.equal(l.stakes, want, l.title); assert.equal(l.stakesFrom, 'guess'); }
});

test('the titles assistants really write', () => {
  assert.equal(guess({ title: 'NEEDS ZACH (production database change): apply the new unique index' }).stakes, 'high');
  assert.equal(guess({ title: 'Approve the Weekend Boost terms line' }).stakes, 'high');
  assert.equal(guess({ title: 'Add 4 checked Thanksgiving-week listings' }).stakes, 'read');
  assert.equal(guess({ title: 'Let search index the separately ticketed series sessions?' }).stakes, 'read');
  assert.equal(guess({ title: 'Rename the internal dashboard tab' }).stakes, 'safe');
  // Several decisions in one light are a bundle: the risk hides inside.
  for (const t of ['One reply clears nine LightDeck yes/nos', 'Five small SQL fixes', 'Two decisions on the venue import']) assert.deepEqual([guess({ title: t }).stakes, guess({ title: t }).why], ['high', 'BUNDLE'], t);
  // A message to a person, money and a light with a value are high, whatever the words.
  assert.equal(guess({ title: 'Reply to the venue', outbound: true }).why, 'PEOPLE');
  assert.equal(guess({ title: 'Turn off the old pay links in Stripe' }).why, 'MONEY');
  assert.equal(guess({ title: 'Quote for the porch', value: 900 }).why, 'MONEY');
  // A light standing for several items is at least read first.
  assert.equal(guess({ title: 'Tag the new photos', batch: 6 }).stakes, 'read');
});

test('harmless words are taken out first, and case matters for Terms and STOP', () => {
  assert.equal(guess({ title: 'Match sign-in emails without capitals', note: 'No database change.' }).stakes, 'safe');
  assert.equal(guess({ title: 'Do a read-only pass over the bookings', note: 'No data changes.' }).stakes, 'safe');
  assert.equal(guess({ title: 'Run the read-only SQL check' }).stakes, 'high', 'only the calming words go; SQL is still SQL');
  assert.equal(guess({ title: 'Stop Spotlight on the internal tab' }).stakes, 'safe', '"Stop" is not a texting opt-out');
  assert.equal(guess({ title: 'Handle a reply of STOP on the text line' }).stakes, 'high');
  assert.equal(guess({ title: 'Tidy the tab, in terms of spacing' }).stakes, 'safe', '"in terms of" is not the Terms');
  assert.equal(guess({ title: 'Fix Terms 3a' }).why, 'LEGAL');
  assert.equal(guess({ title: 'Approve it', note: 'Includes a migration of the bookings table.' }).why, 'PROD DB', 'the note is read too');
});

test('a guessed-high light that recommends changing nothing is read first, never safe', () => {
  const l = { title: 'NEEDS ZACH (production database change): drop the old index?', options: ['Yes', 'No'], recommended: 'No' };
  assert.deepEqual(guess(l), { stakes: 'read', from: 'guess', why: 'NO CHANGE' });
  assert.equal(guess(Object.assign({}, l, { stakesSet: 'safe' })).stakes, 'read', 'an assistant cannot make it safe');
  assert.equal(guess(Object.assign({}, l, { stakesSet: 'high' })).stakes, 'high', 'an assistant can still say it is high');
  assert.equal(guess(Object.assign({}, l, { recommended: 'Yes' })).stakes, 'high');
  assert.equal(guess({ title: 'Reply to the venue', outbound: true, options: ['Send', 'Not now'], recommended: 'Not now' }).stakes, 'high', 'a message to a person stays high');
});

test('an assistant may only raise the stakes, and impact is one short line', () => {
  const s = fresh();
  const a = yn(s, 'Rename the dashboard tab', { stakes: 'high', impact: 'The tab reads Today for everyone on the team.' });
  let v = s.view(T), x = v.lights.find((l) => l.id === a.id);
  assert.deepEqual([x.stakes, x.stakesFrom, x.impact], ['high', 'agent', 'The tab reads Today for everyone on the team.']);
  // Lowering its own word later is refused out loud.
  s.update(a.id, { stakes: 'safe', agent: AG }, AG, T + 1000);
  assert.ok(s.warnings.some((w) => /only be raised; it stays high/.test(w)));
  assert.equal(s.view(T).lights.find((l) => l.id === a.id).stakes, 'high');
  // Saying safe on a light the board reads as high changes nothing, and the assistant hears why.
  const b = yn(s, 'NEEDS ZACH (production database change): apply the new unique index', { stakes: 'safe' });
  assert.ok(s.warnings.some((w) => /lower than the board reads this light \(high/.test(w)), s.warnings.join('; '));
  x = s.view(T).lights.find((l) => l.id === b.id);
  assert.deepEqual([x.stakes, x.stakesFrom], ['high', 'guess']);
  yn(s, 'Pick a font', { stakes: 'urgent' });
  assert.ok(s.warnings.some((w) => /stakes must be high, read or safe/.test(w)));
  const c = yn(s, 'Turn on the faster loader', { impact: 'x'.repeat(200) });
  assert.equal(c.impact.length, 160);
  assert.ok(s.warnings.some((w) => /impact is longer than 160/.test(w)));
  // Impact is part of what the person read: a group tap after it changed is refused.
  const seen = rev(c);
  s.update(c.id, { impact: 'Images load first on slow phones.', agent: AG }, AG, T + 2000);
  assert.notEqual(rev(c), seen);
  assert.throws(() => s.bulk([c.id], 'recommended', { revs: { [c.id]: seen } }, T + 3000), /changed/i);
  const plain = yn(s, 'No impact here');
  assert.equal(rev(plain), rev(Object.assign({}, plain, { impact: undefined })), 'lights without one keep the fingerprint they had');
});

test('the view splits recommended lights into safe, read and high lanes, and counts them', () => {
  const s = fresh();
  const safe = yn(s, 'Rename the dashboard tab'), read = yn(s, 'Add 4 checked Thanksgiving-week listings'), high = yn(s, 'Approve the Weekend Boost terms line');
  const msg = s.raise({ agent: AG, area: 'Around Lex', title: 'Reply to the venue', kind: 'approve', draft: 'Hi', outbound: true, to: 'The venue', options: ['Send', 'Hold'], recommended: 'Send' }, T);
  yn(s, 'No recommendation', { recommended: undefined });
  const v = s.view(T);
  assert.deepEqual(v.lanes, { safe: [safe.id], read: [read.id], high: [high.id] }, 'a message to a person is never in a lane');
  assert.equal(v.counts.recommended, 4, 'every light in the queue with a recommended answer, the message included');
  assert.equal(v.lights.find((l) => l.id === msg.id).stakes, 'high');
});

test('a group tap refuses any high light, and answers nothing', () => {
  const s = fresh();
  const safe = yn(s, 'Rename the dashboard tab'), read = yn(s, 'Let search index the separately ticketed series sessions?'), high = yn(s, 'NEEDS ZACH (production database change): apply the new unique index');
  const revs = { [safe.id]: rev(safe), [read.id]: rev(read), [high.id]: rev(high) };
  assert.throws(() => s.bulk([safe.id, high.id], 'recommended', { revs }, T + 1000), /^Error: Answered one at a time\.$/);
  assert.equal(s.db.lights.find((l) => l.id === safe.id).decision, null, 'nothing was answered');
  const change = s.raise({ agent: AG, area: 'Around Lex', title: 'Apply the migration', change_from: 'v1', change_to: 'v2' }, T);
  const tidy = s.raise({ agent: AG, area: 'Around Lex', title: 'Tidy the tab order', change_from: 'a', change_to: 'b' }, T);
  assert.throws(() => s.bulk([tidy.id, change.id], 'approve', { revs: { [tidy.id]: rev(tidy), [change.id]: rev(change) } }, T + 1000), /Answered one at a time/);
  // An assistant that marks a light high keeps it out of group taps too.
  const marked = yn(s, 'Turn on the faster loader', { stakes: 'high' });
  assert.throws(() => s.bulk([marked.id], 'recommended', { revs: { [marked.id]: rev(marked) } }, T + 1000), /Answered one at a time/);
  // Safe and read lights go together; the high one is still answered on its own.
  assert.equal(s.bulk([safe.id, read.id], 'recommended', { revs }, T + 2000).length, 2);
  assert.equal(s.bulk([tidy.id], 'approve', { revs: { [tidy.id]: rev(tidy) } }, T + 2000).length, 1);
  s.act(high.id, 'answer', { value: 'Yes', rev: rev(high) }, T + 3000);
  assert.equal(s.db.lights.find((l) => l.id === high.id).decision.value, 'Yes');
});

test('broken lights are pinned above every other tier, the ones that hold something up first, and never fold away', () => {
  const s = fresh();
  s.raise({ area: 'A', title: 'Form due tonight', kind: 'todo', link: 'https://x', due: T + 3600e3 }, T);
  s.raise({ area: 'A', title: 'Quote, $8,900', draft: 'x', outbound: true, to: 'Dale', value: 8900 }, T);
  s.raise({ area: 'A', title: 'Sales emails stopped', state: 'broken' }, T - 3 * DAY);
  s.raise({ area: 'A', title: 'Deposit reminders did not send', state: 'broken', holds_up: '3 deposits' }, T);
  const v = s.view(T), titles = v.queue.map((id) => v.lights.find((l) => l.id === id).title);
  assert.deepEqual(titles, ['Deposit reminders did not send', 'Sales emails stopped', 'Form due tonight', 'Quote, $8,900']);
  for (const l of v.lights.filter((x) => x.state === 'broken')) { assert.equal(l.keep, true); assert.equal(l.tier, -1); }
  assert.match(v.order[0], /broken/);
});

test('a broken light with nothing to act on is warned at raise', () => {
  const s = fresh();
  s.raise({ agent: AG, area: 'A', title: 'Sales emails stopped until Resend can report bounces', state: 'broken' }, T);
  assert.ok(s.warnings.some((w) => /broken light has no link, no options and no failure/.test(w)));
  s.raise({ agent: AG, area: 'A', title: 'Nightly import failed', state: 'broken', link: 'https://example.com/logs' }, T);
  assert.ok(!s.warnings.some((w) => /broken light has no link/.test(w)));
});

test('one counting unit: a row. Area counts, the headline and the total add up', () => {
  const s = fresh();
  s.raise({ agent: AG, area: 'Around Lex', title: 'Approve the next 10 sales notes', draft: 'Hi', outbound: true, to: '10 venues', batch: 10 }, T);
  yn(s, 'Rename the dashboard tab');
  s.raise({ agent: AG, area: 'Around Lex', title: 'Sales emails stopped', state: 'broken', link: 'https://x' }, T);
  s.raise({ agent: AG, area: 'Around Lex', title: 'Nightly check', state: 'auto' }, T);
  s.raise({ agent: AG, area: 'Around Lex', title: 'Show HN post', state: 'queued', draft: 'x', outbound: true, to: 'HN', channel: 'copy' }, T);
  s.raise({ agent: AG, area: 'School', title: 'Pick a topic', kind: 'decide', options: ['A', 'B'] }, T);
  const v = s.view(T), lex = v.areas.find((a) => a.name === 'Around Lex'), school = v.areas.find((a) => a.name === 'School');
  assert.deepEqual([lex.waiting, lex.broken, school.waiting, school.broken], [2, 1, 1, 0], 'the batch of 10 is one row');
  assert.equal(v.counts.waiting, 3);
  assert.equal(v.counts.total, v.counts.waiting + v.counts.broken + v.counts.running + v.counts.queued + v.counts.others + v.counts.aside + v.counts.reachOut);
  assert.equal(v.counts.total, v.lights.length, 'the total is every live light, the list See everything opens');
  assert.equal(v.counts.total, 6);
});

test('on the slammed practice board the area cards, the headline and the total agree', () => {
  const NOW = Date.UTC(2026, 0, 9, 14), s = open(tmp());
  scenarios.slammed.build(s, NOW);
  const v = s.view(NOW), sum = (k) => v.areas.reduce((n, a) => n + a[k], 0);
  assert.equal(sum('waiting') + sum('broken'), v.queue.length, 'every queue row is in exactly one area');
  assert.equal(sum('waiting'), v.counts.waiting);
  assert.equal(v.counts.total, v.counts.waiting + v.counts.broken + v.counts.running + v.counts.queued + v.counts.others + v.counts.aside + v.counts.reachOut);
  assert.equal(v.counts.total, v.lights.length, 'the total is every live light, the list See everything opens');
  assert.ok(v.counts.recommended <= v.counts.waiting, 'recommended is a part of waiting, never added to it');
  assert.equal(v.counts.reachOut, 2, 'the two suggestions wait in Reach out, outside the queue');
  assert.ok(v.reachOut.every((id) => !v.queue.includes(id)));
  assert.equal(v.lanes.safe.length + v.lanes.read.length + v.lanes.high.length, v.queue.filter((id) => { const l = v.lights.find((x) => x.id === id); return l.recommended && !l.outbound && l.state === 'need_you'; }).length);
  const top = v.lights.find((l) => l.id === v.queue[0]);
  assert.equal(top.state, 'broken', 'a broken light is first');
});

test('a snapshot before a release: a timestamped private copy, never pruned by the daily rule', () => {
  const dir = tmp(), s = open(dir, {});
  assert.throws(() => snapshot(dir), /no data file/);
  s.raise({ area: 'Shop', title: 'First', kind: 'todo' }); s.save();
  const at = new Date(2026, 10, 15, 21, 5, 9).getTime();
  const a = snapshot(dir, 'before 0.4.0', at);
  assert.equal(path.basename(a), 'data-2026-11-15T210509-before-0-4-0.json');
  assert.equal(fs.readFileSync(a, 'utf8'), fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  assert.equal(fs.statSync(a).mode & 0o777, 0o600);
  const b = s.snapshot('before 0.4.0', at);
  assert.notEqual(a, b, 'a second copy in the same second never writes over the first');
  // The daily copies keep their own 14; snapshots keep their newest 30.
  for (let i = 0; i < 35; i++) snapshot(dir, '', at + (i + 1) * 1000);
  const all = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(all.filter((f) => /T\d{6}/.test(f)).length, 30);
  assert.ok(all.some((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)), 'the daily copy is still there');
  fs.writeFileSync(path.join(dir, 'data.json'), '{"lights": [');
  assert.throws(() => snapshot(dir, '', at + 99e3), /JSON|Unexpected|Expected/);
});

test('every risky word but Terms and STOP is matched whatever its case', () => {
  const yes = (title) => guess({ title, options: ['Yes', 'No'], recommended: 'Yes' });
  for (const t of ['Migration 0042: drop the old orders column on prod?', 'Production rows: delete 40 duplicate customers?', 'Legal wants the new waiver wording live today?',
    'Compliance: switch off the opt-in check?', 'Invite all 300 past customers to the beta?', 'Lawyer reviewed: ship it?', 'Needs Zach: run it?', 'Refund the double charge?', 'Opt-Out link on the footer'])
    assert.equal(yes(t).stakes, 'high', t);
  assert.equal(yes('Stop Spotlight on the internal tab').stakes, 'safe', '"Stop" is still not STOP');
  assert.equal(yes('Tidy the tab, in terms of spacing').stakes, 'safe', '"in terms of" is still not the Terms');
});

test('a "No" that removes a safeguard is not "changing nothing": the light stays high', () => {
  const s = fresh();
  const stop = yn(s, 'Keep the STOP opt-out keyword on the text line?', { recommended: 'No' });
  const refund = yn(s, 'Keep the refund step in the order flow?', { recommended: 'No' });
  const dont = yn(s, "Don't run the migration tonight?", { recommended: 'No' });
  const drop = yn(s, 'NEEDS ZACH (production database change): drop the old index?', { recommended: 'No' });
  const v = s.view(T), st = (l) => v.lights.find((x) => x.id === l.id).stakes;
  assert.deepEqual([st(stop), st(refund), st(dont)], ['high', 'high', 'high']);
  assert.equal(st(drop), 'read', 'a No that leaves things as they are is still read first');
  assert.deepEqual(v.lanes.read, [drop.id]);
  assert.throws(() => s.bulk([stop.id, refund.id], 'recommended', { revs: { [stop.id]: rev(stop), [refund.id]: rev(refund) } }, T + 1000), /Answered one at a time/);
});

test('the count line: each live light in one part, sleeping areas included, and the same per area', () => {
  const s = fresh();
  yn(s, 'Rename the dashboard tab', { area: 'A' });
  yn(s, 'Pick a colour', { area: 'B' });
  s.raise({ agent: AG, area: 'B', title: 'Import failed', state: 'broken', link: 'https://x' }, T);
  s.raise({ agent: AG, area: 'A', title: 'Asked the venue', state: 'waiting_them' }, T);
  const snz = yn(s, 'Later', { area: 'A' }); s.act(snz.id, 'snooze', { until: T + 3 * DAY }, T);
  s.db.areas.find((a) => a.name === 'B').wakeAt = T + 5 * DAY; // B is paused
  const v = s.view(T + 1000), c = v.counts, a = v.areas.find((x) => x.name === 'A'), b = v.areas.find((x) => x.name === 'B');
  assert.deepEqual([c.waiting, c.broken, c.others, c.aside, c.total], [1, 0, 1, 3, v.lights.length], 'a paused area\'s broken light is not counted as broken on the first screen');
  assert.equal(c.waiting + c.broken + c.running + c.queued + c.others + c.aside, c.total);
  assert.deepEqual([a.counts.waiting, a.counts.others, a.counts.aside, a.counts.total], [1, 1, 1, 3]);
  assert.deepEqual([b.counts.waiting, b.counts.broken, b.counts.aside, b.counts.total], [0, 0, 2, 2]);
  assert.equal(a.counts.recommended, 1);
});

test('a timed pass inside one area is filled from that area only', () => {
  const s = fresh();
  s.raise({ agent: AG, area: 'Elsewhere', title: 'Import failed', state: 'broken', link: 'https://x', seconds: 400 }, T);
  for (let i = 0; i < 6; i++) s.raise({ agent: AG, area: 'Elsewhere', title: 'Old thing ' + i, kind: 'todo', seconds: 60 }, T - DAY);
  const mine = [0, 1, 2].map((i) => s.raise({ agent: AG, area: 'Night classes', title: 'Quick question ' + i, kind: 'todo', seconds: 30 }, T));
  const f = s.fit(10, T, 'Night classes');
  assert.deepEqual(f.ids.slice().sort(), mine.map((l) => l.id).sort());
  assert.ok(s.fit(10, T).ids.length > 3, 'without an area the whole board fills it, as before');
});
