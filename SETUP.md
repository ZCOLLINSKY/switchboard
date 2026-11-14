# Setup guide for AI assistants

You are setting up Switchboard for the person you are working with. Do the steps
in order. Do the work yourself; ask the person only the questions marked **Ask**.
Tell them in plain words what you did at the end.

All paths below are relative to this folder. Wherever a command needs its
absolute path, it is shown as `REPO`. Keep the quotes: the path may contain
spaces.

## 0. Already connected?

If you already have the Switchboard tools (`open_board`, `raise_light`), the
person installed the Claude Code plugin or the Claude Desktop extension. Skip
steps 1 to 4: call `open_board` (it starts the board and opens it in their
browser with their key, which you never see), then go to step 5.

## 1. Check Node

Run `node --version`. It must be 18 or newer. If it is missing or older, stop
and tell the person to install Node.js from https://nodejs.org, then continue.

## 2. Start the board

Check whether it is already running:

```sh
node "REPO/cli.js" link
```

If that prints a link, it is running: go to step 3. If it says it is not
running, start it in the background, then wait until it answers:

```sh
(node "REPO/cli.js" start < /dev/null > "${TMPDIR:-/tmp}/switchboard-start.log" 2>&1 &)
for i in 1 2 3 4 5 6 7 8 9 10; do node "REPO/cli.js" link && break; sleep 1; done
```

If it still does not answer, read `${TMPDIR:-/tmp}/switchboard-start.log`: it
says why (another program on the port, a damaged data file, a folder your shell
may not write to). If your shell cannot start or keep background programs, skip
this step: the MCP server in step 3 starts the board by itself (checked: under
a second), and step 6 prints the link.

The board is at http://127.0.0.1:4747. The person must open it through the link
with the key in it: the `link` command above prints it. Give them that link,
never a bare address. You cannot approve, undo or promote from the API, by
design. To stop the board: `node "REPO/cli.js" stop`. If it says
`kill EPERM`, your shell may not signal programs it did not start: ask the
person to run that command in their own terminal.

Data is stored in `~/.local/share/switchboard/` (override with
`SWITCHBOARD_HOME`). For another port, set `SWITCHBOARD_PORT=5000` (or pass
`--port 5000` to every command). Whatever you choose, use the same
`SWITCHBOARD_HOME` and `SWITCHBOARD_PORT` for every command here and for the
MCP server in step 3, or it will start a second, empty board. Set both
together: `SWITCHBOARD_HOME` alone still looks for the board on port 4747.

## 3. Connect yourself (MCP)

Switchboard's MCP server is `REPO/mcp.js`. It needs no install and starts the
board by itself if the board is not running.

Claude Code:

```sh
claude mcp add --scope user switchboard -- node "REPO/mcp.js"
```

With a custom folder or port, pass them on:

```sh
claude mcp add --scope user -e SWITCHBOARD_HOME="/path/to/data" -e SWITCHBOARD_PORT=5000 switchboard -- node "REPO/mcp.js"
```

Any other MCP client, in its server config:

```json
{ "mcpServers": { "switchboard": { "command": "node", "args": ["REPO/mcp.js"] } } }
```

**Who gets which decision.** Each assistant session has a name on the board:
the client's name plus the folder it was started in (for example
`claude-code:my-shop~3f2a`, where the last part tells apart two folders with the same name). A decision is handed only to sessions with the name of
the session that raised the light, so a session working on one project never
sends another project's message. To make every session of this assistant one
name, add `-e SWITCHBOARD_AGENT=claude` to the command above. Lights raised with
`for_anyone: true` can be collected by any session.

This changes your own settings (`~/.claude.json`). If your shell refuses it,
give the person the exact command to paste into their terminal.

The tools appear in new sessions. In this session, if the tools are not
available yet, use the HTTP API in `docs/API.md` for the remaining steps:
`add_area` is `POST /api/areas`, `raise_light` is `POST /api/lights` (leave out
`agent` for `for_anyone: true`), `get_decisions` is `POST /api/decisions` with
your `agent`, `wait_for_decision` is `POST /api/wait`, `complete_decision` is
`POST /api/complete`, and `clear_examples` is `POST /api/demo` with
`{"clear":true}`.

## 4. Teach yourself the habits

Copy the skill so future sessions know how to use the board well:

```sh
mkdir -p ~/.claude/skills && cp -R "REPO/skill/switchboard" ~/.claude/skills/
```

If your shell refuses to write `~/.claude/skills` (a sandbox), give the person
that command to run.

If you are not Claude Code, read `skill/switchboard/SKILL.md` and add its rules
to wherever your standing instructions live.

Then add this line to the person's global instructions file (for Claude Code,
`~/.claude/CLAUDE.md`). **Ask** before editing that file:

> When you need something from me, raise a light on Switchboard (MCP server
> `switchboard`) with the draft attached instead of stopping to ask. Check
> `get_decisions` when you start work and between jobs.

## 5. Put their real life on it

**Ask** these three questions, one message, plain words:

1. What are the 3 to 7 things you're juggling? (businesses, projects, school,
   family, admin). Each becomes a container.
2. For each one: is anything waiting on you right now? Is anything waiting on
   someone else?
3. Is there anything that should stay asleep until a date?

Then:

- Create each container with `add_area` (a one-line `note` helps). For anything
  asleep until a date, give that container `wake_at` as a date (`2027-01-05`).
  Its lights stay out of the queue until then, and that day it asks what is next.
- Raise one light per real item, with `for_anyone: true` so that whichever
  assistant comes next can act on the person's answers.
  - Theirs to decide or approve: state `need_you`.
  - Something they sent and are waiting on: state `waiting_them` with
    `follow_up_days`. If it was a message to a person, also give `to` (who it
    went to) and `outbound: true`, so the follow-up comes back as a message to
    write. Anything else comes back as "Check on: …".
  - Jobs that run by themselves: `auto`. What is lined up: `queued`.
- For anything you can draft, attach the draft. Never leave a `need_you` light
  that just says "send a text"; write the text.
- Do not invent items. If a container has nothing yet, leave it empty.
- If you loaded the examples (`demo`), remove them with `clear_examples` once
  there are real lights. A new board has none.

## 6. Prove the loop

1. Raise a small real light, or use one from step 5.
2. **Ask** the person to open the link and act on it. If you skipped step 2,
   print the link now with `node "REPO/cli.js" link` (with the same
   `SWITCHBOARD_HOME` and `SWITCHBOARD_PORT`).
3. Call `wait_for_decision` with that light's id, or `get_decisions` after the
   hold: 20 seconds for a change or an answer, 60 for a message to a person
   (120 if they approved it faster than it can be read, and longer if they
   chose "Release at 7:45 am"). `wait_for_decision` waits at most 50 seconds:
   if it returns `decided: false`, call it again. Confirm their answer is there,
   do what it says, then report it with `complete_decision` and its
   `decision_id`. An approval should leave "approved, not yet sent"; an answer
   to a question shows as done as soon as it is tapped.

Do not say setup is finished until this round trip has worked once.

## 7. Optional: keep it running

The MCP server starts the board whenever an assistant uses it, so this step is
optional. To have the board on at login, **Ask** first, then:

- macOS: a LaunchAgent at `~/Library/LaunchAgents/com.switchboard.plist`. Use
  the full path of node (`command -v node`), because login items do not see
  your shell's PATH, and restart only after a crash, not after a deliberate
  stop:

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>Label</key><string>com.switchboard</string>
    <key>ProgramArguments</key><array><string>/full/path/to/node</string><string>REPO/cli.js</string><string>start</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>ThrottleInterval</key><integer>30</integer>
    <key>StandardErrorPath</key><string>/tmp/switchboard.err.log</string>
  </dict></plist>
  ```

  If you set `SWITCHBOARD_HOME`, `SWITCHBOARD_PORT` or
  `SWITCHBOARD_ALLOWED_HOSTS`, add them in an `EnvironmentVariables` dict, or
  the login item starts a different board. If `command -v node` points inside a
  version folder (Homebrew `node@24`, nvm), the item breaks when that version is
  removed; check the path again after upgrading Node.
  Load it with `launchctl load ~/Library/LaunchAgents/com.switchboard.plist`.
- Linux: a systemd user service with the same command and `Restart=on-failure`.
- Windows: a Task Scheduler task at logon running the full path of `node.exe`
  with the same arguments.

## 8. Optional: open it from a phone

The board has no login, so it listens only on this computer. To open it from a
phone, use a private network you already trust (for example Tailscale, with
`tailscale serve --bg 4747`; without `--bg` it stops when its terminal closes),
then start the board with that address allowed:
`SWITCHBOARD_ALLOWED_HOSTS=your-machine.your-tailnet.ts.net`. Put the same
variable in the MCP server's settings (`-e` in step 3) and in the login item, or
a board they start will refuse the phone. Open the key link once on the phone,
as `https://your-machine.your-tailnet.ts.net/?key=…`. Never put it on the open
internet.

## Rules that always apply

- Switchboard never sends anything. After the person approves an outbound
  message, you send it through whatever channel you are allowed to use, exactly
  as approved (`text`, `to`, `attachments` and `payload` in the decision are
  what they approved).
- Never mark an outbound light as approved yourself.
- Report every decision you collected with `complete_decision`: `sent`, `done`,
  `failed`, or `unsure` when you cannot tell whether it went out.
