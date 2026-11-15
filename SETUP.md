# Setup guide for AI assistants

You are setting up Switchboard for the person you are working with. Do the steps
in order. Do the work yourself; ask the person only the questions marked **Ask**.
Tell them in plain words what you did at the end.

The whole setup, for the person, is one sentence to you ("Set up Switchboard
for me") and three taps on the board (step 5), then one "Setup check" tap that
proves the loop (step 6). Do everything else yourself.

On Windows, run the commands in PowerShell. Where a command differs, the
PowerShell version follows the Mac and Linux one.

All paths below are relative to this folder. Wherever a command needs its
absolute path, it is shown as `REPO`. Keep the quotes: the path may contain
spaces.

## 0. Already connected?

If you already have the Switchboard tools (`open_board`, `raise_light`) because
the person installed the Claude Code plugin or the Claude Desktop extension,
skip steps 1 to 4: call `open_board` (it starts the board and opens it in their
browser with their key, which you never see), then go to step 5. The plugin
and the extension bring their own rules.

If you are Codex (or another assistant) and have the tools because the person
added the MCP server by hand, skip steps 1 to 3 but do step 4 (copy the skill,
or offer the AGENTS.md lines): without it, later sessions never check
`get_decisions` and the person's answers are never picked up. Then call
`open_board` and go to step 5.

If you are Claude Code without the tools, the easiest path is the plugin: give
the person these two lines to paste into a session, then ask them to start a
new session and type `/switchboard:setup`:

```
/plugin marketplace add ZCOLLINSKY/switchboard
/plugin install switchboard@zcollinsky
```

If you are Claude Desktop without the tools, tell them to download the `.mcpb`
file from https://github.com/ZCOLLINSKY/switchboard/releases/latest,
double-click it, click Install, and say "Set up my Switchboard" in a new chat.

Otherwise (Codex, another assistant, or the person prefers it), get the folder
if you do not have it yet, then follow steps 1 to 8. `REPO` is wherever it
lands:

```sh
git clone https://github.com/ZCOLLINSKY/switchboard.git ~/switchboard
```

```powershell
git clone https://github.com/ZCOLLINSKY/switchboard.git "$HOME\switchboard"
```

No git: download https://github.com/ZCOLLINSKY/switchboard/archive/refs/heads/main.zip
and unzip it.

## 1. Check Node

Run `node --version`. It must be 18 or newer. If it is missing or older, stop
and tell the person to install Node.js from https://nodejs.org, then continue.

## 2. Start the board

Check whether it is already running:

```sh
node "REPO/cli.js" link
```

If it says it is running, go to step 3. (The link itself, with the person's
key in it, is printed only in a terminal a person is looking at, never to you.)
If it says it is not running, start it in the background, then wait until it
answers:

```sh
(umask 077; node "REPO/cli.js" start < /dev/null > /dev/null 2> "${TMPDIR:-/tmp}/switchboard-start.log" &)
for i in 1 2 3 4 5 6 7 8 9 10; do node "REPO/cli.js" link && break; sleep 1; done
```

```powershell
Start-Process -WindowStyle Hidden -FilePath node -ArgumentList '"REPO\cli.js"', 'start' -RedirectStandardOutput "$env:TEMP\switchboard-start.out" -RedirectStandardError "$env:TEMP\switchboard-start.log"
for ($i = 0; $i -lt 10; $i++) { node "REPO\cli.js" link; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 1 }
```

If it still does not answer, read `${TMPDIR:-/tmp}/switchboard-start.log`
(Windows: `$env:TEMP\switchboard-start.log`): it
says why (another program on the port, a damaged data file, a folder your shell
may not write to). If your shell cannot start or keep background programs, skip
this step: the MCP server in step 3 starts the board by itself (checked: under
a second), and step 6 opens it.

The board is at http://127.0.0.1:4747. The person must open it through the link
with the key in it. Open it for them in their browser with
`node "REPO/cli.js" link --open` (you never see the key), or ask them to run
`node "REPO/cli.js" link` in their own terminal. Never give them a bare
address. You cannot approve, undo or promote from the API, by design. To stop the board: `node "REPO/cli.js" stop`. If it says
`kill EPERM`, your shell may not signal programs it did not start: ask the
person to run that command in their own terminal.

Data is stored in `~/.local/share/switchboard/` (Windows:
`%USERPROFILE%\.local\share\switchboard`; override with
`SWITCHBOARD_HOME`). For another port, set `SWITCHBOARD_PORT=5000` (or pass
`--port 5000` to every command; in PowerShell, `$env:SWITCHBOARD_PORT = "5000"`). Whatever you choose, use the same
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

With a custom folder or port, pass them on. Every `-e` goes after the server's
name (`switchboard`) and before `--`:

```sh
claude mcp add --scope user switchboard -e SWITCHBOARD_HOME="/path/to/data" -e SWITCHBOARD_PORT=5000 -- node "REPO/mcp.js"
```

The same command works in PowerShell.

Codex: add this to `~/.codex/config.toml` (Windows:
`%USERPROFILE%\.codex\config.toml`; create the file if it is missing). Use
the full path of node (`command -v node`; Windows: `where.exe node`), because
Codex may not see your shell's PATH. On Windows, write the paths with forward
slashes (`C:/Program Files/nodejs/node.exe`) or doubled backslashes.

```toml
[mcp_servers.switchboard]
command = "/full/path/to/node"
args = ["REPO/mcp.js"]
```

For a custom folder or port, add a line under it:
`env = { SWITCHBOARD_HOME = "/path/to/data", SWITCHBOARD_PORT = "5000" }`.

Any other MCP client, in its server config (on Windows, the same forward
slashes or doubled backslashes):

```json
{ "mcpServers": { "switchboard": { "command": "node", "args": ["REPO/mcp.js"] } } }
```

**Who gets which decision.** Each assistant session has a name on the board:
the client's name plus the repository or folder it was started in (for example
`claude-code:my-shop~3f2a`, where the last part tells apart two folders with the
same name). Inside a git repository the name is that checkout's top folder, so
a session started in a subfolder shares it, and each worktree is its own
session (two release worktrees never take each other's decisions). A decision is handed only to
sessions with the name of the session that raised the light, so a session
working on one project never sends another project's message.

A session started outside the project's folder (your home folder, say) should
pass `project` with the repository's name on every call. Its name is then
`claude-code:<project>`: two sessions started in the same folder that name
different projects are never handed each other's decisions. The session
remembers its project after the first call, so one call without it still goes
to the same place, and it still collects what it raised before it named one.
An empty `project` goes back to the folder's name. A project name never holds
`~` or `:` (they become `-`), so it can never spell a repository's own name.
A session started inside the repository keeps the
repository's own name, even when it names that project. That is a different
name from `claude-code:<project>`: a decision raised from inside the repository
goes to sessions started inside it, and one raised from outside goes to
sessions that name the project.

To make every session of this assistant one name, add `-e SWITCHBOARD_AGENT=claude`
to the command above (a call that names a project is then
`claude:<project>`). With a fixed name one connector may serve many chats (Claude
Desktop works this way), so a project applies only to the call that names it. Lights raised with `for_anyone: true` can be collected by
any session.

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

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null; Copy-Item -Recurse -Force "REPO\skill\switchboard" "$HOME\.claude\skills\"
```

If your shell refuses to write `~/.claude/skills` (a sandbox), give the person
that command to run.

Codex: copy the same folder into `~/.codex/skills/` if your Codex loads skills
from there:

```sh
mkdir -p ~/.codex/skills && cp -R "REPO/skill/switchboard" ~/.codex/skills/
```

If it does not, add the lines below to `~/.codex/AGENTS.md` instead (Windows:
`%USERPROFILE%\.codex\AGENTS.md`), with the same **Ask** first.

Claude Desktop cannot load a skill file or edit its own settings. Ask the
person to paste the lines below into Settings, Profile, personal preferences
("What personal preferences should Claude consider in responses?"), and give
them the exact text.

Any other assistant: read `skill/switchboard/SKILL.md` and add its rules to
wherever your standing instructions live.

Then add this line to the person's global instructions file (for Claude Code,
`~/.claude/CLAUDE.md`; for Codex, `~/.codex/AGENTS.md`). **Ask** before editing
that file:

> When you need something from me, raise a light on Switchboard (MCP server
> `switchboard`) with the draft attached instead of stopping to ask. Check
> `get_decisions` when you start work and between jobs.

## 5. Three questions, on the board

Setup is one sentence to you ("set up my Switchboard") and three taps on the
board. Do not ask these questions in the chat: raise each as a light, call
`open_board`, and tell the person in one sentence that three quick questions
are waiting. Raise all three with `area: "Switchboard"` (`raise_light` needs an area),
`for_anyone: true` (so whichever session comes next can act on the answers),
kind `decide`, and the stable `key` shown,
so running setup again updates the same light instead of adding a second one.
The person can tap a button or type their own answer ("Other…").

1. **What do you want to keep up with?** `key: "setup:areas"`. Options:
   `My business`, `Side project`, `School`, `Family`, `Home`. Note: "Tap one,
   or type several, separated by commas (Lighting business, School, Family).
   Each becomes a container on your board."
   Recommend one only if this chat already told you what they juggle; if you
   recommend nothing, the warning about a missing recommended answer is
   expected for this one question. Each answer becomes a container: call
   `add_area` with its name (and a one-line `note` when you know one). Ask
   again with the same key if they want more.
2. **What should never happen without your tap?** `key: "setup:never"`.
   Note: "Out of the box, each of these always waits for your tap: messages to
   people, anything with money, public posts, changes to live sites or
   databases." Options: `Keep all four` (recommended) and `Let me change it`.
   Record the answer in every container's `voice` with `add_area`, for
   example "Never without his tap: messages to people, money, public posts,
   live sites and databases." If they typed a change, record exactly what they
   said. If they tapped `Let me change it` without typing anything, ask once
   more on the board (never in the chat): `area: "Switchboard"`, kind `decide`, `key:
   "setup:never-change"`, title "Which of these may go ahead without your
   tap?", options `Money`, `Public posts`, `Live sites and databases`, `Keep
   all four` (recommended), note "Messages to people always wait for you. Type
   it if it is something else." Record their answer in every container's
   `voice`, and never write "Let me change it" there. The board already never lets a message to a person run by itself, and
   "Runs by itself" stays off until they switch it on.
3. **How should it get your attention?** `key: "setup:attention"`. Options,
   exactly as `setup_guide` gives them for this computer: on a Mac `Don't,
   I'll open it myself` (recommended), `A banner on this computer`, `A text to
   my phone`; on Linux the first two (no texts); on Windows the question is
   left out (no banners or texts there), and attention is "none". Never offer
   one this computer cannot do, and never reword them. Note: "Your tap sets
   it. You can change it any time at the bottom of the board." Only a tap on these
   exact buttons sets the board's switches (no banners and no texts, banners
   on, or texts on); a typed answer is yours to read and set on the page's
   switches with the person. Texts to the phone are off until they choose
   them, on a new board and on one from before. A text also needs
   their own number: if they chose it and the board cannot text yet, raise a
   `todo` (key `setup:phone`) asking for the number, then set
   `SWITCHBOARD_NOTIFY_TEXT` where the board is started (the MCP server's
   settings, the Claude Desktop extension's "Texts to your phone", or the login
   item) and say that the board needs a restart. Opening the board on the phone
   (step 8) is a later, optional light; never raise it during setup.

Then put their real life on it, only what they name or what you already know
from this chat: one light per real item, with `for_anyone: true` and a stable
`key` (`setup:dentist`, an email thread id).

- Theirs to decide or approve: state `need_you`, with the draft attached.
  Never leave a light that just says "send a text"; write the text.
- Something they sent and are waiting on: state `waiting_them` with
  `follow_up_days` (and `to` and `outbound: true` for a message to a person).
- Jobs that run by themselves: `auto`. What is lined up: `queued`.
- Anything asleep until a date: give that container `wake_at` (`2027-01-05`).
- Do not invent items, and never raise outreach they did not ask for (an old
  lead to text, a past customer to check on). If you know of one, raise it
  with `optional: true` and `last_contact`, so it waits folded in "Reach out?"
  where they can look it up.
- If you loaded the examples (`demo`), remove them with `clear_examples`.

## 6. Prove the loop: Setup check

1. Raise a last light with `area: "Switchboard"`, `for_anyone: true` and the
   stable `key` `setup:check`: kind `decide`, title "Setup check", options
   `Check my setup` (recommended), note "Tap it and your assistant checks that
   it heard your answers."
2. Wait for the tap with `wait_for_decision` on that light's id (it waits at
   most 50 seconds: if it returns `decided: false`, call it again), or
   `get_decisions` after the hold: 20 seconds for an answer, 60 for a message
   to a person. Collect the three setup answers the same way and do what each
   says.
3. Report the check with `complete_decision`, its `decision_id`, outcome
   `done` and the detail "Setup verified: <containers>; never without your
   tap: <what>; attention: <banners, texts or none>". Tell the person the
   same in plain words.

Do not say setup is finished until this round trip has worked once. Without
the Switchboard tools yet, open the board with `node "REPO/cli.js" link --open`
(same `SWITCHBOARD_HOME` and `SWITCHBOARD_PORT`): the key goes to their
browser, not to you.

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
phone, use a private network you already trust, for example Tailscale. Give the
board its own HTTPS port, so it never takes over a page already served at the
root of this machine's address. Check first with `tailscale serve status`, and
pick another port if 8443 is taken:

```sh
tailscale serve --bg --https=8443 4747
```

Without `--bg` it stops when its terminal closes. Then start the board with
that address allowed: `SWITCHBOARD_ALLOWED_HOSTS=your-machine.your-tailnet.ts.net`.
Put the same variable in the MCP server's settings (`-e` in step 3) and in the
login item, or a board they start will refuse the phone. To get the key link
onto the phone, ask the person to run this in their own terminal (it puts the
link on the clipboard and prints no key; on a Mac, Universal Clipboard carries
it to an iPhone):

```sh
node "REPO/cli.js" link --copy --at https://your-machine.your-tailnet.ts.net:8443
```

They paste it into the phone's browser once; the phone remembers it. Never
put the board on the open internet. Anything that comes through `tailscale serve` (or any other proxy)
counts as another device, so even reading the board from there needs the key
link; assistants on this computer are not affected. The board can tell only by
the headers a proxy adds, so use `tailscale serve` as shown. A proxy that adds
none of them (nginx's default `proxy_pass` setup, say) or a plain port forward
(`ssh -L`, `socat`, `tailscale serve --tcp`) makes the other device look like
this computer: it could then read the board and collect decisions without the
key. Approving still needs the key.

## Rules that always apply

- Switchboard never sends anything. After the person approves an outbound
  message, you send it through whatever channel you are allowed to use, exactly
  as approved (`text`, `to`, `attachments` and `payload` in the decision are
  what they approved).
- Never mark an outbound light as approved yourself.
- Report every decision you collected with `complete_decision`: `sent`, `done`,
  `failed`, or `unsure` when you cannot tell whether it went out.
