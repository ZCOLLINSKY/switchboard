# For AI assistants working in this repo

Setting Switchboard up for someone: follow [SETUP.md](SETUP.md).

Changing the code:

- No dependencies and no build step. Keep it that way.
- `lib/store.js` holds every rule about lights. Add a test in `test/store.test.js` for any rule you change, and run `npm test`.
- `server.js` is the only writer of the data file. `mcp.js` and the CLI go through its HTTP API.
- `public/index.html` is the whole screen. Dark only, on purpose.
- Never commit a `data.json` or anything from a real board.
