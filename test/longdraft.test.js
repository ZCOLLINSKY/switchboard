'use strict';
// A long draft on the board shows its first lines and "Show all" (then "Show less"). Only what is shown is cut: every
// Copy and Copy & open button copies the whole draft. The open row, a pass card, the Needs-you card (through Inspect)
// and the Reach out drawer all show drafts the same way.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const code = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function clipDraft() {
  const from = code.indexOf('  function clipDraft(t)'), to = code.indexOf('  function draftText(');
  assert.ok(from > 0 && to > from, 'clipDraft sits just before draftText');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(code.slice(from, to), ctx);
  return ctx.clipDraft;
}
const lines = (n) => Array.from({ length: n }, (_, i) => `Line ${i + 1}: Hi Pat, the Acme Lighting crew will be there Tuesday.`).join('\n');

test('about five lines: up to six show whole; more show the first five and say how many there are', () => {
  const clip = clipDraft();
  for (const n of [1, 5, 6]) assert.deepEqual(JSON.parse(JSON.stringify(clip(lines(n)))), { text: lines(n), clipped: false, lines: n });
  const c = clip(lines(30));
  assert.equal(c.clipped, true); assert.equal(c.lines, 30);
  assert.equal(c.text, lines(5) + '…');
  // One long paragraph with no line breaks is cut too, at a word, never mid-word.
  const para = 'Hi Pat, '.concat('the fixtures for the Acme Lighting job are in and ready to go. '.repeat(20));
  const p = clip(para);
  assert.equal(p.clipped, true); assert.ok(p.text.length <= 501, p.text.length);
  assert.ok(para.startsWith(p.text.slice(0, -1)));
  assert.match(p.text, /\S…$/); assert.ok(para[p.text.length - 1] === ' ', 'cut where a word ends');
  assert.equal(clip('').clipped, false); assert.equal(clip(null).text, '');
});

test('Show all and Show less, wherever a draft is shown; copying always takes the whole draft', () => {
  assert.match(code, /'Show less' : 'Show all' \+ \(c\.lines > 6 \? ' \(' \+ c\.lines \+ ' lines\)' : ''\)/);
  // The open row and a pass card (details), the Reach out drawer, and what was approved: all through draftText.
  assert.match(code, /\} else if \(l\.draft\) pane\.appendChild\(draftText\(l, l\.draft\)\);/);
  assert.match(code, /'What would go out' \}\), draftText\(l, l\.draft\)\)\)/);
  assert.match(code, /draftText\(l, l\.approvedText\)/);
  assert.doesNotMatch(code, /h\('p', \{ text: l\.draft \}\)/, 'no draft is shown uncut anywhere else');
  // A pass card and the Needs-you card (Inspect) show their draft through details().
  assert.match(code, /var d = details\(l, true\); if \(d\) card\.appendChild\(d\);/);
  assert.match(code, /if \(openId === l\.id\) \{ var d = details\(l, true\); if \(d\) r\.appendChild\(d\); \}/);
  // Copy text and Copy & open copy l.draft itself, never the shortened text.
  assert.match(code, /function copyOpen\(l\) \{\s*return B\('Copy & open ↗', function \(\) \{ copyText\(l\.draft\);/);
  assert.ok((code.match(/copyText\(l\.draft\)/g) || []).length >= 3);
  assert.match(code, /navigator\.clipboard\.writeText\(l\.draft\)/);
  assert.doesNotMatch(code, /copyText\(clip|writeText\(clip|copyText\(c\.text/);
  // The row's line under the title: a long message to a person shows its first lines and says to open it.
  assert.match(code, /lines: open it to read them all\)/);
});
