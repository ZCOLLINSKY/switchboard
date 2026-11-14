// Runs inside the browser demo (built by scripts/build-demo.js), before the page's own script. It gives the real board
// (server.js, lib/store.js, scenarios) the few Node features it uses, starts it as a simulation with made-up data, and
// answers the page's /api requests from it. Nothing leaves the browser. FILES is defined by the build.
'use strict';
/* global FILES, DEMO_SCENARIO */
const G = typeof window !== 'undefined' ? window : globalThis;

// --- files, in memory -------------------------------------------------------------------------------------------
const norm = (p) => { const out = []; for (const s of String(p).split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return '/' + out.join('/'); };
const mem = new Map(), dirs = new Set(['/']);
const enoent = (p) => Object.assign(new Error(`ENOENT: no such file, '${p}'`), { code: 'ENOENT' });
const fs = {
  readFileSync(p) { p = norm(p); if (!mem.has(p)) throw enoent(p); return mem.get(p); },
  writeFileSync(p, d) { mem.set(norm(p), String(d)); },
  appendFileSync(p, d) { p = norm(p); mem.set(p, (mem.get(p) || '') + String(d)); },
  existsSync(p) { p = norm(p); return mem.has(p) || dirs.has(p); },
  statSync(p) { p = norm(p); if (!mem.has(p)) throw enoent(p); return { size: mem.get(p).length, mtimeMs: Date.now(), isFile: () => true, isDirectory: () => false }; },
  readdirSync(p) { const pre = norm(p).replace(/\/$/, '') + '/'; return [...mem.keys()].filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length)); },
  unlinkSync(p) { mem.delete(norm(p)); },
  mkdirSync(p) { dirs.add(norm(p)); },
  chmodSync() {},
  realpathSync(p) { return norm(p); },
  renameSync(a, b) { a = norm(a); b = norm(b); if (!mem.has(a)) throw enoent(a); mem.set(b, mem.get(a)); mem.delete(a); },
  createReadStream() { throw new Error('The demo serves no files.'); },
};
const path = {
  sep: '/',
  join: (...a) => norm(a.filter((x) => x != null && x !== '').join('/')),
  resolve: (...a) => norm(a.filter((x) => x != null && x !== '').join('/')),
  dirname: (p) => { const n = norm(p); return n.slice(0, n.lastIndexOf('/')) || '/'; },
  basename: (p, ext) => { let b = norm(p).replace(/.*\//, ''); if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length); return b; },
};
const os = { homedir: () => '/demo', hostname: () => 'demo', tmpdir: () => '/tmp' };

// --- hashing and random bytes --------------------------------------------------------------------------------------
function sha1hex(str) {
  const b = new TextEncoder().encode(String(str)), l = b.length, words = new Uint32Array((((l + 8) >> 6) + 1) * 16);
  for (let i = 0; i < l; i++) words[i >> 2] |= b[i] << (24 - (i % 4) * 8);
  words[l >> 2] |= 0x80 << (24 - (l % 4) * 8); words[words.length - 1] = l * 8;
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80), rol = (x, n) => (x << n) | (x >>> (32 - n));
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 80; t++) w[t] = t < 16 ? words[i + t] : rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let [a, bb, c, d, e] = [h0, h1, h2, h3, h4];
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (bb & c) | (~bb & d) : t < 40 ? bb ^ c ^ d : t < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rol(a, 5) + f + e + k + w[t]) >>> 0; e = d; d = c; c = rol(bb, 30) >>> 0; bb = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}
const hex = (n) => { const a = new Uint8Array(n); G.crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); };
const crypto = {
  randomBytes: (n) => { const h = hex(n); return { toString: () => h }; },
  createHash: () => { let d = ''; const o = { update(x) { d += String(x); return o; }, digest: () => sha1hex(d) }; return o; },
};

// --- the board's web server, answering in this page -----------------------------------------------------------------
let handler = null;
const http = {
  createServer(opts, h) {
    handler = typeof opts === 'function' ? opts : h;
    const srv = { listen(port, host, cb) { setTimeout(cb, 0); return srv; }, address: () => ({ port: 4747 }), close(cb) { if (cb) cb(); }, on() { return srv; }, once() { return srv; } };
    return srv;
  },
};
G.process = G.process || { env: {}, pid: 1, platform: 'browser', versions: {}, execPath: '', stdout: { isTTY: false }, kill() { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); }, once() {}, on() {}, exit() {} };
G.Buffer = G.Buffer || { concat: (cs) => ({ toString: () => cs.map((c) => c.s).join('') }), byteLength: (s) => new TextEncoder().encode(String(s)).length };

// Node's timers have unref() (do not keep the process alive); a page has no process to keep alive, so it does nothing.
const T = (fn) => (...a) => { const id = fn(...a); return { id, unref() { return this; }, ref() { return this; }, hasRef: () => true, [Symbol.toPrimitive]: () => id }; };
const C = (fn) => (t) => fn(t && typeof t === 'object' ? t.id : t);
const TIMERS = [T(G.setTimeout.bind(G)), T(G.setInterval.bind(G)), C(G.clearTimeout.bind(G)), C(G.clearInterval.bind(G))];

// --- a small CommonJS loader for the board's own files ---------------------------------------------------------------
const builtins = { fs, path, os, crypto, http };
const cache = {};
function load(file) {
  if (cache[file]) return cache[file].exports;
  const module = { exports: {} }; cache[file] = module;
  const dir = path.dirname('/' + file);
  const require = (name) => {
    if (builtins[name]) return builtins[name];
    let f = norm(dir + '/' + name).slice(1);
    if (!FILES[f]) f = FILES[f + '.js'] ? f + '.js' : f + '/index.js';
    if (!FILES[f]) throw new Error(`The demo has no ${name}`);
    return load(f);
  };
  FILES[file](module, module.exports, require, '/app/' + path.dirname('/' + file).slice(1), '/app/' + file, ...TIMERS);
  return module.exports;
}

// --- start it, and answer the page ----------------------------------------------------------------------------------
const KEY = hex(16);
fs.mkdirSync('/sim'); fs.writeFileSync('/sim/page.key', KEY);
try { G.localStorage.setItem('switchboard-key', KEY); } catch (e) { /* the page asks for the key link; the demo still answers */ }
const started = load('server.js').start({ sim: true, scenario: DEMO_SCENARIO || 'morning', port: 4747, host: '127.0.0.1', dir: '/sim' });
G.__switchboardDemo = { started, files: mem };

function serve(method, url, headers, body, onWrite, onClose) {
  return started.then(() => new Promise((resolve) => {
    const on = {}, req = {
      method, url, headers: Object.assign({ host: '127.0.0.1:4747', 'x-switchboard-key': KEY }, headers || {}), socket: { remoteAddress: '127.0.0.1' },
      on(ev, fn) {
        if (ev === 'data') setTimeout(() => { if (body) fn({ s: body, length: body.length }); }, 0);
        else if (ev === 'end') setTimeout(fn, 0);
        else if (ev === 'close' && onClose) onClose(fn);
        return req;
      },
      destroy() {},
    };
    let status = 200; const hdrs = {}, chunks = [];
    const res = {
      writeHead(c, h) { status = c; Object.assign(hdrs, h || {}); return res; }, setHeader(k, v) { hdrs[k] = v; },
      write(s) { if (onWrite) onWrite(String(s)); else chunks.push(String(s)); return true; },
      end(s) { if (s != null) chunks.push(String(s)); resolve({ status, hdrs, body: chunks.join('') }); }, on() { return res; },
    };
    handler(req, res);
  }));
}
const isApi = (u) => u.origin === G.location.origin && /\/api\//.test(u.pathname);
const apiPath = (u) => u.pathname.slice(u.pathname.indexOf('/api/')) + u.search;
const realFetch = G.fetch ? G.fetch.bind(G) : null;
G.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url, G.location.href);
  if (!isApi(u)) return realFetch(input, init);
  const r = await serve((init && init.method) || 'GET', apiPath(u), init && init.headers, init && init.body ? String(init.body) : '');
  return new Response(r.body, { status: r.status, headers: r.hdrs });
};
const RealES = G.EventSource;
G.EventSource = function DemoEventSource(url) {
  const u = new URL(url, G.location.href);
  if (!isApi(u)) return new RealES(url);
  const es = new EventTarget(), closers = [];
  es.readyState = 0; es.url = u.href;
  es.close = () => { es.readyState = 2; closers.splice(0).forEach((f) => f()); };
  let buf = '';
  serve('GET', apiPath(u), {}, '', (s) => {
    buf += s; let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = (block.match(/^event: (.*)$/m) || [])[1], data = (block.match(/^data: (.*)$/m) || [])[1];
      if (ev && es.readyState !== 2) { const m = new MessageEvent(ev, { data }); es.dispatchEvent(m); }
    }
  }, (fn) => closers.push(fn));
  setTimeout(() => { if (es.readyState === 2) return; es.readyState = 1; const o = new Event('open'); es.dispatchEvent(o); if (es.onopen) es.onopen(o); }, 0);
  return es;
};
