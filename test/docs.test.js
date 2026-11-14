'use strict';
// What the setup guide tells an assistant to run must work as written.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('every "claude mcp add" line puts each -e after the server\'s name and before --', () => {
  for (const f of ['SETUP.md', 'README.md']) for (const line of read(f).split('\n').filter((l) => /claude mcp add/.test(l))) {
    const name = line.indexOf(' switchboard '), dash = line.indexOf(' -- ');
    assert.ok(name > 0 && dash > name, `${f}: ${line}`);
    for (let i = line.indexOf(' -e '); i >= 0; i = line.indexOf(' -e ', i + 1)) assert.ok(i > name && i < dash, `${f}: -e in the wrong place: ${line}`);
  }
});

test('the phone step gives the board its own HTTPS port and never takes over the root of tailscale serve', () => {
  const s = read('SETUP.md');
  assert.match(s, /tailscale serve --bg --https=8443 4747/);
  assert.match(s, /https:\/\/your-machine\.your-tailnet\.ts\.net:8443\/\?key=/);
  assert.doesNotMatch(s, /tailscale serve --bg 4747/);
});

test('setup asks for a stable key on every light, and proves the loop with a light any session can collect', () => {
  const s = read('SETUP.md'), five = s.slice(s.indexOf('## 5.'), s.indexOf('## 6.')), six = s.slice(s.indexOf('## 6.'), s.indexOf('## 7.'));
  assert.match(five, /stable `key`/);
  assert.match(six, /for_anyone: true/);
  assert.match(six, /stable `key`/);
});
