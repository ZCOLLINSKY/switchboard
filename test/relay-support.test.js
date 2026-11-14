'use strict';
// The relay's view of the board over HTTP: adopt and the read-only pending count. Rules are tested in store.test.js.
require('./fixtures/env'); // the same result whatever SWITCHBOARD_* settings the caller has
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { start } = require('../server');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbrelay-'));

test('GET /api/pending answers with counts only, and adopt works over HTTP', async () => {
  const dir = tmp();
  const sb = await start({ dir, port: 0, holdMs: 0 });
  try {
    const post = async (p, body) => { const r = await fetch(sb.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    const raised = await post('/api/lights', { area: 'Shop', title: 'Yes or no: B?', kind: 'decide', options: ['Yes', 'No'], key: 'board:b' });
    const adopted = await post('/api/lights/' + raised.body.id, { adopt: true, agent: 'relay' });
    assert.equal(adopted.status, 200);
    assert.equal(adopted.body.agent, 'relay');
    const r = await fetch(sb.url + '/api/pending?agent=relay');
    assert.equal(r.status, 200);
    const p = await r.json();
    assert.deepEqual(Object.keys(p).sort(), ['decisions', 'held', 'next_release_at', 'now', 'sent_by_you', 'unreported']);
  } finally { sb.close(); }
});
