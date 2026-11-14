'use strict';
// Loaded (through NODE_OPTIONS) into a program a test starts, when the test must prove that nothing reaches the usual
// port, 4747, where the person's real board may be running. Every request to that port and every listen on it is
// refused and written to GUARD_LOG, never made. Programs this one starts inherit the guard.
const fs = require('fs'), net = require('net');
const note = (what) => { try { fs.appendFileSync(process.env.GUARD_LOG, what + '\n'); } catch (e) { /* no log named */ } };
const usual = (port) => String(port) === '4747';

const realFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  let u = null; try { u = new URL(String(url && url.url ? url.url : url)); } catch (e) { /* not a URL: let fetch say so */ }
  if (u && usual(u.port)) {
    note(`${(opts && opts.method) || 'GET'} ${u.href}`);
    return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('refused by the test guard'), { code: 'ECONNREFUSED' }) }));
  }
  return realFetch.apply(this, arguments);
};

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  const port = args[0] && typeof args[0] === 'object' ? args[0].port : args[0];
  if (usual(port)) {
    note(`listen ${port}`);
    process.nextTick(() => this.emit('error', Object.assign(new Error('listen on 4747 refused by the test guard'), { code: 'EACCES' })));
    return this;
  }
  return listen.apply(this, args);
};
