# Changelog

## 0.2.0

Install it in the app you use, and decisions reach the right session.

- **Install as a Claude Code plugin or a Claude Desktop extension.** Two
  `/plugin` lines in Claude Code, or a `.mcpb` file to double-click in Claude
  Desktop, where the board runs inside the app. A new `open_board` tool opens
  the board in the person's browser with their key, which the assistant never
  sees, and `setup_guide` walks an assistant through the first setup.
- **Decisions go to the right session.** A session's name now comes from its
  git repository, so every worktree of one repository shares it. A session
  started elsewhere can name its `project`; it is remembered for the rest of the
  session. Waiting on another session's light says whose it is at once.
- **Raising the same thing twice** without a key returns the light already open
  instead of a second one.
- **Approvals on a quiet board wait.** When no assistant has asked for
  decisions in a day (Claude Desktop between chats), an approval says it is
  waiting for one to check in instead of turning red.
- **First run:** the board shows how to connect an assistant, with copy
  buttons, until the first light comes in through one.
- **From another device:** anything that reaches the board through a proxy such
  as `tailscale serve` needs the key link, reading included.
- **Fixes:** the command line's hints carry the port in use, `demo` prints the
  key link, and `sim` follows `SWITCHBOARD_PORT` and `SWITCHBOARD_HOME`. The
  setup guide's `claude mcp add` line, phone step and proof light are corrected.
  "Send now" is now "Skip the wait": the board never sends anything itself.
- The command line moved from `bin/switchboard.js` to `cli.js`. The version
  lives in `package.json` alone, and the tests give the same result whatever
  settings the caller has.

## 0.1.0

First public version.
