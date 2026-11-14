'use strict';
// Every test file requires this first, so the tests give the same result whatever the person running them has set.
// On load it removes every SWITCHBOARD_* setting and BROWSER from the test's own process and gives it a throwaway home
// folder: nothing in a test can fall back to a real board (port 4747) or a real data folder.
// A program a test starts gets its settings from childEnv() alone.
const fs = require('fs'), os = require('os'), path = require('path');
const clean = (env) => { for (const k of Object.keys(env)) if (/^SWITCHBOARD_/i.test(k) || k === 'BROWSER') delete env[k]; return env; };
clean(process.env);
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sbhome-'));
process.env.HOME = HOME; process.env.USERPROFILE = HOME;

// The settings for a program a test starts: no SWITCHBOARD_* setting except the ones the test names here (undefined
// or '' leaves one out), and the throwaway home. Without a port named, a program is sent to port 1, where no board
// answers and none can be started, so a test that forgot to name its board fails instead of reaching a real one on 4747.
function childEnv(set = {}) {
  const env = clean(Object.assign({}, process.env));
  env.HOME = HOME; env.USERPROFILE = HOME; env.SWITCHBOARD_PORT = '1';
  for (const [k, v] of Object.entries(set)) {
    if (v != null && v !== '') env[k] = String(v);
    else if (k !== 'SWITCHBOARD_PORT') delete env[k];
  }
  return env;
}

// A port nothing listens on right now, chosen by the system.
const freePort = () => new Promise((ok, fail) => {
  const s = require('net').createServer().once('error', fail).listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
});

module.exports = { childEnv, freePort, HOME };
