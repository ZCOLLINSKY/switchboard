#!/usr/bin/env node
'use strict';
// Builds the browser demo: one HTML file in which the real board (server.js, lib/store.js, scenarios) runs as a
// simulation with made-up data, so someone can try Switchboard without installing anything. Nothing it does leaves the
// browser. Usage: node scripts/build-demo.js [out.html] [scenario]   (default dist/demo/index.html, morning)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'demo', 'index.html'));
const scenario = process.argv[3] || 'morning';
const MODULES = ['server.js', 'lib/store.js', 'scenarios/index.js'];

function build(outFile = out, scenarioName = scenario) {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  // Inside an inline script, "</script" would end it early; "<\/script" means the same to JavaScript.
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  // A file's #! line is only allowed at the very top of a file, not inside a function.
  const body = (f) => safe(read(f).replace(/^#!.*\n/, '\n'));
  const files = MODULES.map((f) => `${JSON.stringify(f)}: function (module, exports, require, __dirname, __filename, setTimeout, setInterval, clearTimeout, clearInterval) {\n${body(f)}\n}`).join(',\n');
  const runtime = safe(read('scripts/demo-runtime.js'));
  const version = JSON.parse(read('package.json')).version;
  const banner = `<div id="demo-bar" style="position:sticky;top:0;z-index:100;background:#1d2433;color:#e8ecf3;font:14px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center;border-bottom:1px solid #2c3547">`
    + `Demo with made-up data. It runs only in your browser and sends nothing anywhere; reload to start over. `
    + `<a href="https://github.com/ZCOLLINSKY/switchboard#install" style="color:#f4c34f">Get Switchboard ${version}</a></div>`;
  let page = read('public/index.html');
  const inject = `<script>\n(function () {\nconst DEMO_SCENARIO = ${JSON.stringify(scenarioName)};\nconst FILES = {\n${files}\n};\n${runtime}\n})();\n</script>`;
  if (!/<head>/i.test(page) || !/<body[^>]*>/i.test(page)) throw new Error('public/index.html has no <head> or <body>');
  page = page.replace(/<head>/i, (m) => `${m}\n<meta name="robots" content="noindex">\n${inject}`);
  page = page.replace(/<body([^>]*)>/i, (m) => `${m}\n${banner}`);
  page = page.replace(/<title>([^<]*)<\/title>/i, '<title>Switchboard demo</title>');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, page);
  return { out: outFile, bytes: page.length };
}

if (require.main === module) { const r = build(); console.log(`Wrote ${r.out} (${Math.round(r.bytes / 1024)} kB).`); }
module.exports = { build };
