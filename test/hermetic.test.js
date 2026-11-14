'use strict';
// The tests give the same result whatever the person running them has set: a real board on 4747, SWITCHBOARD_HOME
// exported in their shell, another HOME. Here the test files that start other programs run again under settings that
// point everywhere wrong, and must still pass.
const { childEnv } = require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();

test('every test file loads the clean settings first', () => {
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8'), first = src.search(/require\(/);
    assert.ok(first >= 0 && src.startsWith("require('./fixtures/env')", first), `${f} must require ./fixtures/env before anything else`);
  }
});

test('the tests that start other programs pass whatever SWITCHBOARD_* settings and HOME the caller has', async () => {
  const starts = files.filter((f) => f !== path.basename(__filename) && /\b(spawn|execFile|execFileSync|fork)\(/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  assert.ok(starts.length >= 2, 'found the test files that start programs');
  const wrong = fs.mkdtempSync(path.join(os.tmpdir(), 'sbwrong-'));
  fs.writeFileSync(path.join(wrong, 'server.lock'), JSON.stringify({ pid: 1, id: 'x', url: 'http://127.0.0.1:1', host: os.hostname(), at: 0 }));
  const env = childEnv({ SWITCHBOARD_PORT: '1' });
  // Pointing everywhere wrong, and nowhere real: port 1 never answers, 127.0.0.2 is not this computer's address.
  Object.assign(env, { HOME: wrong, USERPROFILE: wrong, SWITCHBOARD_HOME: wrong, SWITCHBOARD_URL: 'http://127.0.0.1:1', SWITCHBOARD_AGENT: 'someone-else',
    SWITCHBOARD_HOST: '127.0.0.2', SWITCHBOARD_ALLOWED_HOSTS: 'example.invalid', SWITCHBOARD_IN_PROCESS: '1', BROWSER: path.join(wrong, 'no-browser') });
  delete env.NODE_TEST_CONTEXT; // run as a test run of its own, not as part of this one
  const out = await new Promise((ok) => {
    // Its own process group, so a run that hangs is stopped with everything it started.
    const c = spawn(process.execPath, ['--test'].concat(starts.map((f) => path.join(__dirname, f))), { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let text = ''; c.stdout.on('data', (d) => { text += d; }); c.stderr.on('data', (d) => { text += d; });
    const stop = setTimeout(() => { text += '\nnot ok: stopped after 120 seconds'; try { process.kill(-c.pid, 'SIGKILL'); } catch (e) { c.kill('SIGKILL'); } }, 120000);
    c.on('close', (code) => { clearTimeout(stop); ok({ code, text }); });
  });
  assert.equal(out.code, 0, out.text.split('\n').filter((l) => /✖|not ok|Error/.test(l)).slice(0, 20).join('\n'));
});
