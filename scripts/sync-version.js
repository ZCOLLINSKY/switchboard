#!/usr/bin/env node
'use strict';
// package.json holds Switchboard's version. This copies it into the Claude Code plugin and the Claude Desktop bundle,
// changing nothing else in them. `npm version 0.3.0` runs it (the "version" script in package.json), so a release is:
//   npm version 0.3.0 && npm test
// Usage by hand: node scripts/sync-version.js [folder]
const fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error(`package.json has no plain version (found "${version}").`); process.exit(1); }
for (const f of ['.claude-plugin/plugin.json', 'manifest.json']) {
  const file = path.join(root, f), was = fs.readFileSync(file, 'utf8');
  if (!/"version": "[^"]*"/.test(was)) { console.error(`${f} has no "version" to set.`); process.exit(1); }
  const now = was.replace(/"version": "[^"]*"/, `"version": "${version}"`); // the first one is the top-level version
  if (JSON.parse(now).version !== version) { console.error(`${f}: the first "version" in it is not its own.`); process.exit(1); }
  if (now !== was) { fs.writeFileSync(file, now); console.log(`${f}: ${version}`); }
}
