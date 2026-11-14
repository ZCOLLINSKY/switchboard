# For AI assistants working in this repo

Setting Switchboard up for someone: follow [SETUP.md](SETUP.md).

Changing the code:

- No dependencies and no build step. Keep it that way.
- `lib/store.js` holds every rule about lights. Add a test in `test/store.test.js` for any rule you change, and run `npm test`.
- `server.js` is the only writer of the data file. `mcp.js` and the CLI go through its HTTP API.
- `public/index.html` is the whole screen. Dark only, on purpose.
- Never commit a `data.json` or anything from a real board.
- Tests get their settings from `test/fixtures/env.js`: require it first in a new test file, and start programs with `childEnv({...})`, naming the port or address of the test's own board.
- The version lives in `package.json`. `npm version 0.3.0` copies it into `.claude-plugin/plugin.json` and `manifest.json`, and a test checks they agree.
- The Claude Desktop file is built at release time, never committed: `npx -y @anthropic-ai/mcpb@2.1.2 pack . dist/switchboard-<version>.mcpb`. `.mcpbignore` says what it leaves out.
- The browser demo is built from the real files by `scripts/build-demo.js` (with `scripts/demo-runtime.js` standing in for the few Node features the board uses). Anything new the server or store needs from Node must be added there too; `test/demo.test.js` will fail if it is missing.
