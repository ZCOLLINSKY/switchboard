# Adversarial run, 13 Nov 2026

Run on commit `6b57af2` (61 tests). Five attackers each took one angle; a separate skeptic then had to reproduce
every claim with its own script, and was told to refute it. A claim nobody could reproduce would have been dropped.

**Result:** 40 claims, 40 reproduced (22 as claimed, 18 real but less severe than claimed), 0 refuted.
15 are fixed and 3 part fixed in batch 5 (`test/batch5.test.js`), together with the five residual risks from the
re-review (R1 to R5 in that file). 22 were open after batch 5; batch 6 fixed 19 of them and part of the other three. Left: P6 (button focus across redraws) and N7 (scale past a few thousand lights).

Severity is the skeptic’s, not the attacker’s.

| ID | Severity | Verdict | What happens | Status |
|---|---|---|---|---|
| A2 | high | as claimed | After the person approves, the recipient and the assistant's own note can still be changed by any caller, and the approval is handed over with the new ones | fixed (R2) |
| N1 | high | as claimed | A date-only due ("2026-11-20") reads "Overdue" for the whole of the 20th, and from the evening of the 19th in US time zones | fixed |
| N3 | high | as claimed | An assistant whose time estimates are exactly right gets them multiplied by 9, and a 2-minute approval is relabelled an 18-minute chore and leaves the headline | fixed |
| P1 | high | as claimed | A draft swapped while you read it is approved without a word: the live refresh hands the button the new rev | fixed |
| S1 | high | as claimed | "Try again" on a failed light always issues a fresh approval: a failed "No" or answer comes back as "approve", a failed spot-check is closed as passed, and a retry that was sent is recorded as failed | fixed |
| S3 | high | as claimed | Raising again with the same key silently throws away `state`: a customer's reply on a blue (or sent-back) light never turns gold, and the follow-up timer later erases the reply draft | fixed |
| A1 | medium | real, less severe than claimed (high) | The undo window can be skipped: a message raised as "broken" has no hold, and any approval can be reported before it is released | part fixed: a report inside the hold is refused; a message raised as broken still has no hold |
| A3 | medium | real, less severe than claimed (high) | Raising again with the same key silently drops state, outbound and kind: a customer's reply never shows as needing you, and the timer later erases the drafted answer | fixed (with S3) |
| A4 | medium | real, less severe than claimed (high) | The board says "sent" or "approved" when neither happened, and a failure reported afterwards is dropped without a word | fixed in batch 6: a later "failed" wins; a repeat report warns; a message cannot be reported "done" or acknowledged; "approved" cannot be set by update; "by" is never taken from the caller |
| A5 | medium | real, less severe than claimed (high) | Earned autonomy: any assistant can ride a rule with a free-text instruction, turn the approved light into a message to a person, and remove or rewrite the look; a flag misses the rule if the light was moved | mostly fixed in batch 6: an automatic light is frozen until reported and while a look is open; the flag demotes the rule that ran. A rule now also belongs to the assistant that earned it |
| A6 | medium | as claimed | A message with a recipient but no "outbound: true" gets none of the message protections, and no warning | fixed in batch 6: a light with a "to" is treated as a message to a person |
| A8 | medium | as claimed | Six places where the tools and docs tell an assistant one thing and the server does another | fixed in batch 6: tool schema has work_minutes and holds_up; cut text and unknown update fields warn; waiting is for the raiser and says it collects; dump and loading examples are page-only, clearing examples is open |
| N4 | medium | as claimed | The stopwatch runs from the previous tap, not from when the light was shown; one "Approve all 12" then rewrites a job type's whole timing history, and the reading-speed check is skipped | part fixed: the stopwatch starts when a light appears; a bulk tap is still stored per row |
| N5 | medium | as claimed | The third snooze asks for a date; pick one more than 90 days out and the light comes back in 2 days, with no message | fixed in batch 6: a date that cannot be honoured is refused (limit one year); the date box has min and max |
| P2 | medium | real, less severe than claimed (high) | A tap can land on a light that took that place a moment ago (list rows and the rapid card) | fixed in batch 6: arrivals wait while the person is at the board; a tap on a row that moved in the last 400 ms is refused; the rapid card stays until decided or skipped. Not done: the "Just now" strip still pushes the list down |
| P3 | medium | as claimed | Timer and live refreshes wipe what is being typed, and can send it to the wrong place | fixed in batch 6: every field in the list keeps its text, focus and caret across redraws; timers and live events wait while something is being typed |
| P4 | medium | as claimed | Enter and S act on a selected row that scrolling never follows, so a key can decide something that is not on screen | fixed in batch 6: arrows keep the selection in view; a deciding key on an off-screen row only scrolls to it |
| S2 | medium | real, less severe than claimed (high) | Take back restores the wrong set of fields: after a slip on a spot check, "Flag it" no longer switches the rule off; taking back a snooze rolls an assistant's newer draft back; "Take it back" then Z erases a se | fixed in batch 6: a take-back restores only what that tap changed; spot checks and flags can be taken back; history honours a restored decision |
| S4 | medium | as claimed | The board's own overlays (failed, keep-chasing, not-collected) outlive the state they describe: a redrafted light cannot be approved, "Try again" throws a TypeError and half-applies, and a dropped light comes b | fixed |
| S6 | medium | as claimed | The "approved and not yet collected" guard only covers four fields: an update with state `broken` wipes the approval, `done` closes it as handled, and `to` changes who it goes to | fixed (R2) |
| S8 | medium | as claimed | A light with no `agent` can never be collected by a caller that names itself: the README's own script example is never handed its decision, and approvals on a board saved by the first build stay blue forever | fixed |
| X1 | medium | real, less severe than claimed (high) | The page key is handed to every other local web server the person opens (cookies on 127.0.0.1 are not separated by port) | fixed in batch 6: no cookie; the page keeps the key per address and port and sends it in a header |
| X2 | medium | real, less severe than claimed (high) | POST /api/complete needs no key and works inside the hold: it ends the undo window, returns the approved text, and reports "sent" seconds after the tap | fixed (R3): no report inside the hold |
| X4 | medium | as claimed | A container named "Constructor" makes /api/state fail permanently: one un-keyed POST and the board says "Switchboard is not answering" | fixed |
| X5 | medium | as claimed | wait_for_decision tells the first and only collector that the decision was collected before | fixed (R4) |
| X7 | medium | as claimed | The one-writer lock is left behind by every ordinary stop and believed on any live pid; and two starts at the same moment both get through | fixed in batch 6: a lock is believed only if its owner answers; removed on SIGINT, SIGTERM and SIGHUP; taken in one step |
| A7 | low | real, less severe than claimed (medium) | The rev is 40 bits: an assistant that writes both texts can find two that share it in about ten seconds, and a stale page then approves text the person never saw | fixed in batch 6: the rev is the whole hash |
| N2 | low | real, less severe than claimed (medium) | "Dec 13", "12/13" and a Unix time in seconds are accepted as due dates in 2001 and 1970, with no warning, and pin the light above today's real deadline | part fixed: dates before 2020 are refused with a warning |
| N6 | low | as claimed | Changing follow_up_days on a blue light changes the number and not the timer; setting it to 0 does not stop the follow-up | fixed in batch 6 |
| N7 | low | real, less severe than claimed (medium) | Scale: every change makes every open tab download the whole board again, and "I have N minutes" is quadratic (8.3 s with the server frozen at 20,000 lights) | partly fixed in batch 6: one lookup per fit, live reloads are coalesced. Still open: whole-board reload per change and whole-file save |
| N8 | low | as claimed | One board, three counts: the headline says 3, the row under it says 42, and the command line says "42 need you (about 1 min)" for 2.75 hours of chores | fixed in batch 6: counts are rows everywhere; the CLI prints the same sentence as the page |
| P5 | low | real, less severe than claimed (medium) | Opening the simulation makes the real board read-only in the same browser (one cookie name for every port) | fixed in batch 6 (same change as X1) |
| P6 | low | real, less severe than claimed (medium) | Keyboard-only use breaks: Space never presses a button, focus is thrown away on every refresh, and rapid mode leaves the covered list in the Tab order | partly fixed in batch 6: Space presses a focused button; the list behind rapid mode is inert; the toast is announced. Still open: focus on a button is lost when the list redraws |
| P7 | low | real, less severe than claimed (medium) | A deadline that arrives while you work stays behind "1 new" with the headline under-counting, and a group of changes with a deadline can be folded away | fixed in batch 6: the headline counts held arrivals, the pill says when one is due soon, a group with a deadline is never folded |
| P8 | low | as claimed | Three places where the screen's own numbers are not true: "I have N minutes" refills, the release countdown stands still, skipped cards count as done | fixed in batch 6: "I have N minutes" runs down and ends; the countdown ticks; skips are counted apart |
| S5 | low | real, less severe than claimed (medium) | `complete` names the light, not the decision: a late or repeated report lands on the next decision, marks a message nobody was handed as sent, and ends its take-back window | fixed (R3) |
| S7 | low | real, less severe than claimed (medium) | A refused call can still change the board: bulk approve applies the lights before the one that fails, and an update with an oversized payload still swaps the draft; neither is saved or logged until some later w | fixed in batch 6: a refused call is rolled back to the last save; payload is checked before anything is written |
| X3 | low | real, less severe than claimed (medium) | Any website can collect every pending decision with a plain GET: Take back stops working and the "nobody collected it" alarm never fires | fixed: collecting is a JSON POST |
| X6 | low | real, less severe than claimed (medium) | Opening the simulation link signs the browser out of the real board, and the reverse (both use the cookie sb_page on 127.0.0.1) | fixed in batch 6 (same change as X1) |
| X8 | low | as claimed | A board tab opened by another site approves the top light on the first Enter: no click, no selection, no focus check | fixed in batch 6: Enter, S and E decide nothing until the person has touched the tab |

## The five residual risks from the re-review

| # | Risk | Status |
|---|---|---|
| R1 | A manual "I sent it" entered the execution queue | fixed: the decision closes as sent by the person; assistants are told once under `sent_by_you` |
| R2 | The fingerprint did not cover payload or attachments; the recipient could change after approval | fixed: both are in the fingerprint; everything approved is frozen until collection; the decision carries the approved copies |
| R3 | Completion was keyed by light, not decision | fixed: a report names its `decision_id`; a report for a replaced decision is refused |
| R4 | Owner filtering was not an exclusive claim | fixed: collecting claims a decision for 10 minutes; nobody else is handed it meanwhile |
| R5 | A retry after an uncertain send was not reconciled | fixed: outcome `unsure` asks the person "It went out / It did not go out"; collected-and-silent is flagged; a retry carries `retry_of` |

## What the attackers tried that held

### state machine and record integrity

- Baseline: npm test, 61 pass. git status clean after my runs; nothing in the project was touched. All scratch files are under a scratch folder (repros in a scratch folder to s8.js).
- Double approve (stale tab / held key): second approve refused with "This one is already handled.", store byte-identical.
- Approve with the rev that was on screen after an assistant changed the draft: refused "This changed. Look again.", store unchanged.
- Undo after an assistant collected: refused "Too late: your assistant already has it.", store unchanged.
- Keyed re-raise onto an approved, uncollected light: refused by the update guard, store unchanged (the gap is fields the guard does not list, see S6).
- Hold: a message decision is not handed at +30 s, is handed at +61 s with collected_before false, and a second fetch returns the same decision_id with collected_before true.
- complete() repeated with 'sent', and 'failed' after 'sent': no change at all. 'sent' after 'failed' moves the light on correctly.
- Uncollected approval after 3 days: red, stuck, approved text intact; an assistant arriving late still gets the same text and the light returns to approved.
- Undo after the 15-minute timer turned the light red: restores gold, kind approve, decision null, and history no longer lists the undone approval.
- Follow-up timer: the sent text is kept in l.sent and returned as sent_before in need_drafts; the timer never clears a live decision's text.
- Bulk approve with one stale rev, with a message to a person in the list, or with an unknown id: refused before any light changes (store unchanged in all three).
- Third snooze without a date: refused, store unchanged; snoozing does not reset goldSince (age kept).
- release_at more than a day out: refused, decision untouched.
- approve / no / answer / done on blue (waiting_them) and green (auto) lights: all refused, store unchanged.
- Archive after 31 days: a completed light moves to archive.jsonl and history still finds it ("approved, sent"); a done light whose decision was never collected is kept in the main file and is still handed out after a reload from disk.
- "Not like this" (redo): light goes queued; an assistant update before collecting is refused; after collecting, update to need_you with a new draft works and clears the decision.
- load() of version 1/2 trust data (numeric streaks, auto: {type: true}, autoCount): streaks and auto are reset to empty, version becomes 3, view() works. Old-shape undo objects (type + numeric streak) undo cleanly. A version 2 board (written by commit 8ef530b's
- events.jsonl made unwritable during save: save throws, the event buffer is kept, and the next good save writes the 'decided' line (no loss short of a process kill between the data.json rename and the log append, which I did not count as a finding).
- Fuzz: 2,500 random sequences of 80 calls across raise / update / act (16 actions) / bulk / decisions / decisionFor / complete / ack / tick / promote, comparing the store before and after every throw. act() alone never changed the store on a throw (the one exce
- move of a light to another container: the streak key follows the new container; a rule promoted in one container did not auto-approve after the move.
- Seen but left out as lower value: the follow-up counter is never reset by a reply, so the first silence after a new message already asks "Keep chasing?"; attachments, link, source and note are not part of rev, so swapping an attachment after it is shown does n

### security: the page key, the HTTP surface and the page

- Host header / DNS rebinding: LOCALHOST, LocalHost:port, trailing dot (127.0.0.1.), 127.0.0.1:port:80, localhost.evil.example, 127.0.0.1@evil.example, 0.0.0.0, 127.1, decimal and hex IP forms, an empty Host, no Host at all (HTTP/1.0), two Host headers, and an a
- JSON-only writes: text/plain, form-urlencoded, multipart (even with 'application/json' hidden in a parameter), 'text/plain; application/json' and a missing content-type all got 415. OPTIONS preflight answers 404 with no Access-Control-Allow-Origin, so a cross-
- Page-only calls without the key: no cookie, empty value, wrong key, upper-case key, key plus a suffix, quoted key, upper-case cookie name, 31-character prefix all got 403. Path tricks (trailing slash, double slash, /ACT, %61ct, ;x, /./, /x/../, //x/, #) got 40
- Framing: X-Frame-Options DENY, frame-ancestors 'none', nosniff and no-store are on every response kind checked (page, API, 403, 404, the key redirect, the event stream).
- Key leakage without the data folder: the key is not in /api/state, /api/health, /api/decisions, /api/history, /api/fit, the page HTML or server.lock. The key redirect goes to '/', so the key is not in the address or the Referer afterwards.
- File modes on a fresh folder: folder 700; data.json, events.jsonl, page.key and server.lock 600; no temp file left behind. A folder left by an older version (755 with 644 files) becomes 700 on the first write (events.jsonl itself stays 644 inside the 700 folde
- Body size and depth: a 1.2 MB body is cut off; JSON nested 400,000 deep answers 400 and the server stays up; a 4 KB payload nested 2,000 deep is stored and /api/state still works; null, array, string, number and wrong-typed fields answer 400 or are coerced, wi
- Prototype pollution: __proto__ and constructor keys in raise, payload, a key re-raise, areas, ack, complete, dump, bulk revs, promote, demote, learn and settings left Object.prototype clean. (The inherited-name lookup that does break is X4.)
- Script injection in the page: the page builds everything with text nodes and textContent, no innerHTML. link and attachment links starting with javascript:, data:, a leading space or hidden in an array are dropped; phone is reduced to digits and +; a container
- Header injection: nothing from a request is copied into a response header; the Set-Cookie value is the validated 32-hex key and Location is the fixed '/'.
- Connection load: 1,500 open /api/wait calls and 1,500 unread /api/events streams at once: /api/state still answered in 1 to 4 ms, a write took 7 to 21 ms, and the server survived all of them being reset. The seconds parameter clamps to 1-50.
- The lock in the plain case: a second start while the first is running (same process or a later process) is refused with the first one's address.
- Weak spots seen but not reported as findings: (1) 'start --open' and 'sim --open' pass the link with the key as an argument to open/xdg-open, where other accounts can see it in the process list for a moment; read from bin/switchboard.js:20 and :32 only, not ru
- Not tested: whether a title can imitate the Just-now strip or the read-only banner, right-to-left override characters and very long strings. These need real rendering; only the fact that all text goes in as plain text nodes was checked.

### a confused or hostile assistant

- approve, bulk, promote, demote, settings, undo and release with no page cookie or a wrong one: all 403. Path tricks (trailing slash, upper case, %2f, double slash): 404, never the action.
- Raising a light directly in state approved or done: refused (400). (Setting approved later through update is not refused; see A4.)
- Collecting inside the hold: get_decisions, all=1 and a 2-second wait_for_decision inside the default 60-second hold all returned nothing.
- A plain draft swap after the page drew the light: refused with "This changed. Look again."
- Changing draft, title, change_to or state need_you on an approved, uncollected light, and a keyed re-raise onto it: all refused with the "already approved" message.
- Streak gaming: 30 bulk approvals across 3 days gave no streak; 10 single approvals on one day gave no offer and promote was refused; the offer appeared only after approvals on 3 different days.
- A promoted rule did not fire for a light raised with a draft, a recipient, outbound, a phone number, another container, state queued, kind decide, or no change fields.
- The brake: the 21st automatic run in an hour paused the rule; an assistant closing and reopening the "Keep going?" light did not unpause it, and the next raise asked.
- action_type, outbound, channel, phone, agent and key sent to update_light: ignored with a warning each (the keyed re-raise path is the exception, A3).
- Storage limits: a payload over 4 KB refused; a 1.1 MB body dropped; payload nested 3,000 deep and a body nested 400,000 deep answered 400 and the server kept answering.
- Flood: 1,500 maximum-size lights went in at about 38 ms each (20 MB data.json, 13 MB /api/state) and the server stayed responsive. Note: there is no cap on live lights, and a due date in the past put all 1,500 in the "never fold" group.
- Writes sent as text/plain: 415. Host header evil.example: 403. A wrong ?key= link: 403. /api/state without the cookie says canAct false.
- DID NOT HOLD, left out of the eight as lower impact: the headline minutes. Ten replies the person really takes about 90 s each over read 900 s honestly, 10 s when each is raised with seconds:1 and its own action_type (the correction is per job type and needs t
- DID NOT HOLD, lower impact: update_light has no owner check. Two calls (state broken, then need_you) brought back a light the person had snoozed for 7 days; one call each dropped the person's own note and closed another assistant's failure. update_light state 

### the page under real use

- Four clicks on one Done button (two at once, one 30 ms later, one after the redraw): one decision; the late click on the stale button was refused with 'This one is already handled.' (page-script-run). What a real double-tap hits after the rows shift could not 
- Held Enter (one keydown plus 16 repeats) on the 'Approve all 8' group row: one bulk approval of 8, repeats ignored.
- Enter guard on change rows: Enter approves row 1; a second Enter 150 to 380 ms after the next row took the selection is ignored; 450 ms later it approves one more. Works as designed (one unread change per ~0.5 s of Enter presses is the design's limit, not a bu
- Message row in the list: first Enter only opens it, Enter 100 ms later is ignored, Enter 450 ms later approves. First-time recipient: Enter refuses with 'First time writing to them: use the button, not Enter.'
- 'Approve all' on stale membership: two look-alikes arrived while the pointer was moving and waited in the pill; the button read 'Approve all 4' and approved exactly those 4; the one with a different change-to stayed a single row. The handler only ever sends th
- Read-only browser (no cookie): the banner is shown; tapping Approve gives the 403 text in a toast and changes nothing. Buttons are still drawn as if live, which is a wording choice, not a break.
- Take back after the hold: the strip is gone and Z does nothing; no stale Take back button is left behind.
- Third-snooze date: empty and yesterday are refused with 'Pick a day after today.'; tomorrow is accepted.
- Rapid mode Skip (Right arrow) and Esc: skip moves to the next card and lowers the count, Esc closes and redraws the list; an edit box in rapid mode survives an ordinary live update (the live handler pauses while editing).
- 2,400 random button presses and keys across all six scenarios (morning, slammed, comeback, trusted, clear, first-day): no page script error and no unhandled rejection.
- 500 gold lights: view() 5.5 ms, /api/state 510 KB, save 2.3 ms; page script 10 to 12 ms per state change with all 500 rows drawn (6,712 elements). Script cost only: layout and paint were not measured.
- Markup injection: the page builds every node with textContent, createTextNode and setAttribute (no innerHTML or eval in the file); the server limits container colours to #rrggbb and links and attachments to http(s).
- History search ('?water' in the bar): results come back and focus stays in the bar. Note: the panel is drawn at the bottom of the page (after the queue and the container grid) with no scroll and no toast, so on a long board it looks as if nothing happened.
- Contrast, computed from the CSS tokens (not measured in a browser): row text, tags, buttons and the toast pass 4.5:1. Near misses, not reported as a finding: footer key list 4.46:1, dump-bar placeholder 4.16:1, chips on two palette colours 4.33 and 4.45, sleep
- Tap heights at 640 px and under, computed from the CSS: buttons 42.8 px, pills 36.8 px, text links (Show everything, Close, What did I decide?) 17.4 px, toast 'Move to' buttons 21.8 px, 6 px gaps. Not measured in a browser.
- Not tested for lack of a browser: horizontal overflow at 390 px in each scenario and with long unbroken strings, focus-ring visibility, and which button a real double-tap lands on.

### time, numbers and scale

- Baseline: npm test, 61 pass. I ran no git commands and wrote nothing inside the project; all scripts are in a scratch folder (N1.js to N8.js plus the p*.js probes).
- Quiet hours and the 7:45 am offer across both US clock changes (Mar 8 and Nov 1, 2026) in New York and Los Angeles, and in Tokyo: quiet starts at 6:30 pm and ends at 7:30 am local, 'morning' is always 7:45 am local on the right day (4.25 to 14.25 hours away), 
- release_at to 7:45 am: the decision is refused to an assistant one millisecond before 7:45 and handed out at 7:45, in every case above.
- Tier boundary: due exactly 24 h away is 'due within a day', 24 h + 1 ms is not; overdue lights sort oldest first and keep their `keep` flag; end of day in fit() is 23:59:59.999 local and midnight is tomorrow.
- System clock moved back 2 hours right after an approval: nothing leaves early. The hold stretches (strip says leaves in 7199 s), the 15-minute watchdog fires late, follow-ups are absolute times. Only cosmetic damage: the red alert can read 'Approved -60 minute
- Collect watchdog with default settings: a message approved at T turns red at T+16.01 min (15 minutes after its 60-second hold ends), not before; text and decision stay.
- Hold per kind of decision, default holds: the strip's 'until' matched the first moment an assistant could collect in all eight cases (message approve 60 s; change approve, answer, drop, no, redo 20 s; to-do done and broken-job answer 0 s). The zero hold on to-
- The brake's one-hour window across a restart: 15 automatic runs, save, reopen the store, 7 more 30 minutes later: paused on the 21st with the 'Keep going?' light. The window is saved with the rule.
- Odd numbers for seconds, work_minutes, value, batch, progress and follow_up_days (NaN, Infinity, negatives, 0, 0.4, 1e21, '12abc', '', {}): all refused with a warning, nothing crashes or stores a bad value. Small quirks only: true becomes 1, '0x10' becomes 16,
- /api/fit minutes with NaN, text, negative, 0, 0.4, 1e21, Infinity: no crash; anything unusable becomes 1 minute; Infinity returns every light with minutes: null.
- fit() never returned more than fits in any run (5 x 100 s into 5 minutes gives 3; overdue and due-today go first). One thing that matches the documented rule but is worth knowing: at 6 pm, a 6-minute job due 9 am tomorrow (first row of the queue, tier 0) is le
- Three-different-days rule: counted in local calendar days and correct across the Nov 1 clock change. Literal reading holds, but ten approvals at 11:58 pm, the next day, and 12:01 am the day after satisfy it in just over 24 hours.
- 'Cleared today' resets at local midnight, including the 25-hour night.
- Page snooze choices (run from the page's own function with a faked clock): 'Tonight 8 pm', 'Tomorrow 8 am' and 'Monday 8 am' land on 8:00 local across both clock changes, year end, and on a Monday (goes to next Monday). 'In 2 days' is 48 hours and so lands an 
- Chores with seconds over 900 and no work_minutes: listed as a chore, counted in chores.minutes (1200 s gives 20 min), not in the headline; consistent.
- Median with an even count takes the lower middle ([10, 100] gives 10): a small low bias, not reported as a finding.
- Scale, no problem found: tick() 0.4 ms at 20,000 lights; decisions() 2.6 ms; history() over 50,000 events 6 to 13 ms after a one-time read of about 55 ms (the log is read once, not per call); keyed re-raise 1 ms; archiving 20,000 finished lights in one tick 57



## Deep dig, Nov 13-14: ten lanes, new methods

Ten lanes on a frozen copy of 6d71f41, each with a method the first run did not use: property fuzzing of the rules (620 seeds x 400 operations, about 45 invariants), HTTP fuzzing, an attack on the newest code, crash and corruption testing (200+ kill cycles), the MCP protocol, a real browser, a stranger's assistant following SETUP.md, a full busy day lived as the person, three attacker models, and executing every documented claim. A skeptic re-ran every claim from the first wave. The second wave's skeptics and the completeness critic did not run (usage limit), so 69 claims are marked "not re-checked".

228 claims: 223 real (3 high), 5 refuted or already known (H5 (already known), U12 (already known), T4 (refuted), D23 (already known), D26 (refuted)). Fixes are in batches 7 to 9 (commits 794f0bb onward): 142 tests, plus real-browser checks of the page. Every lane's repro script was re-run against the final code; a script that now exits 0 is marked fixed. Where a script still reported, the status below is a judgement after running it: many test the old wording, the fix they proposed, or crash on the new refusal; those are marked with the test or browser check that covers them. Several fuzz-lane findings (F21-F34) came from an agent that wrote its repros before the limit stopped it; they were triaged from the repros.

| # | Severity | Skeptic | Finding | Status |
|---|---|---|---|---|
| B21 | high | not re-checked | "Try again" and "It did not go out" re-send the old words to the old recipient, while the card shows the corrected ones under "What will be sent" | fixed (test B21) |
| F1 | high | as claimed | Typing anything in "Other…" on the "Keep going?" brake card switches automatic approval back on | fixed: board cards accept only their buttons (test F1) |
| U1 | high | as claimed | Edit a reply, tap the big gold "Approve & send", and the assistant's old text goes out instead of yours | fixed: checked in a real browser |
| B1 | medium | real, less severe | The short report (ack_decisions) closes an approved message nobody collected, and the board shows it as sent | fixed (its repro passes) |
| B2 | medium | real, less severe | A customer's reply that arrives on a "Keep chasing?" card cannot be approved, and the first button erases it | fixed (test B2) |
| B3 | medium | as claimed | A customer message that arrives while an assistant is mid-send never reaches you, and the follow-up timer later wipes its draft | fixed (test B3) |
| B4 | medium | as claimed | A question asked on a failed card: your answer is recorded as "left as failed" and never handed to the assistant | fixed (its repro passes) |
| B7 | medium | as claimed | "Collected, never reported" is only a number in the header: you cannot see which light or do anything about it | fixed (its repro passes) |
| B8 | medium | as claimed | A customer's new message on a thread you snoozed stays hidden until the snooze ends | fixed (its repro passes) |
| B22 | medium | not re-checked | After "Save & approve", the "did it go out?" card shows the assistant's old draft and never the words you approved | fixed: failed and not-sure cards show what you approved |
| B23 | medium | not re-checked | "I sent it" is never told to the assistant if the thread moves before its next check | fixed (its repro passes) |
| B24 | medium | not re-checked | An automatic change that keeps failing keeps its right to run by itself | fixed (test B24) |
| B29 | medium | not re-checked | A follow-up on a text you send yourself cannot be written or recorded | fixed: Write it on the card |
| B30 | medium | not re-checked | A claim cannot be kept alive: a batch that takes over 10 minutes to send is handed to a second session and flagged as abandoned | fixed: progress from the collecting assistant keeps the claim (test B30) |
| B32 | medium | not re-checked | "Try again" on a failed flag comes back to the assistant as an ordinary approval of the flagged change | fixed (test B15/B32) |
| C3 | medium | as claimed | Lights loaded during setup can only be collected by an assistant started in the Switchboard folder | fixed (its repro passes) |
| C12 | medium | as claimed | With a custom data folder and port, the MCP command in step 3 quietly starts a second, empty board and puts the lights there | fixed (its repro passes) |
| C21 | medium | not re-checked | Command-line flags written the usual way are ignored without a word: "--port=5000" starts on the default port, "start --help" starts the board, "demo --help" loads the examples | fixed (its repro passes) |
| C22 | medium | not re-checked | A board started in the background cannot be stopped by anything the documents or the command offer, and a second start points to an address that cannot approve | fixed (its repro passes) |
| C23 | medium | not re-checked | "link" run in a terminal without the data-folder setting prints a link with an old key; the board refuses it and tells the person to run "link" | fixed: link reads the key of the board that is running (the script now gets the page, not a refusal) |
| C25 | medium | not re-checked | SETUP's start command fails with no message in a sandboxed assistant shell, and "check again" runs before the board is listening | fixed: SETUP waits for the board and says where its start log is |
| C26 | medium | not re-checked | A container marked "asleep until a date" still puts its lights at the top of the queue and in the headline | fixed (its repro passes) |
| C27 | medium | not re-checked | A snoozed light cannot be woken early, and snoozed, running, gone-quiet and queued lights cannot be opened, dropped or moved from the page | fixed (its repro passes) |
| C32 | medium | not re-checked | A snooze can outlast the light's own deadline: the overdue light stays hidden and the board reads "0 lights need you" | fixed (its repro passes) |
| C34 | medium | not re-checked | An assistant that has only the MCP tools cannot give the person a link that can approve | by design: assistants are never given the page key; the person runs the link command |
| C35 | medium | not re-checked | Editing a text she sends from her own phone: her words are recorded as sent, and the page gives no way to send them | fixed (its repro passes) |
| C36 | medium | not re-checked | A "waiting on someone" light made the way SETUP says comes back as a message to write, with nobody to send it to and without a message's protections | fixed: a wait on something that is not a message comes back as "Check on: …" |
| F2 | medium | as claimed | An approved change (from -> to) is not in the decision the assistant collects, and can be swapped after collection while the light still says approved | fixed: the change travels with the decision and stays frozen until reported (test F2) |
| F3 | medium | as claimed | Typed answers on "Not sure it went out" and "Keep chasing?" cards are read as the wrong button | fixed (test F3) |
| F4 | medium | as claimed | A quick note with more than 12 things files 12 and silently drops the rest | fixed: all 15 are filed (the script compares lower-cased titles with "Sam"); long notes up to 4,000 characters |
| F5 | medium | as claimed | A quick note is cut in two at an initial or short form followed by a capital letter | fixed (its repro passes) |
| F6 | medium | as claimed | After one "This changed. Look again." on a blue light, every button on the page stops working until reload | fixed: checked in a real browser (G1) |
| G1 | medium | as claimed | One refused tap on a light that changed freezes the whole page until it is reloaded | fixed (its repro passes) |
| G2 | medium | real, less severe | Answer buttons (Yes / No / options), Done and No carry no fingerprint: a page that is behind answers a question the person never saw | fixed: every tap carries what was on screen (test G2) |
| G3 | medium | as claimed | On a phone, a long recipient or attachment name is cut off and cannot be read before "Approve & send" | fixed (its repro passes) |
| G6 | medium | as claimed | Enter answers a "read this page for me" light with its first option, although nothing is marked as the Enter action | fixed (its repro passes) |
| G8 | medium | as claimed | A customer's reply (blue turning gold) arrives as "This changed while it was on your screen" with only a Look again button | fixed (its repro passes) |
| G9 | medium | as claimed | "Approve all N, all the same change" hides and approves a light whose note says not to | fixed: a change with a note is never folded into Approve all |
| G21 | medium | not re-checked | Quick mode shows a failed message, or one that may already have gone out, as an ordinary card: the reason and the warning are left out, and Enter re-sends it | fixed (its repro passes) |
| G22 | medium | not re-checked | With six tabs of the board open, a seventh stays blank and taps are silently parked, then land by themselves when a tab is closed | fixed: one live feed per board, shared by every tab (checked with eight tabs) |
| G23 | medium | not re-checked | "Approve all 40" is one tap; taking it back is 40 taps in 20 seconds, and there is no "Take back all" | partly: "Take back all" on the strip and in the toast; the forty single buttons still race the hold |
| G24 | medium | not re-checked | A double press of Z, or a double-click on Take back, takes back two different decisions | by design: two presses of Z take back two things; a double click is now one click |
| G25 | medium | not re-checked | A double-click on "Switch it off" leaves automatic approval switched on, and a double-click on "Let it run" accepts two offers | fixed (its repro passes) |
| G26 | medium | not re-checked | Edit a message you send yourself, tap "Copy text" or "Open in Messages": the assistant's old words are what gets copied or opened | fixed (its repro passes) |
| G27 | medium | not re-checked | The "approved faster than it can be read" guard counts time the message spent hidden | fixed: the reading clock starts when a held arrival is shown |
| G28 | medium | not re-checked | A draft that is not marked as a message to a person shows only its first 120 characters, and Enter approves all of it from the closed row | fixed (its repro passes) |
| H2 | medium | real, less severe | ack_decisions closes an approval nobody was handed: the board says the message went out and the assistant that should send it never gets it | fixed: the key-less ack is refused |
| H10 | medium | as claimed | A message longer than 4,000 characters is cut mid-word with no warning, and the cut text is what gets approved and sent | fixed: refused, never cut (test) |
| H22 | medium | as claimed | A rule you approved with "Always" can be erased by any assistant, silently, and the board asks you the same question again | fixed: the rule is kept apart and still applies |
| H23 | medium | as claimed | Any caller can mark your real container as an "example"; the examples banner appears on your real board and "Clear the examples" deletes the container | fixed (its repro passes) |
| K1 | medium | as claimed | The "ack" shortcut marks an approved message as sent when no assistant was ever handed it | fixed (its repro passes) |
| K3 | medium | as claimed | The same assistant opened in another folder is a stranger: it never gets the approval, and the same thread key makes a second light | by design, changed: see M10; a key held by another assistant now warns |
| K4 | medium | as claimed | A quick note the assistant turns into a draft (as the skill says) can be approved but is never handed to any assistant | fixed (its repro passes) |
| K5 | medium | as claimed | Long text is cut without a warning, and the cut text is what gets approved and sent | fixed: a draft that would be cut is refused (test K5) |
| K6 | medium | as claimed | A background job reported as failed the way the skill says shows an "Approve" button and hides its fix options | fixed (test K6) |
| K7 | medium | as claimed | Only approvals are watched: an answer or a "Not like this" that no assistant collects disappears quietly | fixed: a count of answers no assistant has picked up |
| K9 | medium | as claimed | An update with a wrong field name is accepted with no warning, so the old draft stays on screen | fixed (its repro passes) |
| M1 | medium | as claimed | A draft or quoted email containing the Unicode line-separator character makes the raise_light call vanish | fixed (its repro passes) |
| M3 | medium | as claimed | An abandoned wait_for_decision still collects the decision, for nobody | fixed (its repro passes) |
| M11 | medium | as claimed | Long drafts, attachments, answer buttons and phone numbers are cut or dropped with no warning | fixed: what is cut is reported, and a draft that would be cut is refused |
| U2 | medium | as claimed | A brand-new request says "This changed while it was on your screen" and hides its buttons | fixed (its repro passes) |
| U3 | medium | as claimed | After one "This changed. Look again." message the whole page stops accepting taps | fixed: checked in a real browser |
| U4 | medium | as claimed | "Take back" puts the light back but does not show it: it hides behind a "1 new · show" pill | fixed (its repro passes) |
| U21 | medium | not re-checked | A snoozed light cannot be woken: 20 seconds after the tap there is no way to get it back before its time | fixed (its repro passes) |
| U22 | medium | not re-checked | 'Approved, not yet sent' with no assistant running: after one minute the page offers no way to stop the message | fixed (its repro passes) |
| U23 | medium | not re-checked | She rewrites a reply, the assistant updates the draft meanwhile, she presses Save: 'This changed. Look again.' and her rewrite is gone | fixed (its repro passes) |
| U24 | medium | not re-checked | Typing a word when the cursor is not in the bar runs it as commands, and the rest lands in a customer's message | fixed (its repro passes) |
| U25 | medium | not re-checked | 'Keep asking me' is for ever: the offer to let a change run by itself never comes back and there is no button to ask for it | fixed (its repro passes) |
| U26 | medium | not re-checked | After tapping 'Always', the standing rule for drafts is invisible and cannot be changed or removed | fixed (its repro passes) |
| U27 | medium | not re-checked | After midnight, 'Tomorrow, 8 am' and the S key skip the coming morning | fixed: after midnight the menu offers This morning, 8 am |
| U29 | medium | not re-checked | A message approved late at night goes out at night unless a small button is tapped within 60 seconds | open, a design choice: whether a message approved at night should wait for the morning by default |
| U31 | medium | not re-checked | 'What did I decide?' shows 'approved, sent' with the time of her tap; the time the message really went out is nowhere | fixed (its repro passes) |
| U34 | medium | not re-checked | 'Snooze all' hides eight lights for exactly 48 hours with no word about when, and undoing it takes eight taps | fixed (its repro passes) |
| U35 | medium | not re-checked | A background job that went quiet: board says 'All clear', its dot stays green, it is counted twice, and nothing can be done about it | fixed (its repro passes) |
| U42 | medium | not re-checked | An edited text message can only be marked 'sent': 'Open in Messages' still opens the old words | fixed (its repro passes) |
| B5 | low | real, less severe | Take back after answering "did it go out?" leaves a card that looks the same but no longer works | fixed (its repro passes) |
| B6 | low | real, less severe | "It did not go out" and "Try again" re-send with no hold, while the strip still offers Take back | fixed (its repro passes) |
| B9 | low | real, less severe | update_light's reply hands back your approval (id and edited words) inside the hold, and that id is enough for anyone to report it sent | fixed (its repro passes) |
| B10 | low | as claimed | "Leave it" is not final: a repeated failure report turns the closed light red again, and a late "sent" is half-recorded | fixed (test B10) |
| B11 | low | as claimed | "I sent it" is told to assistants at once, before you can take the tap back, and never corrected | fixed: told after the take-back window, and waiting then answers sent_by_you (the script asks inside the window) |
| B12 | low | as claimed | Due dates: a bare pre-2020 date slips past the check, impossible dates roll into the next month, and other date spellings mean the start of the day | fixed: other spellings are whole days; 2019 refused (test B12) |
| B13 | low | as claimed | An assistant whose name is over 80 characters, or has a space at either end, can raise lights but is never handed their decisions | fixed (its repro passes) |
| B14 | low | as claimed | Thread keys are cut at 120 characters without a word, so two threads with long keys become one light | fixed (its repro passes) |
| B15 | low | as claimed | "Flag it" on a spot check reaches the assistant about 10 minutes late | fixed (its repro passes) |
| B16 | low | as claimed | A to-do raised by a script that gives no name: your "Done" is never handed out by get_decisions, and the light is never archived | changed: an answer nobody collects leaves after 90 days, not 30 |
| B25 | low | not re-checked | "One more follow-up" brings three more before the board asks again, and removes "They replied" | fixed (its repro passes) |
| B26 | low | not re-checked | Dropping the "Keep going?" card leaves the rule paused for good | fixed: see F24 |
| B27 | low | not re-checked | "Try again" on a failed "Not like this" closes the light, and the new draft lands on a second light | fixed (its repro passes) |
| B28 | low | not re-checked | A follow-up text the assistant already prepared is ignored after "One more follow-up" | fixed (its repro passes) |
| B31 | low | not re-checked | In the simulation, "Not like this" is reported as sent and the card never comes back | fixed: the simulation redrafts what was sent back |
| C1 | low | real, less severe | SETUP step 6 says to allow 20 seconds, but an approved message is held 60 seconds, or 120 if tapped quickly | fixed (its repro passes) |
| C2 | low | real, less severe | SETUP tells the assistant to remove the examples with clear_examples, which the board always refuses | fixed (its repro passes) |
| C4 | low | real, less severe | README's first command ('start --open') crashes the board on a computer with no browser-opener program | fixed (its repro passes) |
| C5 | low | as claimed | On a non-default port, 'list', 'raise' and 'demo' say the board is not running and point to a command that is then refused | fixed (its repro passes) |
| C6 | low | as claimed | If another program already uses the port, SETUP's check passes, the start fails unseen, and the message blames Switchboard | fixed (its repro passes) |
| C7 | low | real, less severe | SETUP step 7 (keep it running) creates a job that restarts for ever, and as written cannot find node | documented: SETUP now uses the full path of node and restarts only after a crash; a login item written the old way still fails |
| C8 | low | as claimed | SETUP asks 'should anything stay asleep until a date?' but gives no way to do it, and most dates are dropped without a word | fixed (its repro passes) |
| C9 | low | as claimed | A container can never be renamed or removed, so one typo during setup stays for ever | fixed (its repro passes) |
| C10 | low | real, less severe | Opened by its plain address, the empty welcome screen hides that it is read-only and its 'Show me examples' button does nothing | fixed (its repro passes) |
| C11 | low | as claimed | The first screen after loading examples (or after the assistant loads real lights) reads '0 lights need you. Go build.' | fixed (its repro passes) |
| C13 | low | as claimed | An update with a misspelt field is accepted in silence, and a bad link 'ignored' in fact wipes the good one | fixed (its repro passes) |
| C14 | low | as claimed | The README's command-line example can never be collected the way the README says, yet /api/wait hands it out | fixed (its repro passes) |
| C15 | low | as claimed | The habits file tells assistants to set work_minutes and holds_up, which the MCP tools do not declare | fixed (its repro passes) |
| C16 | low | as claimed | Following the documents, opening the board from a phone ends at a 403 | fixed (its repro passes) |
| C17 | low | as claimed | From the command line, a draft that starts with two dashes is stored as the word 'true' | fixed (its repro passes) |
| C18 | low | as claimed | 'I have 10 minutes' reports minutes made only of guesses on a board where nothing is timed yet | fixed: a partly guessed time budget says so |
| C24 | low | not re-checked | SETUP step 6 and two error messages tell the person to run "switchboard link", a command the documented install never creates | fixed: messages give the full command; README mentions npm link |
| C28 | low | not re-checked | Opened from another device, "Copy text" copies nothing and says nothing | not fixed: Copy text needs a secure address; over a plain private-network address it opens the row instead |
| C29 | low | not re-checked | Started on the IPv6 local address (--host ::1), the board prints a link no browser can open | fixed (its repro passes) |
| C30 | low | not re-checked | SWITCHBOARD_HOME written as "~/..." creates a folder literally called "~" in whatever folder the board was started from | fixed (its repro passes) |
| C31 | low | not re-checked | "sim" reads the scenario name only as the first word; anywhere else it starts "morning" without saying so | fixed (its repro passes) |
| C33 | low | not re-checked | If the Switchboard folder has a space in its path, SETUP's commands break as printed, and the start command breaks silently | fixed: SETUP quotes every path |
| D1 | low | real, less severe | When a save fails, the call says "error" but the change stays on the running board, and a restart forgets it | by design: a failed save is reported to the caller and rolled back |
| D2 | low | real, less severe | A crash in the instant decisions are handed over leaves approved messages with nobody for ten minutes, then returns them with a false "may have gone out" warning | by design: a decision handed over during a crash comes back with needs_check, the safe side |
| D3 | low | as claimed | The MCP tool restarts a dead board and silently repeats the call: one raise_light becomes two lights, and get_decisions answers "nothing" | fixed (test: a write is never repeated blindly) |
| D4 | low | real, less severe | One damaged line in events.jsonl makes "What did I decide?" answer nothing, for good, with no error | fixed (its repro passes) |
| D5 | low | as claimed | A data.json that is readable but is not a board is opened as an empty board and overwritten, with no warning and no copy kept | fixed (test d5) |
| D6 | low | as claimed | Every crash during a save leaves a full copy of the board behind as data.json.<number>.tmp, and nothing ever removes them | fixed (test: leftovers are tidied) |
| D7 | low | as claimed | If the computer clock is set back after an assistant collected a message, its "sent" report is refused with a false reason | fixed (its repro passes) |
| D8 | low | as claimed | The board trusts the computer clock with no sanity check: a corrected clock skips the take-back window, and one timer pass with a wrong clock changes the board for good | not fixed: a clock jump of days is not guarded |
| D9 | low | as claimed | A due date that does not exist is accepted without warning and becomes a different day | fixed (its repro passes) |
| D10 | low | as claimed | If the data folder (or its lock file) is removed while the board runs, a second board can start on the same data and they overwrite each other | not fixed: removing the data folder while the board runs |
| D11 | low | as claimed | The 30-day archive pass freezes the board on a large pile and fails for good at about 125,000 finished lights | fixed (its repro passes) |
| D12 | low | as claimed | Finished lights can end up in neither file: they leave data.json before they are written to the archive | fixed (its repro passes) |
| D13 | low | as claimed | If data.json is a link to a file in a synced or backed-up folder, the first save replaces the link and the synced copy silently stops updating | fixed (its repro passes) |
| D14 | low | as claimed | Opening the board page while the app's page file is missing stops the whole board | fixed (its repro passes) |
| D15 | low | real, less severe | Light ids are 8 random characters that are never checked for repeats; when two lights share one, taps on the second land on the first | fixed: new ids are checked against existing ones |
| D16 | low | as claimed | After a restart, taking back a snooze is logged as taking back the approval, so a message that is then sent never appears in "What did I decide?" | fixed (its repro passes) |
| D17 | low | as claimed | When the board will not start, assistants using the MCP tool only hear "not reachable and could not be started"; the real reason is thrown away | fixed (its repro passes) |
| D21 | low | real, less severe | Two tool calls at the same moment while the board is off start two boards; on a new data folder the link that "switchboard link" prints is then refused | not fixed (rare): two tool calls at the same moment while the board is off |
| D22 | low | as claimed | Once the log passes about 512 MB, "What did I decide?" answers nothing for everything before the last start, with no error; just under that size the first search freezes the board for seconds | not fixed: a log over 512 MB |
| D24 | low | real, less severe | If data.json comes back older than the log beside it, an approval the log records as sent is handed out again as new work | not fixed: restoring an older data file next to a newer log |
| D25 | low | as claimed | After following "Fix or move the file", the board starts empty with no warning although its own log beside it lists the open lights | fixed (test D25) |
| D27 | low | as claimed | A change made to data.json while the board is running is silently undone by the next save | by design: the server is the only writer; edit data.json only while it is stopped |
| D28 | low | real, less severe | The 60-second Take back window keeps running while the board is down; the assistant's next check restarts the board and is handed the message in that same call | not fixed: the hold keeps running while the board is down |
| F7 | low | as claimed | Taking back an older tap restores the trust count from that moment, wiping out a later "No" or "Flag it" | fixed (its repro passes) |
| F8 | low | as claimed | A slip followed by Take back still marks the recipient as known and sets the time estimate | fixed (its repro passes) |
| F9 | low | as claimed | Drop, Snooze and Move are accepted on lights that are no longer asking | fixed: refused (test F9) |
| F10 | low | as claimed | A bare date skips both date checks; a huge number is stored as a due date that is not a date | fixed (its repro passes) |
| F11 | low | as claimed | wait_for_decision hands out what get_decisions refuses | fixed (its repro passes) |
| F12 | low | as claimed | ack_decisions stops half-way: the call is refused but earlier lights in the list are already closed | fixed (its repro passes) |
| F13 | low | as claimed | "Snoozed twice already" counts for the whole life of a thread | fixed (test F13) |
| G4 | low | as claimed | Rapid mode on a phone: a pasted link as a title makes the card three screens wide and pushes Skip, Snooze and Drop off screen | fixed: long titles wrap |
| G5 | low | real, less severe | With two tabs, a Snooze tapped on a stale copy of a just-approved message removes its Take back | fixed: only an asking light can be snoozed (test F9) |
| G7 | low | as claimed | In a browser without the key, the empty board shows no read-only notice and "Show me examples" / "Clear the examples" do nothing, silently | by design: clearing the examples is allowed from any browser; loading them is not |
| G10 | low | real, less severe | A double-click on "Always" writes the same rule into the container's voice note twice | fixed (its repro passes) |
| G11 | low | as claimed | In the "What did I decide?" search box the cursor jumps to the end after every letter | fixed (its repro passes) |
| G12 | low | real, less severe | After the server comes back, the page keeps saying "not answering, reload this page" over an old board for up to a minute | fixed (its repro passes) |
| G13 | low | as claimed | Invisible direction-override characters make the recipient and the draft read differently on screen from what is stored | fixed (its repro passes) |
| G14 | low | as claimed | Esc pressed in the top bar closes an Edit box on another light and throws the rewrite away | fixed: Esc in the bar closes only the bar |
| G15 | low | real, less severe | Tapping Edit and then a filter pill leaves the page silently frozen in time: no live updates and no once-a-minute refresh | fixed (its repro passes) |
| G29 | low | not re-checked | While the board is busy or frozen, a tap shows nothing at all, and every tap after it is silently thrown away | partly: a tap while busy says "Still working on the last one" |
| G30 | low | not re-checked | If the board stops while you are in quick mode, the only sign is the words "Failed to fetch" for three seconds | fixed: a lasting "not answering" notice (checked in a browser) |
| G31 | low | not re-checked | A quick note that starts with a question mark is not filed, and nothing says so | fixed (its repro passes) |
| G32 | low | not re-checked | Words typed in one light's "Other..." box turn up in the next light's box, focused and ready to send | fixed (its repro passes) |
| G33 | low | not re-checked | "Copy text" on a light that has no text says "Copied." and empties the clipboard | fixed: no Copy text on a light with no text |
| G35 | low | not re-checked | Quick mode with very many quick lights: the progress bar vanishes, the card stretches sideways, and on a laptop with 600 lights Close and Skip are off screen | fixed (its repro passes) |
| G36 | low | not re-checked | The open "What you decided" list does not show a decision made while it is open | fixed (its repro passes) |
| G37 | low | not re-checked | "Snooze all" gives no choice of when, and stops half-way if one of the lights was already snoozed twice | fixed (its repro passes) |
| G38 | low | not re-checked | The lights are told apart by colour alone: in high-contrast mode every dot is the same white disc, and no dot has a text label | fixed (its repro passes) |
| G39 | low | not re-checked | Text on a light cannot be reliably selected to copy it | partly: live updates wait while text is selected; a drag across a row title can still open it |
| G40 | low | not re-checked | The Back button leaves the board instead of going back to "Everything" or closing quick mode | fixed (its repro passes) |
| H1 | low | real, less severe | An assistant that stops waiting still collects the answer: nobody receives it and the person can no longer take it back | fixed: a hung-up wait collects nothing (the take-back succeeds; the script reads its own result wrong) |
| H3 | low | real, less severe | Any caller can mark a light as an example (demo) or as the person's own (by: you): the approval is then never handed to an assistant | fixed: by and demo are ignored from callers (test) |
| H4 | low | as claimed | Values that are not text are turned into text without a word: two threads with structured keys become one light, and a draft sent as an object becomes "[object Object]" | fixed (its repro passes) |
| H6 | low | as claimed | The health check tells any caller the full path of the data folder | changed: the data folder is told only to programs on this computer |
| H7 | low | as claimed | An assistant whose name ends in a space or is longer than 80 characters raises lights but is never handed a decision | fixed (its repro passes) |
| H8 | low | as claimed | Simulation: a scenario named "constructor" empties the simulated board and answers with a code error | fixed (its repro passes) |
| H9 | low | as claimed | A due date thousands of years away, or not a date at all, is accepted and shown as if it were near | fixed (its repro passes) |
| H11 | low | as claimed | Half-sent requests are kept in memory for 5 minutes with no limit on how many | partly: unfinished requests are dropped after 10 seconds, checked every second; there is no cap on total bytes |
| H21 | low | real, less severe | A wake date given in the wrong units is accepted, and from then on list_lights fails for every assistant | fixed (its repro passes) |
| K2 | low | real, less severe | Setup tells the assistant to remove the examples with clear_examples, and that tool is always refused | fixed (its repro passes) |
| K8 | low | real, less severe | wait_for_decision hands over another assistant's approved message, and the person's own to-dos | fixed (its repro passes) |
| K10 | low | real, less severe | A container cannot be renamed or removed, although the example says "Rename it to your business" | by design: renaming and removing are on the page (key needed), not open to any caller |
| K11 | low | as claimed | "Every change is appended to events.jsonl" is not true for nine kinds of change | fixed (its repro passes) |
| K12 | low | as claimed | Command line: five places where it does not do what its help or the README suggest | fixed (its repro passes on the final code) |
| K13 | low | as claimed | Two silent caps: bulk acts on the first 200 lights, a quick note keeps the first 12 things | fixed: bulk over 200 refused; notes keep up to 30 things |
| K14 | low | as claimed | "I have an hour" (and other ordinary ways to say it) is filed as a to-do instead of showing what fits | fixed (its repro passes) |
| K15 | low | as claimed | A running job expected "today" (date only) turns amber within 30 seconds | fixed (its repro passes) |
| K16 | low | as claimed | A failure can be reported with no reason, and the person reads "It did not go through: It did not go through." | fixed (its repro passes) |
| K17 | low | as claimed | Three documents say money sorts the queue; it only orders messages to people | by design: money orders messages to people only; the docs now say so |
| K18 | low | as claimed | Publishing: the package would ship internal review files with machine paths, the README's clone address is a placeholder, and .gitignore misses most board files | fixed: bin is executable; the package ships no review files |
| K19 | low | as claimed | Things that exist in the code and are documented nowhere, two of which hide an approval from every assistant | partly: settings, keys and routes are documented; some internal fields are not |
| K20 | low | as claimed | The examples are not kept apart from the real board: they change real time estimates and overwrite same-named containers | fixed (its repro passes) |
| M2 | low | as claimed | One line saying "null" kills the MCP server, and M1 lets that line arrive inside quoted email text | fixed (its repro passes) |
| M4 | low | real, less severe | ack_decisions closes whatever decision is on the light, including one no assistant was handed, and shows the message as sent | fixed (its repro passes) |
| M5 | low | as claimed | update_light's reply hands over the person's decision inside the undo window, while Take back still appears to work | fixed (its repro passes) |
| M6 | low | as claimed | An assistant whose name has a stray space or is longer than 80 characters can raise lights and never gets the answers | fixed (its repro passes) |
| M7 | low | as claimed | wait_for_decision hands over other assistants' decisions, and waits for ever on a light the person already sent themselves | fixed (its repro passes) |
| M8 | low | as claimed | raise_light honours four hidden switches (agent, by, demo, unsorted) that the tool does not list, with no warning | fixed: by and demo ignored from callers; the connector sets agent |
| M9 | low | as claimed | Every failed request is reported as 'not reachable and could not be started', and list_lights can give a board address where nothing answers | fixed (its repro passes) |
| M10 | low | real, less severe | With the documented setup, who is handed an approval depends on the folder the assistant was started in | by design, changed: names are per folder, now with a path fingerprint; for_anyone and SWITCHBOARD_AGENT documented |
| M12 | low | as claimed | Five tool calls that are offered or answer as a success and do nothing | fixed: warnings for bad dates and colours, unknown update fields and ack ids; clear_examples works; list_lights says finished lights are not listed |
| M13 | low | as claimed | Protocol gaps: batches get no reply, any protocol version is agreed to, replies are treated as requests, raw JavaScript errors come back | fixed: batches, null and replies are handled; only known versions are agreed to (test M13) |
| M14 | low | as claimed | If the board is alive but not answering, every tool call hangs with no message | fixed (its repro passes) |
| T1 | low | real, less severe | Recipient and titles can be visually spoofed with bidi/invisible Unicode (no sanitising) | fixed (its repro passes) |
| T2 | low | real, less severe | wait_for_decision lets any assistant collect and sabotage another agent's approved send | fixed (its repro passes) |
| T3 | low | real, less severe | ack_decisions skips the decision_id check, closing a replaced decision complete() would refuse | fixed (its repro passes) |
| U5 | low | real, less severe | Take back after "Save & approve" throws away what she wrote | fixed (its repro passes) |
| U6 | low | real, less severe | On a phone, approving a row a few screens down gives no sign that anything happened | fixed (its repro passes) |
| U7 | low | real, less severe | Red "first time writing to them" on a customer whose own message is quoted in the same row | fixed (its repro passes) |
| U8 | low | as claimed | "Under 2 min" and "Clear the quick ones" count lights the board itself calls "not timed yet" | fixed: quick counts only timed lights |
| U9 | low | as claimed | "I have an hour" is filed as a to-do called "I have an hour" | fixed (its repro passes) |
| U10 | low | as claimed | Busy board: 6 + 17 + 3 on screen, headline says 33 | fixed: "Show the other 17 rows (24 lights)" |
| U11 | low | as claimed | A container that wakes up asks "What's the focus?" and gives no way to answer | changed: the card says how to add the next thing, then Done |
| U13 | low | as claimed | A text she sent from her own phone is described as "Approved … held twice as long" | fixed (its repro passes) |
| U14 | low | as claimed | The S key snoozes until tomorrow morning without a menu, and nothing says until when | fixed (its repro passes) |
| U15 | low | as claimed | "$10,350 in play" drops to "$1,450 in play" when the big quote is approved, then comes back | fixed (its repro passes) |
| U16 | low | real, less severe | On a phone, "Clear the quick ones" is about 600 px off the right edge, and the phone is told which keys to press | fixed (its repro passes) |
| U17 | low | as claimed | One accidental tap, taken back, becomes the time estimate for every reply ("1 sec") | fixed (its repro passes) |
| U18 | low | real, less severe | "Flag it" on an automatic change shows it as "approved, not yet sent", and the rule vanishes without a word | partly: a flag says so in a toast; the light still reads approved until the assistant reports the revert |
| U19 | low | as claimed | "What did I decide?" cannot find a decision by the name of the person it went to | fixed (its repro passes) |
| U20 | low | as claimed | Three errands in one sentence become three lights or one, depending on which is said first | not fixed: whether a three-errand sentence splits depends on word order |
| U28 | low | not re-checked | 'Back tomorrow' is shown for something that comes back the day after tomorrow | fixed (its repro passes) |
| U30 | low | not re-checked | Next morning the strip still says 'Just now' and counts the wait in thousands of seconds | partly: a strip holding until morning says "Waiting to leave" |
| U32 | low | not re-checked | History reads 'declined, sent' for a reply she refused, and prints a 'Not like this' reason twice | fixed: sent only for approvals; a reason is printed once |
| U33 | low | not re-checked | 'What did I decide?' stops at 60 rows without saying so | fixed: the list says when it shows only the latest 60 |
| U36 | low | not re-checked | 'They have waited 2 days' is said about people who are not waiting for anything | fixed (its repro passes) |
| U37 | low | not re-checked | Opening a reply shows the same message twice | fixed (its repro passes) |
| U38 | low | not re-checked | 'You have 1 minutes. 0 lights fit. About a minute.' | fixed (its repro passes) |
| U39 | low | not re-checked | 'No' beside 'Not like this' on a customer reply does not say what it will do | fixed: on a message the button says "Don’t send" |
| U40 | low | not re-checked | The ninth container gets the same colour as the first | fixed (its repro passes) |
| U41 | low | not re-checked | The simulation says '7:30 am' but behaves like whatever time it really is | partly: blurbs no longer name clock times; scenarios run on the real clock |

### Found by agents that stopped before reporting

The fuzzing and attacker lanes' second waves wrote these repro scripts before the run was cut short, so no skeptic saw them. Each was run against the final code.

| # | Finding | Status |
|---|---|---|
| F21 | Taking back an answer on "Keep going?" left the rule as tapped | fixed (repro passes; test F21) |
| F22 | No Take back after answering a card on a collected decision | fixed (repro passes; test F22) |
| F23 | A follow-up text with no words could not be written on the card | fixed: "Write it" on the card |
| F24 | Dropping "Keep going?" left the rule paused for good | fixed: dropping it switches the rule off |
| F25 | Taking back "Not like this" removed the wrong reason | fixed (repro passes; test F25) |
| F26 | An untold "I sent it" was archived before any assistant heard | fixed (repro passes; test F26) |
| F27 | "Keep asking me" hid the offer for good | fixed differently: "Offer it again" in What runs by itself |
| F28 | "Always" on a full voice note stored a cut rule | fixed differently: rules are kept whole, apart from the voice note |
| F29 | "One more follow-up" allowed three | fixed (repro passes; test F29) |
| F30 | Failed automatic runs kept the rule | fixed (test B24) |
| F31 | "Take it back", then Take back, hid a live approval from history | fixed (repro passes) |
| F32 | A second change on a thread waiting for a look was folded into that card | fixed by refusal, with a message |
| F33 | A sleeping container's lights still asked | fixed (test C26) |
| F34 | "false", "off" and "0" switched autonomy on | fixed (test F34) |
| T2 | wait_for_decision ignored who raised the light | fixed (repro passes) |
| T21 | Whatever listens on the port first is trusted as the board | not fixed |
| T22 | The printed link used "localhost", which another program could answer | fixed: the link uses 127.0.0.1 |
| T23 | On a network, a faked Host header passed without a key | fixed: from another machine every call needs the key (checked over the network address) |
| T24 | An assistant could overwrite the voice note and the person's rules | fixed: the person's rules are kept apart |
| T25 | A container note could replace the tile's live counts | fixed: counts always first, the note after |
| T26 | A huge wake date broke list_lights | fixed: dates must fall between 2020 and 2100 |
| T27 | The first-time warning could be kept off the card | fixed: shown regardless; a message with no recipient says so |
| T28 | Simulations used a guessable shared temporary folder | fixed: simulations live in the person's own folder; folders owned by another account are refused |
| T29 | The page key never rotates | not fixed |
