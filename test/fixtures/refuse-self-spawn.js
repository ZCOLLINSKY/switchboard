'use strict';
// Mimics Claude Desktop's built-in Node host (app.asar nodeHost): starting process.execPath as a child is refused with
// SelfExecBlockedError / ERR_MCP_NODE_HOST_NOT_NODE, delivered as an 'error' event on the child.
const cp = require('child_process'), path = require('path');
const proto = cp.ChildProcess.prototype, orig = proto.spawn;
const refused = path.join(path.dirname(process.execPath), '.built-in-node-refused');
proto.spawn = function (o) {
  if (o && o.file === process.execPath) {
    this.prependListener('error', (e) => { if (e.path === refused) { e.code = 'ERR_MCP_NODE_HOST_NOT_NODE'; e.message = 'The built-in Node.js runtime cannot start "node" as a Node.js subprocess (child_process.fork or process.execPath).'; } });
    return orig.call(this, Object.assign({}, o, { file: refused, args: [refused].concat((o.args || []).slice(1)) }));
  }
  return orig.call(this, o);
};
