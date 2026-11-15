'use strict';
// The calmer first screen (public/index.html). The page script is not run here as a whole, so these check the two rules
// that decide what a key press answers, by running those functions alone, and that the screen is built from the server's
// groups and counts rather than its own sums.
require('./fixtures/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const code = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function keyRules() {
  const from = code.indexOf('  function yesOf(l)'), to = code.indexOf('  function primary(l)');
  assert.ok(from > 0 && to > from, 'yesOf and noOf sit just before primary()');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(code.slice(from, to), ctx);
  return ctx;
}

test('Enter, Y and the gold button answer the recommended option, even when it is not the first; N answers the other', () => {
  const { yesOf, noOf } = keyRules();
  const no = { options: ['Yes', 'No'], recommended: 'No' };
  assert.equal(yesOf(no), 'No', 'a light that recommends No is answered No by Enter');
  assert.equal(noOf(no), 'Yes');
  assert.equal(yesOf({ options: ['Yes', 'No'], recommended: '' }), 'Yes', 'no recommendation: the first option, as before');
  assert.equal(noOf({ options: ['Yes', 'No'], recommended: '' }), 'No');
  assert.equal(yesOf({ options: ['Mon', 'Wed', 'Neither'], recommended: 'Wed' }), 'Wed');
  assert.equal(noOf({ options: ['Mon', 'Wed', 'Neither'], recommended: 'Wed' }), null, 'N only when there is exactly one other answer');
  assert.equal(yesOf({ options: ['Yes', 'No'], recommended: 'Maybe' }), 'Yes', 'a recommendation that is not a button is ignored');
  assert.equal(yesOf({ options: [] }), null);
  assert.match(code, /act\(l, 'answer', \{ value: yesOf\(l\) \}\)/, 'primary() answers yesOf, not options[0]');
  assert.doesNotMatch(code, /value: l\.options\[0\]/);
});

test('the first screen is built from the server: lanes, broken pinned, one counting line, one area select', () => {
  assert.match(code, /S\.lanes/, 'the three groups come from view().lanes');
  assert.match(code, /bulkAct\(chosen, 'recommended'\)/, 'Take these n sends only the ticked lines');
  assert.match(code, /c\.waiting \+ ' waiting'/); assert.match(code, /c\.total \+ \(areaFilter \? ' in ' \+ area\(areaFilter\)\.name : ' on the board'\)/);
  assert.match(code, /a\.waiting \+ ' waiting'/); assert.match(code, /a\.broken \+ ' broken'/);
  assert.match(code, /'All areas (\\u00b7|·) '/);
  assert.doesNotMatch(code, /'See everything (\\u00b7|·) '/, 'the old pill row is gone');
  assert.doesNotMatch(code, /Take all ' \+ recs\.length/, 'the flat panel of every recommendation is gone');
  assert.match(code, /No impact line from the assistant/);
  assert.match(code, /function brokenBox/); assert.match(code, /B\('Fixed'/);
});

test('passes: 2 min, 10 min and Focus start at once; a swipe only skips; a lined-up post can be copied, opened, and marked sent', () => {
  for (const s of [/\[2, '2 min', '2'\]/, /\[10, '10 min', '0'\]/, /\[0, 'Focus', 'F'\]/, /api\('GET', '\/api\/fit\?minutes=' \+ min \+ \(areaFilter \? '&area=' \+ encodeURIComponent\(areaFilter\) : ''\)\)/, /function finishCard/, /'Another ' \+ again \+ ' min'/]) assert.match(code, s);
  const swipe = code.slice(code.indexOf("addEventListener('touchend'"), code.indexOf("addEventListener('touchend'") + 400);
  assert.match(swipe, /skipped\[l\.id\] = 1/); assert.doesNotMatch(swipe, /act\(|bulkAct\(/, 'nothing is ever accepted by a swipe');
  assert.match(code, /Copy & open (\\u2197|↗)/); assert.match(code, /'Yes, it went'/); assert.match(code, /act\(l, 'ready'\)/);
  assert.doesNotMatch(html, /Send now/);
});

test('the page stays dark only, with no outside scripts or styles', () => {
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.doesNotMatch(html, /<script[^>]+src=/); assert.doesNotMatch(html, /<link[^>]+stylesheet/);
  assert.doesNotMatch(html, /prefers-color-scheme:\s*light/);
});

test('reviewed fixes on the first screen', () => {
  // A copied post is marked sent with the rev of the words that were copied, and a newer draft voids "Did it go?".
  assert.match(code, /asked\[l\.id\] = l\.rev/);
  assert.match(code, /B\('Yes, it went', function \(\) \{ var r = asked\[l\.id\]; delete asked\[l\.id\]; act\(l, 'approve', \{ rev: r \}\); \}\)/);
  assert.doesNotMatch(code, /asked\[l\.id\] = 1/);
  assert.match(code, /l\.rev !== asked\[id\]/);
  // A high-stakes change never folds into an "Approve all" row.
  assert.match(code, /var gk = function \(l\) \{ return !changedAt\[l\.id\] && l\.stakes !== 'high'/);
  // A ticked checkbox does not count as typing, so the keys keep working.
  assert.match(code, /typing = \/INPUT\|TEXTAREA\|SELECT\/\.test\(tag\) && document\.activeElement\.type !== 'checkbox'/);
  // Undo takes an answer off the finish card.
  assert.match(code, /function uncount\(ids\)/);
  // One ticked line reads as one.
  assert.match(code, /chosen\.length === 1 \? 'Take this one'/);
  // The tab counts what is waiting, with broken named apart.
  assert.doesNotMatch(code, /S\.queue\.length \? '\(' \+ S\.queue\.length/);
  // The count line follows the selected area, and See everything lists the same lights.
  assert.match(code, /c = \(areaFilter && area\(areaFilter\)\.counts\) \|\| S\.counts/);
  assert.match(code, /pool = S\.lights\.filter/);
  // A careful light in the list shows its chip and impact line; with no recommendation, a key does not pick an answer.
  assert.match(code, /function careful\(l\)/);
  assert.match(code, /careful\(l\) \? h\('span', \{ class: 'impact'/);
  assert.match(html, /@media \(max-width:640px\)\{ \.areasel\{font-size:16px\} \}/);
});

test('the "Reach out?" drawer is built from the server\'s reachOut list, folded, and the person can push a message there', () => {
  assert.match(code, /\(S\.reachOut \|\| \[\]\)\.map\(light\)/, 'the drawer lists view().reachOut, in the server\'s order');
  assert.match(code, /drawer\('reachout', 'Reach out\? \(' \+ reach\.length \+ '\)'/, 'one folded drawer, never a card in the list');
  assert.match(code, /c\.reachOut \+ ' to reach out'/, 'its own part of the count line, so the parts still add up');
  assert.match(code, /act\(l, 'reach_out'\)/, 'More: Move to Reach out');
  assert.match(code, /act\(l, 'drop', why\.value\.trim\(\) \? \{ why: why\.value\.trim\(\) \} : \{\}\)/, '"Not now" drops it with the reason');
  assert.match(code, /act\(l, 'approve', \{ rev: roShown\[l\.id\] \}\)/, 'an assistant sends only the words that were on screen when the row was opened');
});

test('a list row shows one main button and More…; the headline adds only timed taps', () => {
  // One gold button and More… on every queue row; broken rows (and the broken box) keep their own buttons.
  assert.match(code, /buttons\(l, isSel, l\.state !== 'broken'\)/);
  assert.match(code, /h\('div', \{ class: 'btns one' \+ \(main\.length > 2 \? ' wrap' : ''\) \}\);\n    main\.forEach\(function \(x\) \{ one\.appendChild\(x\); \}\);\n    one\.appendChild\(B\('More\\u2026'/);
  assert.match(code, /if \(moreId === l\.id && l\.state !== 'broken' && moreOf\[l\.id\]\) r\.appendChild\(moreMenu\(l\)\)/);
  // A time is shown only when it is known.
  assert.doesNotMatch(html, /not timed yet/);
  // The headline: minutes from timed taps only (as /api/state seconds), untimed ones a count beside them.
  assert.match(code, /taps = waitingLs\.filter\(function \(l\) \{ return !l\.chore && !l\.unsized; \}\)/);
  // ...and said even when none of them is timed.
  assert.match(code, /if \(untimed\) H\.appendChild\(h\('span', \{ class: 'untimed', text: ' \(' \+ \(taps\.length \? untimed : untimed === 1 \? 'not' : 'none'\) \+ ' timed\)' \}\)\)/);
});

test('a row keeps the gold link to open beside its main button, and a choice with no recommendation shows every answer', () => {
  const from = code.indexOf('  function rowMain(l, kids)'), to = code.indexOf('  function moreMenu(l)');
  assert.ok(from > 0 && to > from, 'rowMain sits just before moreMenu()');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(code.slice(from, to), ctx);
  const el = (tagName, text, className) => ({ tagName, text, className: 'btn' + (className ? ' ' + className : '') });
  const shown = (l, kids) => ctx.rowMain(l, kids).map((x) => x.text);
  // A text to a person: Open in Messages stays on the row; the ghost "I sent it" goes under More…
  assert.deepEqual(shown({ kind: 'approve', channel: 'sms', options: [] }, [el('A', 'Open in Messages'), el('BUTTON', 'I sent it', 'gh'), el('BUTTON', 'Change…', 'gh'), el('BUTTON', 'Drop', 'gh'), el('BUTTON', 'Move to Reach out', 'gh')]), ['Open in Messages']);
  // A choice about a page, no recommendation: the page and every answer, side by side.
  assert.deepEqual(shown({ kind: 'decide', link: 'https://example.com/preview', options: ['Yes', 'No'] }, [el('A', 'Open page ↗'), el('BUTTON', 'Yes', 'gh opt'), el('BUTTON', 'No', 'gh opt'), el('BUTTON', 'Other…', 'gh'), el('BUTTON', 'Snooze', 'gh')]), ['Open page ↗', 'Yes', 'No']);
  // No recommendation, no link: the first answer is not put forward on its own.
  assert.deepEqual(shown({ kind: 'decide', options: ['Brass', 'Black'] }, [el('BUTTON', 'Brass', 'opt'), el('BUTTON', 'Black', 'gh opt'), el('BUTTON', 'Other…', 'gh')]), ['Brass', 'Black']);
  // With a recommendation: the page and the recommended answer.
  assert.deepEqual(shown({ kind: 'decide', link: 'https://example.com/pricing', options: ['Looks right', 'Not yet'], recommended: 'Looks right' }, [el('A', 'Open page ↗'), el('BUTTON', 'Looks right · recommended', 'opt'), el('BUTTON', 'Not yet', 'gh opt')]), ['Open page ↗', 'Looks right · recommended']);
  assert.deepEqual(shown({ kind: 'decide', options: ['Yes', 'No'], recommended: 'Yes' }, [el('BUTTON', 'Yes · recommended', 'opt'), el('BUTTON', 'No', 'gh opt')]), ['Yes · recommended']);
  // A to-do with a link keeps Done as its one button, as before; an agent approval keeps Approve.
  assert.deepEqual(shown({ kind: 'todo', options: [] }, [el('A', 'Open ↗'), el('BUTTON', 'Done', 'gh'), el('BUTTON', 'Snooze', 'gh')]), ['Done']);
  assert.deepEqual(shown({ kind: 'approve', channel: 'agent', options: [] }, [el('BUTTON', 'Approve'), el('BUTTON', 'Change…', 'gh'), el('BUTTON', 'No', 'gh')]), ['Approve']);
  // Option buttons are marked so they can be kept together; editing or a changed light leaves no old More menu behind.
  assert.match(code, /\(\(l\.recommended \? !rec : i \|\| l\.link\) \? 'gh ' : ''\) \+ 'opt'/);
  assert.match(code, /delete moreOf\[l\.id\];/);
  assert.match(code, /var edit = function \(\) \{ [^}]*moreId = null; render\(\); \}/);
  assert.match(code, /snoozeId = null; moreId = null; fit = null; render\(\); \} return; \}/, 'Escape closes More… too');
});
