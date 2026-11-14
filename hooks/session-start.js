#!/usr/bin/env node
'use strict';
// SessionStart hook: one line telling a new session what Switchboard has ready for it.
// It only asks GET /api/pending, which counts and collects nothing. It never starts the board, never reads the page
// key, and prints nothing (so adds nothing to the session) when nothing is waiting or no board answers.
const path = require('path'), os = require('os'), fs = require('fs'), names = require('../lib/names');
setTimeout(() => process.exit(0), 3000).unref(); // never hold up the session

// The name mcp.js gives a Claude Code session started in this folder (its repository's, inside one), so the counts match
// what get_decisions hands it before the session names a project.
const agentFor = (cwd) => { const fixed = process.env.SWITCHBOARD_AGENT || ''; return names.agentName({ fixed, client: 'claude-code', folder: fixed ? null : names.folderOf(cwd) }); };
const home = (process.env.SWITCHBOARD_HOME || path.join(os.homedir(), '.local', 'share', 'switchboard')).replace(/^~(?=$|[\\/])/, os.homedir());

async function count(base, agent) {
  const res = await fetch(`${base}/api/pending?agent=${encodeURIComponent(agent)}`, { signal: AbortSignal.timeout(1500) });
  const p = await res.json();
  return res.ok && typeof p.decisions === 'number' ? p : null;
}

async function main(input) {
  let cwd = process.cwd();
  try { const j = JSON.parse(input); if (j && typeof j.cwd === 'string' && j.cwd) cwd = j.cwd; } catch (e) { /* no input: use our own folder */ }
  const agent = agentFor(cwd);
  const places = [];
  try { const u = JSON.parse(fs.readFileSync(path.join(home, 'server.lock'), 'utf8')).url; if (u) places.push(u); } catch (e) { /* no lock */ }
  places.push((process.env.SWITCHBOARD_URL || `http://127.0.0.1:${process.env.SWITCHBOARD_PORT || 4747}`).replace(/\/+$/, ''));
  let p = null;
  for (const base of places) { try { p = await count(base, agent); if (p) break; } catch (e) { /* nothing answers there */ } }
  if (!p) return;
  const n = (k, one, many) => `${p[k]} ${p[k] === 1 ? one : many}`;
  const parts = [];
  if (p.decisions) parts.push(`${n('decisions', 'decision is', 'decisions are')} ready for this session: call get_decisions, act on each exactly as decided, and report each with complete_decision.`);
  if (p.unreported) parts.push(`${n('unreported', 'decision was', 'decisions were')} collected earlier and never reported: find out whether it went out before sending anything.`);
  if (p.sent_by_you) parts.push(`${n('sent_by_you', 'message was', 'messages were')} sent by the person themselves: get_decisions lists them under sent_by_you, for your records only.`);
  if (p.held && p.next_release_at) parts.push(`${n('held', 'decision is', 'decisions are')} still in the person's undo window; the first is ready at ${new Date(p.next_release_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
  if (parts.length) process.stdout.write(`Switchboard: ${parts.join(' ')}\n`);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => { main(input).catch(() => {}).finally(() => process.exit(0)); });
