'use strict';
// Seeded property fuzzer for the store: several assistants (some sharing names, one relay), the person tapping and taking
// back, and a clock that jumps. After every step it checks the promises the README makes about decisions: none handed
// out twice inside a claim, none before its undo window, approved words frozen, never to another assistant, never after
// a take-back, counts that add up. test/fuzz.test.js runs a short pass; `node scripts/fuzz.js 60 500` runs a long one.
const path = require('path'), fs = require('fs'), os = require('os');

function fuzz(SEEDS = 20, STEPS = 300) {
  const { open, rev, CLAIM_MS, HOLD_MS, OUT_HOLD_MS } = require('../lib/store');
  const AGENTS = ['claude-code:alpha~1a2b', 'claude-code:beta~3c4d', 'owners-board', 'claude-code:around-lex'];
  const viol = {}, samples = {}, THROWS = {}, COV = { orphans: 0, approvals: 0, answers: 0, handed: 0, rehanded_after_claim: 0, undone: 0, completed: 0, outbound_handed: 0 };
  const bad = (kind, msg, seed, step) => { viol[kind] = (viol[kind] || 0) + 1; if (!samples[kind]) samples[kind] = `seed ${seed} step ${step}: ${msg}`; };
  for (let seed = 1; seed <= SEEDS; seed++) {
    let x = seed * 2654435761 >>> 0; const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbfuzz-'));
    const s = open(dir, {});
    let now = new Date(2026, 10, 16, 10, 0, 0).getTime();
    const acted = new Map();    // decision id -> { at, outbound, text, light }
    const handed = new Map();   // decision id -> { to, at }
    const undone = new Set();   // decision ids taken back
    const held = new Map();     // agent -> [{ id, decision_id }]
    const asked = {};           // agent -> last time it asked for decisions
    for (let step = 0; step < STEPS; step++) {
      const r = rnd();
      try {
        if (r < 0.25) {
          const agent = pick(AGENTS.concat([''])), outbound = rnd() < 0.4, decide = !outbound && rnd() < 0.4;
          s.raise(Object.assign({ area: pick(['Shop', 'Code', 'Home']), title: 'T' + Math.floor(rnd() * 40), agent: agent || undefined },
            decide ? Object.assign({ kind: 'decide', options: ['Yes', 'No'] }, rnd() < 0.5 ? { recommended: pick(['Yes', 'No']) } : {}) : { kind: 'approve', draft: 'Draft ' + Math.floor(rnd() * 1e6), outbound, to: outbound ? 'Dale' : undefined },
            rnd() < 0.5 ? { key: 'k' + Math.floor(rnd() * 15) } : {}), now);
        } else if (r < 0.50) {
          const gold = s.db.lights.filter((l) => l.state === 'need_you'); if (!gold.length) continue;
          const l = pick(gold), kind = l.kind;
          const res = kind === 'decide' ? s.act(l.id, 'answer', { value: pick(l.options), rev: rev(l) }, now)
            : rnd() < 0.8 ? s.act(l.id, 'approve', { rev: rev(l), text: rnd() < 0.2 ? 'Edited ' + step : undefined }, now)
            : s.act(l.id, 'no', { rev: rev(l) }, now);
          const d = s.db.lights.find((y) => y.id === l.id).decision;
          if (d) { COV[kind === 'decide' ? 'answers' : 'approvals']++; } if (d) acted.set(d.id, { at: now, outbound: !!l.outbound && d.action === 'approve', text: d.text, light: l.id, agent: l.agent || '' });
        } else if (r < 0.53) {
        const recs = s.db.lights.filter((l) => l.state === 'need_you' && l.recommended && !l.outbound);
        if (recs.length < 2) continue;
        const take = recs.slice(0, 2 + Math.floor(rnd() * Math.min(4, recs.length - 1)));
        s.bulk(take.map((l) => l.id), 'recommended', { revs: Object.fromEntries(take.map((l) => [l.id, rev(l)])) }, now);
        for (const l of take) { const d = s.db.lights.find((y) => y.id === l.id).decision; if (d) { COV.answers++; COV.recommended = (COV.recommended || 0) + 1; acted.set(d.id, { at: now, outbound: false, text: d.text, light: l.id, agent: l.agent || '' }); if (d.value !== l.recommended) bad('recommended-wrong-value', `${d.value} vs ${l.recommended}`, seed, step); } }
      } else if (r < 0.56) {
          const withUndo = s.db.lights.filter((l) => l.decision && !l.decision.collectedAt && !l.decision.outcome && l.undo); if (!withUndo.length) continue;
          const l = pick(withUndo), did = l.decision.id;
          try { s.act(l.id, 'undo', {}, now); undone.add(did); COV.undone++; } catch (e) { /* refused is fine */ }
        } else if (r < 0.58) {
          // A session closing its own light: allowed only when no decision on it is out.
          const open = s.db.lights.filter((l) => l.state !== 'done' && l.state !== 'dropped'); if (!open.length) continue;
          const l = pick(open), d = l.decision, out = !!(d && !d.outcome) || l.unsure || l.unreported || !!l.own; // the person's own note is never closed by a session
          let ok = true; try { s.update(l.id, { state: pick(['done', 'dropped']), closing: true, agent: l.agent || 'agent' }, l.agent || 'agent', now); } catch (e) { ok = false; }
          if (ok) COV.closed = (COV.closed || 0) + 1; else COV.close_refused = (COV.close_refused || 0) + 1;
          if (ok && out) bad('closed-with-decision-out', `light ${l.id}`, seed, step);
          if (!ok && !out && l.state !== 'done') bad('close-refused-without-decision', `light ${l.id}`, seed, step);
        } else if (r < 0.66) {
          const mine = s.db.lights.filter((l) => l.agent && ['need_you', 'queued'].includes(l.state)); if (!mine.length) continue;
          const l = pick(mine); try { s.update(l.id, { draft: 'New ' + step, agent: l.agent }, l.agent, now); } catch (e) { /* frozen is fine */ }
        } else if (r < 0.84) {
          const agent = pick(AGENTS), only = agent === 'owners-board' ? rnd() < 0.8 : false, all = !only && rnd() < 0.05;
          const orphansMs = agent === 'owners-board' && only && rnd() < 0.7 ? 10 * 60e3 : 0;
          const out = s.decisions(now, { agent, only, all, orphans: orphansMs });
          asked[agent] = now;
          for (const d of out.decisions) {
            const a = acted.get(d.decision_id), h = handed.get(d.decision_id), l = s.db.lights.find((y) => y.id === d.id);
            if (undone.has(d.decision_id)) bad('handed-after-undo', d.decision_id, seed, step);
            if (h && now < h.at + CLAIM_MS) bad('double-hand-in-claim', `${d.decision_id} to ${h.to} then ${agent}`, seed, step);
            if (a && now < a.at + (a.outbound ? OUT_HOLD_MS : HOLD_MS) - 1) bad('before-hold', `${now - a.at} ms after the tap`, seed, step);
            if (a && d.action === 'approve' && a.text != null && d.text !== a.text) bad('text-not-frozen', `approved "${a.text}" handed "${d.text}"`, seed, step);
            if (d.orphan) {
              COV.orphans++;
              if (!orphansMs) bad('orphan-unasked', d.id, seed, step);
              if (l && l.outbound) bad('orphan-message', d.id, seed, step);
              if (a && now < a.at + (a.outbound ? OUT_HOLD_MS : HOLD_MS) + orphansMs - 1) bad('orphan-too-soon', `${now - a.at} ms after the tap`, seed, step);
              if (a && asked[d.raised_by] != null && asked[d.raised_by] >= a.at + (a.outbound ? OUT_HOLD_MS : HOLD_MS)) bad('orphan-owner-was-asking', d.raised_by, seed, step);
            } else if (!all && l && l.agent && (only ? l.agent !== agent : l.agent !== agent)) bad('wrong-owner', `${l.agent}'s light to ${agent}`, seed, step);
            if (only && l && !l.agent) bad('only-took-unowned', d.id, seed, step);
            COV.handed++; if (h) COV.rehanded_after_claim++; if (a && a.outbound) COV.outbound_handed++;
            handed.set(d.decision_id, { to: agent, at: now });
            (held.get(agent) || held.set(agent, []).get(agent)).push({ id: d.id, decision_id: d.decision_id });
          }
        } else if (r < 0.94) {
          const agent = pick([...held.keys()]); if (!agent) continue; const list = held.get(agent); if (!list.length) continue;
          const job = list.splice(Math.floor(rnd() * list.length), 1)[0];
          try { s.complete(job.id, pick(['sent', 'done', 'failed', 'unsure']), 'fuzz', now, job.decision_id); COV.completed++; } catch (e) { /* refused is fine */ }
        } else {
          now += Math.floor(rnd() < 0.7 ? rnd() * 90e3 : rnd() * 40 * 60e3);
          s.tick(now);
        }
        const v = s.view(now), live = v.lights;
        const need = live.filter((l) => l.state === 'need_you').length;
        if (v.counts.need_you !== need) bad('counts', `need_you ${v.counts.need_you} vs ${need}`, seed, step);
      } catch (e) {
        { const k = e.message.replace(/[0-9a-f]{6,}/g, 'ID').replace(/\d+/g, 'N').slice(0, 110); THROWS[k] = (THROWS[k] || 0) + 1; if (e instanceof TypeError || e instanceof ReferenceError) bad('crash', e.stack.split('\n').slice(0, 2).join(' | '), seed, step); }
      }
    }
  }
  return { seeds: SEEDS, steps: STEPS, violations: viol, first: samples, coverage: COV };
}

if (require.main === module) console.log(JSON.stringify(fuzz(+process.argv[2] || 60, +process.argv[3] || 500), null, 1));
module.exports = { fuzz };
