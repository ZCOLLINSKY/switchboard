# Changelog

## 0.3.1 (Nov 15, 2026)

- **Public changes are answered one at a time.** Putting something live on a website, a post on a social site, a newsletter, press release or launch post is high stakes, like a deletion or a production database change, and never joins a group tap.

- **Deleting is never part of a group tap.** A light that deletes, removes, cleans up, wipes, purges, erases or
  destroys something, runs `rm -rf` or force-pushes (in any capitals) is now high stakes: answered one at a time,
  never pre-ticked in "Safe to take together". "Clean up old branches and worktrees, and the backups folder?" with
  "Yes all" recommended now waits for its own tap. A recommended "No" (keep everything) is read first, never safe.
  The answers count too: "Delete them all" or "Refund in full" as a button makes the light high even when the title
  sounds harmless. Prune, trash, discard, clear out, dropping a table or branch, `rm -r`, `git reset --hard` and
  `git branch -D` count as deleting. Words that only describe ("Nothing is deleted", "No files are removed", "the
  cleaned-up logo", the phone's "Recently Deleted" folder) do not, and a to-do never does: tapping Done deletes nothing.
- **The relay keeps his words on the light.** When the owner answers a message to a customer with anything but
  Switchboard's own buttons ("It went out", "It did not go out", "It was done", "It was not done" and the like),
  the note in the queue says "(his words are on the Switchboard light)" instead of repeating the answer, so a
  name in it never reaches the queue file.
- **Honest minutes in the headline.** The minutes add up only the taps that have a time; the rest are a count
  beside them, for example "45 waiting on you · about 7 min (27 not timed)". No row says "not timed yet" any more:
  a time shows only when it is known.
- **A calmer row.** Each row in the list shows one main button (the gold one: Approve, Done, Copy text, Yes) and
  More…, which holds the rest (Change…, Don't send, Snooze, Drop, I sent it, Move to Reach out). The keys work as
  before (Enter, E, S, N). Broken lights keep their own buttons (Run it now and so on). On a phone both buttons
  are at least 44 pixels tall.
  A row never hides what you need to read first: a text to a person shows "Open in Messages" (the ghost "I sent it"
  is under More…), a question about a page keeps "Open page ↗" beside its answer, and a choice with no recommended
  answer shows every answer side by side, so none looks like the suggested one. More… closes when the light changes,
  when you tap Change… and on Escape, so it never shows buttons left over from before. When none of the waiting taps
  is timed, the headline says so ("5 waiting on you (none timed)").
- **Setup questions land in the Switchboard container.** Every question `setup_guide` hands out now carries
  `area: "Switchboard"` (raising a light needs one), and SETUP.md says the same, with the same notes and the
  recommended answer marked the same way.
- **Links on another port.** When the board is not on port 4747, the "run cli.js link" hints from `open_board`,
  the out-of-date-link page, the command line and the start message include `--port N`.
- **Made-up names only.** Examples in the changelog and the tests use made-up businesses and people.

## 0.3.0 (Nov 15, 2026)

- **Cloud drafts for a person are messages.** When the relay turns a queue question with a draft for a person
  ("Reply to Dale about the quote", "Text Pat", or a draft that opens "Hi Sam,") into a light, it is now a
  message to a person: approved one at a time, held longer, slowed down when approved too fast to read, banner
  masked, and named in queue.md only as "the message to a customer". Words for a page or a post are not.
  A question a cloud assistant takes back (its line goes from `[?]` to a plain `[ ]`) now leaves the board too.
- **Docs.** Codex with the tools already connected still does SETUP.md step 4 (the rules later sessions need).
  The README warns Windows users about backslashes in config.toml, says Claude Code users take the plugin rather
  than also connecting by hand, and its Remove steps now cover the Windows logon task, the Linux service, the
  Codex skill copy and a Download-ZIP update. "Let me change it" during setup gets one follow-up tap on the board,
  and /switchboard:setup and SETUP.md now agree on reach-out suggestions.

- **Clearer docs for newcomers.** The README says who Switchboard is for, starts Install with one sentence to
  your assistant ("Set up Switchboard for me: github.com/ZCOLLINSKY/switchboard"), then gives the details for
  Claude Code, Claude Desktop, Codex and a cloned folder. New sections: what to know once the plugin is in, how
  to update or remove it (your data stays until you delete it), and a "What leaves your computer" box. SETUP.md
  adds Codex, PowerShell commands for Windows, and pasting the rules into Claude Desktop's personal preferences.
  New docs/FOR-OWNERS.md: one page for a business owner on using the board. The browser demo now says in one
  sentence what Switchboard is.

- **Setup is one sentence and three taps.** Say "Set up my Switchboard" (or type `/switchboard:setup` in Claude
  Code). Claude opens the board with three questions, each one tap with the safe answer marked: what you want to
  keep up with (each answer becomes a container), what must never happen without your tap (messages to people,
  money, public posts, live sites and databases: all four on), and how it should get your attention ("Don't, I'll
  open it myself", a banner, or a text). A last "Setup check" tap proves Claude heard you, and it reports "Setup
  verified". Opening the board on your phone is a later, optional step.
- **Your tap sets how it reaches you.** The attention answer switches banners and texts itself (Undo puts them
  back). Texts to your phone are now off until you turn them on, on a new board and on the one you already have (a
  board that never set the switch starts with texts off and says so once when it starts; turn them back on at the
  bottom of the board). Only the three exact buttons switch anything: an assistant's own wording of the question
  changes no setting. The question offers only what the computer can do: no text off a Mac, and no question at
  all on Windows. If you later change the banner setting where the board starts (the Claude Desktop "Banners on
  this computer" toggle), that newer choice wins over your earlier answer. Banners got their own switch beside the texts one at the bottom of the board.
- **Command center, not suggestions.** Claude's rules now say: only real replies, jobs in progress, money owed and
  broken things go on the board, each with one clear recommended answer and what is at stake. Outreach you did not
  ask for waits folded in "Reach out?".
- **Claude Desktop settings.** The extension's settings can turn on banners, texts to your phone (your number), the
  phone address for tapping straight to the board, and extra host names. Empty ones count as not set.

- **Customer details stay out of git and off the lock screen.** The relay's notes in queue.md name a message to a
  customer only by its area, "a customer" and the light id: never the person's name, number or the words (the
  session reads those on Switchboard). No note ever carries a phone number. With banner titles on, a message to
  a customer shows as "a message to a customer is ready (Acme Lighting)".
- **Every customer message has one owner.** Raising a message to a customer with no name (or `for_anyone`) is
  refused with a clear message, so two sessions can never both send it (marking it as an example through the
  API does not get around this). The command line still works: it raises
  as "command-line".
- **"Yes (recommended)" works.** An option label marked "(recommended)" becomes the recommended answer, and the
  mark comes off the button.
- **Sessions outside a repo name their project.** A session started in the home folder (or Desktop, Documents,
  Downloads, or the top of the disk) that names no project cannot ask the owner a question or approval (it is told to
  pass `project`), so their answer always comes back to a session working on that project. Other lights get a
  warning. A plain project folder that is not a git repository is fine: its name is the project.
- **New page key.** `node cli.js rotate-key` makes a new key: links opened before can only look once the board
  restarts. A login item is stopped for you; the command says how to start it and get the new link. Only the board
  the login item actually starts (same data folder and port) counts as the login item: a practice board on another
  port is never stopped that way.

- **Reach out? stays folded.** A suggestion nobody asked for (texting an old lead, checking in with a past
  customer) is raised with `optional: true` and a `last_contact` line ("Nov 9, texted the quote"). It never
  shows in the list, Next up, the headline, the tab title, an area's waiting count or a banner or text. It waits
  in one folded drawer, "Reach out? (n)", longest-quiet first, with who it is, when you last talked and its area.
  Open a row to read the words, then Copy & open (and "Yes, it went"), or Not now with a short reason that goes
  back to the assistant. The count line adds "n to reach out", so the parts still add up to the total. An
  assistant can move its own light there with `optional: true`; you can push any message to a person there from
  its More menu ("Move to Reach out", with Undo). Only a message to a person can wait there (a decision or to-do
  marked optional stays in the list, with a warning to the assistant). Once you move one there, its assistant
  cannot pull it back into your list; only you can. Its value no longer counts toward an area's "$ in play".

- **Money sits with the people waiting.** A light with a value, or one about a
  payment, invoice, refund, deposit or Stripe step, now sorts with the people
  waiting on you (most money first; at equal money, a person comes first)
  instead of by age with everything else.
- **A session's lights go to its project.** Raising with no container (or only
  Inbox) files the light under the container named by the session's project,
  when the board has one and it is awake. Inbox otherwise, as before.

- **Scheduled tasks keep their answers.** `get_decisions` takes
  `checks_every_minutes`: a task that runs every 30 minutes (or four times a
  day) says so, and an answer to its light waits for its next run instead of
  going to the relay 10 minutes after the tap. A task that stops running still
  hands its answers on once it misses a run by the same wait. 0 clears it; capped
  at 26 hours. Tests no longer depend on the hour they run (quiet hours).

- **Sessions close their own lights.** `close_light {key or id, outcome, note}`
  finishes work a session is done with (refused while a decision on the light is
  out). `update_light` accepts `key` instead of `id`. `list_lights` now returns
  each light's `key`, `link`, `agent`, `due`, `recommended`, `kind` and `options`
  so a session can find its own.
- **Answered before.** `search_history {q}` asks what the person already
  decided, and raising a light whose key was answered in the last 14 days warns
  with the answer and the date.
- **Raise-time warnings** (never refusals): a decision with options and no
  recommended answer, an approval with no draft, a message with no recipient, a
  to-do with no link, and a waiting message with no follow-up draft. The skill
  says to recommend, draft, link, and try the tools you already have first.
- **Deep links.** The page opens and selects a light from `#<id>` in the
  address. A text or banner for one new light links straight to it.
- **Home-screen app.** The board serves `icon.png` and `manifest.webmanifest`,
  and the page has the touch icon and standalone tags, so it can be added to a
  phone's home screen.

- **Your phone buzzes, with no cloud.** `SWITCHBOARD_NOTIFY_TEXT` (your own number
  or Apple ID) has the Mac's Messages app text you when something new needs you,
  on the same rules as the banner (at most every 30 minutes, none at night, a
  count only, since a phone shows texts on its locked screen; set
  `SWITCHBOARD_NOTIFY_TEXT_TITLES=1` to name what came in), with
  `SWITCHBOARD_PHONE_URL` added.
  macOS asks once for permission to use Messages.
- **Take every recommendation.** `recommended` on a question (one of its
  options) marks the answer the assistant recommends; the page offers "Take all
  N recommendations" when there are two or more, lists each answer first, and
  keeps each on its own undo hold. Never for a message to a person, never for a
  light that changed after it was seen.
- **An icon** for the plugin listing and the Claude Desktop extension: the
  board's three lights on its dark tile (`npm run icon` redraws it, no
  dependencies).
- **Receipts.** `node cli.js report [--days 7]`: what came in and from whom,
  what you decided and how fast (from when it asked you to your answer), what
  assistants picked up and reported, and what has waited longest. Counted from
  the board's own log, nothing estimated.
- **Ports browsers refuse** (6000, 5060, 10080 and the rest of the Fetch standard's
  list above 1024) are refused with a plain reason by the board and the
  connector, instead of a board that starts and can never be reached. Found by
  running the Desktop extension under Claude Desktop's own MCP runtime
  (nodeHost.js in Electron 45), where it otherwise works end to end.
- **Daily backups.** The first save each day copies the data file to
  `backups/data-YYYY-MM-DD.json`; the newest 14 are kept.
- **Answers are never stranded.** Switchboard remembers when each assistant last
  asked for decisions. A relay can ask for `orphans_after_minutes`: answers on
  lights whose session has not asked since (it ended, or its worktree is gone),
  after that wait, marked `orphan` with `raised_by`, so it can carry them to
  whoever picks up the work. Never a message to a person, never a light with no
  name, never anything collected before.
- **A property fuzzer** (`node scripts/fuzz.js 60 500`) checks the promises about
  decisions over thousands of random steps; a short pass runs with `npm test`.
- **Try it in the browser.** zcollinsky.github.io/switchboard runs the real board in
  the page with a made-up morning: nothing to install, nothing sent anywhere.
  `node scripts/build-demo.js` builds it; GitHub Pages republishes it from main.
- **A banner when something new needs you**, if you switch it on with
  `SWITCHBOARD_NOTIFY=1` (a count) or `=titles` (what came in): at most one
  every 30 minutes, none from 11 pm to 7 am, and never for what was already
  waiting when the board started. macOS and Linux.

## 0.2.0

Install it in the app you use, and decisions reach the right session.

- **Install as a Claude Code plugin or a Claude Desktop extension.** Two
  `/plugin` lines in Claude Code, or a `.mcpb` file to double-click in Claude
  Desktop, where the board runs inside the app. A new `open_board` tool opens
  the board in the person's browser with their key, which the assistant never
  sees, and `setup_guide` walks an assistant through the first setup.
- **Decisions go to the right session.** A session's name now comes from the
  top folder of its git checkout, so a session started in a subfolder gets the
  repository's name, and each worktree stays its own session. A session
  started elsewhere can name its `project`; it is remembered for the rest of the
  session, and the session still collects what it raised before naming one.
  With a fixed name (Claude Desktop, where one connector serves every chat) a
  project applies only to the call that names it. A project name can never
  spell another session's name. Waiting on another session's light says so at
  once, without naming it.
- **An empty `get_decisions` says why.** While an answer is still in the
  person's undo window (20 to 120 seconds), it says so and when the answer can
  be collected, and it counts answers that are ready for other sessions.
- **Raising the same thing twice** without a key returns the light already open
  instead of a second one.
- **Approvals on a quiet board wait.** When no assistant has asked for
  decisions in a day (Claude Desktop between chats), an approval says it is
  waiting for one to check in instead of turning red. A light that only one
  program can collect (a relay, a script) names that program.
- **First run:** the board shows how to connect an assistant, with copy
  buttons, until any call comes in through one (opening the board counts).
- **The key stays with the person.** `link`, `start` and `demo` print the key
  link only in a terminal; into a pipe or a log they say to use the new
  `link --open`, which opens it in the browser. The setup guide no longer tells
  an assistant to print it. `open_board` takes the key only from its own data
  folder, for the board holding that folder's lock, and says so when the
  browser did not open, with a page the person can double-click.
- **The connector says what is wrong.** A `SWITCHBOARD_PORT` that is not a
  port, or another program on the port, is an error instead of a quiet fall
  back to the usual board or "HTTP 404". A node removed by an upgrade asks for
  a restart instead of running the board inside the session.
- **From another device:** anything that reaches the board through a proxy such
  as `tailscale serve` needs the key link, reading included. `link --copy --at
  https://…` puts that device's key link on the clipboard without printing it,
  and a device without the key is told so instead of "not answering". A plain port
  forward cannot be told apart from this computer; SETUP.md says so.
- **Claude Desktop gets the habits:** setup_guide returns the skill, and the
  hard rules come with the connection.
- **Fixes:** the command line's hints carry the port in use, and `sim` follows
  `SWITCHBOARD_PORT` and `SWITCHBOARD_HOME`. The setup guide's
  `claude mcp add` line, phone step and proof light are corrected. "Send now"
  is now "Skip the wait" and "Approve & send" is now "Approve": the board never
  sends anything itself.
- The command line moved from `bin/switchboard.js` to `cli.js`. The version
  lives in `package.json` alone, and the tests give the same result whatever
  settings the caller has.

**Upgrading from 0.1.0.** `bin/switchboard.js` is gone; use `cli.js` in its
place (`node cli.js link`, `node cli.js start`). If you followed step 7 of the
0.1.0 setup, your login item runs `REPO/bin/switchboard.js start`: change it to
`REPO/cli.js start`, or it fails at every login and macOS retries it every 30
seconds. If you ran `npm link`, run it again in this folder.

## 0.1.0

First public version.
