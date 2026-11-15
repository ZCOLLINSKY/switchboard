# Changelog

## Unreleased

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
