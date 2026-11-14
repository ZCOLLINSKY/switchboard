'use strict';
// A request that came through a proxy (tailscale serve, say) or names a host other than this computer is from another
// device, even though it reaches the board from 127.0.0.1. Every /api call then needs the page key; the page itself and
// /api/health stay open. Assistants and scripts on this computer are unchanged.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { start } = require('../server');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbrm-'));

// http.request, not fetch: fetch will not send a Host header of our choosing.
function ask(url, method, route, headers = {}, body) {
  const u = new URL(url);
  return new Promise((ok, fail) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path: route, headers: Object.assign(body ? { 'content-type': 'application/json' } : {}, headers) }, (res) => {
      if (/event-stream/.test(res.headers['content-type'] || '')) { res.destroy(); return ok({ status: res.statusCode, body: null }); }
      let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* the page */ } ok({ status: res.statusCode, body: j, text: t }); });
    });
    req.on('error', fail); req.end(body ? JSON.stringify(body) : undefined);
  });
}

const PROXIED = [{ 'x-forwarded-for': '100.101.102.103' }, { forwarded: 'for=100.101.102.103;proto=https' }, { 'tailscale-user-login': 'someone@example.com' }];
const ROUTES = [['GET', '/api/state'], ['GET', '/api/pending?agent=x'], ['GET', '/api/history?q='], ['GET', '/api/fit?minutes=5'], ['GET', '/api/events'],
  ['POST', '/api/decisions', { agent: 'x', all: true }], ['POST', '/api/wait', { id: 'abc', seconds: 1 }], ['POST', '/api/lights', { area: 'A', title: 'From afar' }], ['POST', '/api/ack', { ids: [] }]];

test('through a proxy, every /api call needs the page key, reading included', async () => {
  const a = await start({ port: 0, dir: tmp() });
  try {
    for (const h of PROXIED) for (const [m, r, b] of ROUTES) {
      const got = await ask(a.url, m, r, h, b);
      assert.equal(got.status, 403, `${m} ${r} with ${Object.keys(h)[0]}`);
    }
    assert.equal(a.store.db.lights.length, 0, 'nothing was raised');
    const keyed = Object.assign({ 'x-switchboard-key': a.key }, PROXIED[2]);
    assert.equal((await ask(a.url, 'GET', '/api/state', keyed)).status, 200);
    assert.equal((await ask(a.url, 'POST', '/api/decisions', keyed, { agent: 'x' })).status, 200);
    // A browser's live feed cannot send headers: it carries the key in its address instead.
    assert.equal((await ask(a.url, 'GET', `/api/events?key=${a.key}`, PROXIED[2])).status, 200);
    assert.equal((await ask(a.url, 'GET', '/api/events?key=' + 'f'.repeat(32), PROXIED[2])).status, 403);
  } finally { a.close(); }
});

test('a host name other than this computer\'s counts as another device', async () => {
  const a = await start({ port: 0, dir: tmp(), allowedHosts: ['box.tailnet.ts.net'] });
  try {
    const far = { host: 'box.tailnet.ts.net' };
    assert.equal((await ask(a.url, 'GET', '/api/state', far)).status, 403);
    assert.equal((await ask(a.url, 'GET', '/api/events', far)).status, 403);
    assert.equal((await ask(a.url, 'GET', '/api/state', Object.assign({ 'x-switchboard-key': a.key }, far))).status, 200);
    assert.equal((await ask(a.url, 'GET', '/api/state', { host: 'evil.example' })).status, 403, 'a host that was never allowed is still refused');
  } finally { a.close(); }
});

test('the page and /api/health stay open from another device, and health keeps the data folder to itself', async () => {
  const a = await start({ port: 0, dir: tmp() });
  try {
    for (const h of PROXIED) {
      const page = await ask(a.url, 'GET', '/', h);
      assert.equal(page.status, 200); assert.match(page.text, /<html/i);
      const health = await ask(a.url, 'GET', '/api/health', h);
      assert.equal(health.status, 200); assert.equal(health.body.name, 'switchboard'); assert.equal(health.body.data, undefined);
    }
    assert.equal((await ask(a.url, 'GET', '/?key=' + 'f'.repeat(32), PROXIED[0])).status, 403, 'a wrong key link is refused');
  } finally { a.close(); }
});

test('assistants and scripts on this computer are unchanged', async () => {
  const a = await start({ port: 0, dir: tmp() });
  try {
    assert.equal((await ask(a.url, 'GET', '/api/state')).status, 200);
    assert.equal((await ask(a.url, 'GET', '/api/state', { host: 'localhost' })).status, 200);
    assert.ok((await ask(a.url, 'GET', '/api/health')).body.data, 'this computer is told where the data is');
    assert.equal((await ask(a.url, 'POST', '/api/lights', {}, { area: 'A', title: 'From here', agent: 'bot' })).status, 200);
    assert.equal((await ask(a.url, 'GET', '/api/events')).status, 200);
  } finally { a.close(); }
});

test('a proxy that adds only a less common header still counts as another device', async () => {
  const a = await start({ port: 0, dir: tmp() });
  const one = { via: '1.1 proxy', 'x-forwarded-proto': 'https', 'x-forwarded-port': '443', 'x-forwarded-server': 'proxy', 'cf-connecting-ip': '100.1.2.3', 'true-client-ip': '100.1.2.3', 'x-client-ip': '100.1.2.3', 'fastly-client-ip': '100.1.2.3', 'tailscale-user-profile-pic': 'https://example.com/p.png' };
  try {
    for (const [k, v] of Object.entries(one)) assert.equal((await ask(a.url, 'GET', '/api/state', { [k]: v })).status, 403, k);
    assert.equal((await ask(a.url, 'GET', '/api/state')).status, 200, 'this computer, asked directly, is unchanged');
  } finally { a.close(); }
});
