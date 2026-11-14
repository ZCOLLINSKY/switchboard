'use strict';
// Mimics a Node upgrade that removed the running node binary (Homebrew deletes the old version's folder while sessions
// still use it): starting process.execPath as a child fails with ENOENT, which is not Claude Desktop's refusal.
const cp = require('child_process'), path = require('path');
const proto = cp.ChildProcess.prototype, orig = proto.spawn;
const gone = path.join(path.dirname(process.execPath), '.removed-by-an-upgrade', 'node');
proto.spawn = function (o) {
  if (o && o.file === process.execPath) return orig.call(this, Object.assign({}, o, { file: gone, args: [gone].concat((o.args || []).slice(1)) }));
  return orig.call(this, o);
};
