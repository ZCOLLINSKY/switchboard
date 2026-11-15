'use strict';
// Desktop notifications, off unless switched on (SWITCHBOARD_NOTIFY). When something new needs the person, one short
// banner: at most one every 30 minutes, none in quiet hours (11 pm to 7 am), and never for what was already waiting when
// the board started. Without titles a banner says only how many, so nothing private shows on a locked screen.
const EVERY_MS = 30 * 60e3, QUIET = [23, 7];
const ringing = (l) => !l.demo && (l.state === 'need_you' || l.state === 'broken');

function notifier({ send, now = () => Date.now(), titles = false, everyMs = EVERY_MS, quiet = QUIET }) {
  let known = null, lastAt = -Infinity; // known: ids that were waiting at the start or were already announced
  const isQuiet = (t) => { const h = new Date(t).getHours(), [a, b] = quiet; return a > b ? h >= a || h < b : h >= a && h < b; };
  return {
    check(v) {
      const t = now(), gold = (v.lights || []).filter(ringing);
      if (known == null) { known = new Set(gold.map((l) => l.id)); return null; }
      // Only what still needs the person when the banner can go out: a light handled meanwhile is never announced.
      const fresh = gold.filter((l) => !known.has(l.id));
      if (!fresh.length || isQuiet(t) || t - lastAt < everyMs) return null;
      const names = {}; for (const a of v.areas || []) names[a.id] = a.name;
      const label = (l) => String(l.title || '').slice(0, 90) + (names[l.area] ? ` (${names[l.area]})` : '');
      const body = !titles ? `${fresh.length} new thing${fresh.length === 1 ? ' needs' : 's need'} you on Switchboard`
        : fresh.length === 1 ? label(fresh[0]) : `${fresh.length} new things need you: ${label(fresh[0])} and ${fresh.length - 1} more`;
      for (const l of fresh) known.add(l.id);
      lastAt = t;
      try { send('Switchboard', body); } catch (e) { /* a banner is a nicety: it never stops the board */ }
      return body;
    },
  };
}

// The system's own banner. The words go in as arguments, never into the script, so a title cannot run anything.
function osSender({ platform = process.platform, spawn = require('child_process').spawn } = {}) {
  const run = (cmd, args) => { try { const c = spawn(cmd, args, { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); } catch (e) { /* no notifier */ } };
  if (platform === 'darwin') return (title, body) => run('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', String(title), String(body)]);
  if (platform === 'linux') return (title, body) => run('notify-send', [String(title), String(body)]);
  return null;
}

// A text to the person's own phone, sent by this Mac's Messages app (their own iMessage account), so their phone buzzes
// with no service in between. SWITCHBOARD_NOTIFY_TEXT is their own number (+1…) or Apple ID email. The number and the
// words go in as arguments, never into the script.
const TO = /^(?:\+?\d{10,15}|[^\s@]+@[^\s@]+\.[^\s@]+)$/;
function textSender({ to, platform = process.platform, spawn = require('child_process').spawn, link = '' } = {}) {
  if (platform !== 'darwin' || !TO.test(String(to || '').trim())) return null;
  const script = ['on run argv', 'tell application "Messages"', 'set s to 1st account whose service type = iMessage', 'send (item 2 of argv) to participant (item 1 of argv) of s', 'end tell', 'end run'];
  return (title, body) => {
    const args = []; for (const line of script) args.push('-e', line);
    args.push(String(to).trim(), `${title}: ${body}${link ? ' ' + link : ''}`);
    try { const c = spawn('osascript', args, { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); } catch (e) { /* no Messages */ }
  };
}

// Which senders the environment asks for: SWITCHBOARD_NOTIFY (1 or titles) for a banner on this computer, and
// SWITCHBOARD_NOTIFY_TEXT for a text to the person's own phone (with SWITCHBOARD_PHONE_URL added, when set, to tap open).
function sendersFromEnv(env = process.env, deps = {}) {
  const senders = []; let warning = '';
  const banner = env.SWITCHBOARD_NOTIFY && env.SWITCHBOARD_NOTIFY !== '0';
  if (banner) { const b = osSender(deps); if (b) senders.push(b); }
  if (env.SWITCHBOARD_NOTIFY_TEXT) {
    const t = textSender(Object.assign({ to: env.SWITCHBOARD_NOTIFY_TEXT, link: env.SWITCHBOARD_PHONE_URL || '' }, deps));
    if (t) senders.push(t); else warning = 'SWITCHBOARD_NOTIFY_TEXT must be your own phone number (+1…) or Apple ID email, on a Mac; no texts will be sent.';
  }
  return { senders, titles: env.SWITCHBOARD_NOTIFY === 'titles', warning };
}

module.exports = { notifier, osSender, textSender, sendersFromEnv };
