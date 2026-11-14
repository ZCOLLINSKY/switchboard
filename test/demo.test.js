'use strict';
// The browser demo (scripts/build-demo.js): the real board runs inside one page with made-up data. Here the page's
// injected script runs in a bare JavaScript context shaped like a browser window (no Node modules, no process), and the
// page's own calls (fetch, EventSource) are answered by the board inside it.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { build } = require('../scripts/build-demo');

function browser(html) {
  const script = html.match(/<script>\n\(function \(\) \{\nconst DEMO_SCENARIO[\s\S]*?\n<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
  const store = new Map(), timers = new Set();
  const track = (set, clear) => [(...a) => { const id = set(...a); timers.add([clear, id]); return id; }, clear];
  const [st, ct] = track(setTimeout, clearTimeout), [si, ci] = track(setInterval, clearInterval);
  const win = {
    location: new URL('https://someone.github.io/switchboard/'),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    crypto: globalThis.crypto, setTimeout: st, clearTimeout: ct, setInterval: si, clearInterval: ci,
    TextEncoder, URL, URLSearchParams, Response, EventTarget, Event, console, Date, Math, JSON, Symbol, Promise, Error, Map, Set,
    MessageEvent: globalThis.MessageEvent || class extends Event { constructor(t, o) { super(t); this.data = o && o.data; } },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(script, win, { filename: 'demo-inline.js' });
  return { win, store, stop: () => { for (const [clear, id] of timers) clear(id); } };
}

test('the demo page runs the real board in the browser and answers the page', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sbdemo-')), 'index.html');
  const { bytes } = build(out);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(bytes > 100000 && /Demo with made-up data/.test(html) && /noindex/.test(html));
  const b = browser(html);
  try {
    await b.win.__switchboardDemo.started;
    assert.match(b.store.get('switchboard-key'), /^[a-f0-9]{32}$/, 'the page is given the key, so every button works');
    const r = await b.win.fetch('/api/state');
    assert.equal(r.status, 200);
    const s = await r.json();
    assert.ok(s.lights.length >= 5, 'the made-up morning is there');
    assert.equal(s.canAct, true);
    assert.equal(s.sim.current, 'morning');
    // A tap, as the page sends it (the demo is under a path on its host: /switchboard/api/... still reaches the board).
    const l = s.lights.find((x) => x.state === 'need_you' && x.kind === 'decide' && x.options.length);
    const live = [];
    const es = new b.win.EventSource('/api/events');
    es.addEventListener('change', () => live.push(1));
    await new Promise((ok) => setTimeout(ok, 20));
    const act = await b.win.fetch(new URL('api/lights/' + l.id + '/act', b.win.location.href).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'answer', value: l.options[0], rev: l.rev }) });
    assert.equal(act.status, 200, await act.clone().text());
    assert.equal((await act.json()).state, 'done');
    await new Promise((ok) => setTimeout(ok, 20));
    assert.ok(live.length >= 1, 'the live feed told the page');
    es.close();
    // Nothing outside the page: a request to another address is not answered by the board.
    let other = null; b.win.fetch = b.win.fetch; try { await b.win.fetch('https://example.com/api/state'); } catch (e) { other = e; }
    assert.ok(other, 'no real network in the test context, and the demo did not answer for another host');
  } finally { b.stop(); }
});
