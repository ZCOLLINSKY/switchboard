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

test('nothing an assistant is told to run prints the key link to it', () => {
  const s = read('SETUP.md'), guide = s.slice(s.indexOf('## 5.'), s.indexOf('## 7.')) + s.slice(s.indexOf('## Rules that always apply'));
  assert.doesNotMatch(guide, /cli\.js" link(?! --open)/, 'setup_guide (steps 5, 6 and the rules) says open_board, or link --open');
  assert.match(guide, /open_board/);
  // The background start keeps nothing it prints, and its error log is the person's alone.
  const bg = s.split('\n').find((l) => /cli\.js" start/.test(l) && /&\)/.test(l));
  assert.ok(bg, 'the background start line is there');
  assert.match(bg, /umask 077/); assert.match(bg, /> \/dev\/null 2>/);
  const two = s.slice(s.indexOf('## 2.'), s.indexOf('## 3.'));
  assert.match(two, /link --open/, 'step 2 opens the link for the person instead of handing it over');
  assert.doesNotMatch(two, /Give them that link/);
});

test('the docs and the connector name the screens the page really has', () => {
  const page = read('public/index.html');
  assert.match(page, /'Your rules'/); assert.match(page, /'Past decisions'/);
  for (const f of ['README.md', 'SETUP.md', 'mcp.js', 'server.js', 'cli.js', 'lib/store.js', 'docs/API.md', 'skill/switchboard/SKILL.md', 'manifest.json', 'public/index.html']) {
    assert.doesNotMatch(read(f), /What did I decide|What runs by itself/i, f);
  }
});

test('the page never assumes a terminal in the repository, and its approve button does not say the board sends', () => {
  const page = read('public/index.html');
  assert.doesNotMatch(page, /in Terminal: node cli\.js/);
  assert.doesNotMatch(page, /Approve & send/);
});

test('the README reads right for someone who is not a developer', () => {
  const r = read('README.md');
  assert.doesNotMatch(r, /Nothing to install\./);
  assert.match(r, /PowerShell/); assert.match(r, /Terminal/);
  const by = r.indexOf('To connect Claude Code by hand'), along = r.indexOf('approve (or paste)');
  assert.ok(along > 0 && along < by, 'what setup asks to change comes before the by-hand command, not after it');
  assert.match(r, /second terminal, in the same folder/);
});

test('the changelog tells someone upgrading from 0.1.0 what to redo now that bin/switchboard.js is gone', () => {
  const c = read('CHANGELOG.md'), up = c.slice(c.indexOf('Upgrading from 0.1.0'), c.indexOf('## 0.1.0'));
  assert.ok(c.includes('Upgrading from 0.1.0'), 'there is an upgrade note');
  assert.match(up, /bin\/switchboard\.js/); assert.match(up, /login item/); assert.match(up, /cli\.js/); assert.match(up, /npm link/);
  assert.ok(!fs.existsSync(path.join(root, 'bin')), 'no shim: a top-level bin/ keeps the plugin out of Claude Desktop chat and Cowork');
});
