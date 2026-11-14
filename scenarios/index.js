'use strict';
// Simulated days for trying Switchboard without real data. Everyone here is made up.
// Each scenario builds a board as it would look at one moment for the same person:
// Maya Ortiz, who runs a small outdoor-lighting company, builds a trail app on the side,
// takes night classes and has two kids.
const { rev } = require('../lib/store');
const H = 36e5, D = 864e5;

function base(s, now) {
  s.addArea({ name: 'Ortiz Lighting', color: '#F5A623', note: '' }, now);
  s.addArea({ name: 'TrailFork app', color: '#4C8DF6', note: '' }, now);
  s.addArea({ name: 'Night classes', color: '#E0528A', note: '' }, now);
  s.addArea({ name: 'Family', color: '#4CB05A', note: '' }, now);
  s.addArea({ name: 'House admin', color: '#9AA6B8', note: '' }, now);
  s.db.timing = { approve: { took: [12, 14, 16], stated: [] }, decide: { took: [8, 9, 11], stated: [] }, sense: { took: [80, 95, 110], stated: [] }, todo: { took: [50, 70, 90], stated: [] }, fix: { took: [10, 12, 15], stated: [] } };
}
const running = (s, now) => {
  s.raise({ area: 'TrailFork app', title: 'Nightly test run', state: 'auto', progress: 40, note: 'Started 6:10 am by the build agent.' }, now - 80 * 60e3);
  s.raise({ area: 'TrailFork app', title: 'Trail conditions refresh (every morning)', state: 'auto' }, now - 2 * H);
  s.raise({ area: 'Ortiz Lighting', title: 'Review requests go out 3 days after each paid job', state: 'auto' }, now - 9 * D);
  s.raise({ area: 'House admin', title: 'Weekly photo backup', state: 'auto' }, now - 3 * D);
};

const scenarios = {
  morning: {
    title: 'A normal morning',
    blurb: 'Her assistants worked overnight and left nine things. The everyday case. (It runs on your real clock.)',
    build(s, now) {
      base(s, now); running(s, now);
      s.raise({ area: 'Ortiz Lighting', title: 'Reply to the Hendersons: yes, we can add the back patio', kind: 'approve', outbound: true, to: 'Dale Henderson', follow_up_days: 3, action_type: 'customer-reply', value: 1450,
        source: 'Text from Dale Henderson, yesterday 8:41 pm: "Loved the front. Can you add the back patio too and what would that run?"',
        draft: 'Hi Dale, glad you like it. Yes, we can add the back patio. For six fixtures on the same transformer it would be $1,450 installed. I have Saturday morning open if you want it done this week.',
        next: 'waits 3 days for their reply, then drafts a nudge for you' }, now - 10 * H);
      s.raise({ area: 'Ortiz Lighting', title: 'Send the Maple Court HOA quote', kind: 'approve', outbound: true, to: 'Priya at Maple Court HOA', attachments: [{ name: 'Maple Court quote.pdf', link: 'https://example.com/quote.pdf' }], follow_up_days: 5, action_type: 'quote', value: 8900,
        source: 'Site walk notes from Tuesday: entrance sign, 14 trees along the drive, clubhouse path.',
        draft: 'Hi Priya, thanks for walking the property with me. Attached is the quote for the entrance, the drive and the clubhouse path: $8,900 installed, with a 5-year warranty on fixtures. Happy to present it at the board meeting if that helps.',
        next: 'waits 5 days for their reply' }, now - 6 * H);
      s.raise({ area: 'Ortiz Lighting', title: 'Text the supplier: is the brass order shipping Thursday?', kind: 'approve', phone: '+15555550142', follow_up_days: 1,
        draft: 'Morning Sam, checking that the 24 brass path lights are still on the truck for Thursday. I have an install Saturday that needs them.' }, now - 3 * H);
      s.raise({ area: 'TrailFork app', title: 'Two trail reports look like the same closure. Which one stays?', kind: 'decide', options: ['Keep the ranger post', 'Keep the user photo', 'Keep both'],
        note: 'Recommended: keep the ranger post. It names the reopening date; the photo does not.' }, now - 5 * H);
      s.raise({ area: 'TrailFork app', title: 'Fix the misspelled trailhead name on 3 pages', kind: 'approve', action_type: 'listing-fix', change_from: 'Cumberlnd Gap Trailhead', change_to: 'Cumberland Gap Trailhead', seconds: 8 }, now - 4 * H);
      s.raise({ area: 'TrailFork app', title: 'Read the state park alert page for me (it blocks robots)', kind: 'sense', link: 'https://example.com/park-alerts', options: ['No new alerts', 'New closure'],
        note: 'The site forbids automated reads. Open it and tap what you see, or type the closure.' }, now - 2 * H);
      s.raise({ area: 'Night classes', title: 'Accounting problem set 6', kind: 'todo', work_minutes: 90, due: now + 3 * D, note: 'Chapters 9 and 10. About 90 minutes last time.' }, now - 1 * D);
      s.raise({ area: 'Family', title: 'Sign the field trip form', kind: 'todo', seconds: 60, due: now + 20 * H, link: 'https://example.com/field-trip-form' }, now - 14 * H);
      s.raise({ area: 'House admin', title: 'Car registration renewal failed: the card on file expired', state: 'broken', work_minutes: 5, holds_up: 'the registration, due this month', options: ['I updated the card', 'Remind me tonight'] }, now - 7 * H);
      s.raise({ area: 'Ortiz Lighting', title: 'Quote out to the Parkers (front elevation)', state: 'waiting_them', outbound: true, follow_up_days: 4, note: 'Sent Monday. $3,200.' }, now - 2 * D);
      s.raise({ area: 'TrailFork app', title: 'Outreach to trail clubs, no reply yet', state: 'waiting_them', outbound: true, batch: 6, follow_up_days: 7 }, now - 3 * D);
      s.raise({ area: 'TrailFork app', title: 'Release 41: offline maps', state: 'queued', note: 'Starts when the test run is green.' }, now - 1 * H);
      s.raise({ area: 'Ortiz Lighting', title: 'Order transformers for the Henderson add-on', state: 'queued', note: 'Waits for their yes.' }, now - 1 * H);
    },
    // Things that happen while you watch (seconds after loading).
    live: [
      { at: 12, run(s, now, f) { const l = f('Nightly test run'); if (l) s.update(l.id, { progress: 70 }, 'agent', now); } },
      { at: 25, run(s, now) { s.raise({ area: 'Ortiz Lighting', title: 'New lead from the website: wants a Saturday estimate', kind: 'approve', outbound: true, to: 'Jordan (website form)', follow_up_days: 2, action_type: 'customer-reply',
          source: 'Website form, just now. Jordan Blake: "Saw your work at the Hendersons. Could you come by Saturday for an estimate? Two-story, about 80 ft of roofline."',
          draft: 'Hi Jordan, thanks for reaching out, and glad you saw the Hendersons\' place. I can come by Saturday at 10 am. What is the address?', next: 'waits 2 days for their reply' }, now); } },
      { at: 40, run(s, now, f) { const l = f('Nightly test run'); if (l) s.update(l.id, { state: 'done', reason: 'all 212 tests passed' }, 'agent', now); const q = f('Release 41'); if (q) s.update(q.id, { state: 'auto', progress: 10, note: 'Tests are green. Building.' }, 'agent', now); } },
      { at: 60, run(s, now, f) { const l = f('Trail conditions refresh'); if (l) s.update(l.id, { state: 'broken', kind: 'fix', title: 'Trail conditions refresh failed: the park feed timed out twice', options: ['Try again now', 'Skip today'] }, 'agent', now); } },
      { at: 80, run(s, now, f) { const l = f('Quote out to the Parkers'); if (l) s.update(l.id, { state: 'need_you', kind: 'approve', title: 'The Parkers said yes. Send the deposit link?', to: 'the Parkers', source: 'Email from Lena Parker, just now: "Let\'s do it. How do we get on the schedule?"',
          draft: 'Wonderful, thank you Lena. Here is the deposit link ($960, 30%). Once it is in I will hold Saturday the 21st for you.', follow_up_days: 2 }, 'agent', now); } },
      { at: 100, run(s, now, f) { const l = f('Release 41'); if (l) s.update(l.id, { progress: 60 }, 'agent', now); } },
      { at: 120, run(s, now) { s.raise({ area: 'Family', title: 'School called: early pickup Friday at 1:30', kind: 'decide', options: ['I can do it', 'Ask grandma'], note: 'From the voicemail transcript.' }, now); } },
    ],
  },

  slammed: {
    title: 'Slammed',
    blurb: 'Back after two days away: 30-plus things waiting, some broken jobs, some old ones.',
    build(s, now) {
      base(s, now); running(s, now);
      const names = ['Alvarez', 'Brooks', 'Chen', 'Dawson', 'Ellis', 'Foster', 'Grant', 'Hale', 'Ito', 'Jensen'];
      names.forEach((n, i) => s.raise({ area: 'Ortiz Lighting', title: `Reply to the ${n} inquiry`, kind: 'approve', outbound: true, to: `the ${n} household`, follow_up_days: 3, action_type: 'customer-reply', value: i < 3 ? [6200, 3400, 1800][i] : null,
        source: `Website form: ${n} household asked about ${i % 2 ? 'roofline' : 'landscape'} lighting and timing.`,
        draft: `Hi, thanks for reaching out. I can come by ${i % 2 ? 'Thursday' : 'Friday'} afternoon for a free estimate. Does 4 pm work?` }, now - (50 - i * 4) * H));
      for (let i = 1; i <= 8; i++) s.raise({ area: 'TrailFork app', title: `Approve trail listing fix ${i} of 8`, kind: 'approve', action_type: 'listing-fix', change_from: 'Open year-round', change_to: 'Closed Dec to Mar', seconds: 8 }, now - (40 - i) * H);
      for (let i = 1; i <= 4; i++) s.raise({ area: 'TrailFork app', title: `Duplicate report ${i}: which stays?`, kind: 'decide', options: ['Keep the first', 'Keep the second'] }, now - (30 - i) * H);
      s.raise({ area: 'TrailFork app', title: 'Read 3 park alert pages (they block robots)', kind: 'sense', link: 'https://example.com/park-alerts', options: ['No changes', 'Something changed'] }, now - 28 * H);
      s.raise({ area: 'TrailFork app', title: 'App store review reply needs your OK', kind: 'approve', outbound: true, draft: 'Thanks for the report. The map freeze on older phones is fixed in version 4.1, out this week.' }, now - 20 * H);
      s.raise({ area: 'Night classes', title: 'Midterm study guide: pick 2 of 4 essay topics', kind: 'todo', work_minutes: 30 }, now - 3 * D);
      s.raise({ area: 'Night classes', title: 'Email the professor about the missed quiz', kind: 'approve', outbound: true, channel: 'copy', draft: 'Professor Lin, I missed Monday\'s quiz for a work emergency. Could I make it up during office hours Thursday?' }, now - 2 * D);
      s.raise({ area: 'Family', title: 'Pick a dentist time for both kids', kind: 'decide', options: ['Mon 3:30', 'Wed 4:15', 'Neither'] }, now - 4 * D);
      s.raise({ area: 'Family', title: 'Soccer snack week: buy for 14 kids by Saturday', kind: 'todo', work_minutes: 20 }, now - 1 * D);
      s.raise({ area: 'House admin', title: 'Pay the water bill (paper only)', kind: 'todo', seconds: 300, due: now + 10 * H }, now - 5 * D);
      s.raise({ area: 'House admin', title: 'Insurance renewal: accept the new rate?', kind: 'decide', options: ['Accept', 'Shop around'], note: 'Up $18 a month from last year.' }, now - 6 * D);
      s.raise({ area: 'Ortiz Lighting', title: 'Payroll export failed two nights running', state: 'broken', holds_up: 'Friday payroll', options: ['Run it now', 'Leave it'] }, now - 30 * H);
      s.raise({ area: 'TrailFork app', title: 'Photo upload queue is stuck (412 waiting)', state: 'broken', options: ['Restart the worker', 'Leave it'] }, now - 9 * H);
      s.raise({ area: 'Ortiz Lighting', title: 'Deposit reminders did not send: mail key expired', state: 'broken', kind: 'fix', work_minutes: 15, holds_up: '3 deposit reminders', note: 'Needs a new key from your email provider.' }, now - 26 * H);
      s.raise({ area: 'Ortiz Lighting', title: 'Quotes out, waiting on customers', state: 'waiting_them', outbound: true, batch: 9, follow_up_days: 4 }, now - 1 * D);
      s.raise({ area: 'TrailFork app', title: 'Outreach to trail clubs, no reply yet', state: 'waiting_them', outbound: true, batch: 40, follow_up_days: 7 }, now - 2 * D);
      for (let i = 1; i <= 7; i++) s.raise({ area: 'TrailFork app', title: `Queued build step ${i}`, state: 'queued' }, now - i * H);
      s.tick(now);
    },
  },

  comeback: {
    title: 'Things coming back',
    blurb: 'Friday. People went quiet, timers ran out, and things you put off have returned.',
    build(s, now) {
      base(s, now); running(s, now);
      s.raise({ area: 'Ortiz Lighting', title: 'Quote to the Parkers (front elevation, $3,200)', state: 'waiting_them', outbound: true, follow_up_days: 4,
        follow_up_draft: 'Hi Lena, checking in on the front elevation quote. I have an opening the week of the 21st if you would like to grab it.' }, now - 5 * D);
      s.raise({ area: 'Ortiz Lighting', title: 'Ask the HOA manager about the 2027 bid', state: 'waiting_them', outbound: true, follow_up_days: 6 }, now - 7 * D);
      s.raise({ area: 'TrailFork app', title: 'Partnership note to the state trails council', state: 'waiting_them', outbound: true, follow_up_days: 10,
        follow_up_draft: 'Hello again. Following up on the trail-closure feed idea. Would a 15-minute call next week work?' }, now - 11 * D);
      s.raise({ area: 'Ortiz Lighting', title: 'Text the roofer who offered to trade referrals', kind: 'approve', phone: '+15555550177', follow_up_days: 3,
        draft: 'Hey Marcus, Maya with Ortiz Lighting. Good meeting you at the builders lunch. Still up for trading referrals? Coffee next week?' }, now - 4 * D);
      s.raise({ area: 'House admin', title: 'Call the county about the permit fee', kind: 'todo', work_minutes: 10 }, now - 6 * D);
      const sn = s.raise({ area: 'Night classes', title: 'Start the group project outline', kind: 'todo', work_minutes: 40 }, now - 5 * D);
      s.act(sn.id, 'snooze', { days: 2 }, now - 5 * D); s.act(sn.id, 'snooze', { days: 2 }, now - 3 * D + 1000);
      const later = s.raise({ area: 'Family', title: 'Book the birthday party venue', kind: 'todo', work_minutes: 15 }, now - 1 * D);
      s.act(later.id, 'snooze', { days: 3 }, now - 1 * D);
      s.raise({ area: 'TrailFork app', title: 'Reply to the trail club that finally answered', kind: 'approve', outbound: true, follow_up_days: 5, action_type: 'partner-reply',
        source: 'Email from Blue Ridge Hikers, this morning: "Sorry for the delay. Yes, we would love to share our closure notices."',
        draft: 'No apology needed, and thank you. I will send a one-page how-to today. Who should get the login?' }, now - 2 * H);
      s.raise({ area: 'TrailFork app', title: 'Outreach to trail clubs, no reply yet', state: 'waiting_them', outbound: true, batch: 5, follow_up_days: 7 }, now - 3 * D);
      s.addArea({ name: 'Holiday pop-up shop', color: '#7C63E8', note: '', wake_at: now - 60e3 }, now - 30 * D);
      s.tick(now);
    },
  },

  trusted: {
    title: 'Earning trust',
    blurb: 'A month in. One kind of change has been approved ten times untouched, on ten different days. Open "What runs by itself" at the bottom to switch the offer on.',
    build(s, now) {
      base(s, now); running(s, now);
      for (let i = 0; i < 10; i++) { const l = s.raise({ area: 'TrailFork app', title: `Trail listing fix ${i + 1}`, kind: 'approve', action_type: 'listing-fix', change_from: 'Open year-round', change_to: 'Closed Dec to Mar' }, now - (12 - i) * D); s.act(l.id, 'approve', { rev: rev(l), tookMs: 6000 }, now - (12 - i) * D + H); }
      s.ack(s.db.lights.map((l) => l.id));
      s.raise({ area: 'TrailFork app', title: 'Trail listing fix: update Pine Ridge parking fee', kind: 'approve', action_type: 'listing-fix', change_from: '$5', change_to: '$7', seconds: 6 }, now - 2 * H);
      s.raise({ area: 'Ortiz Lighting', title: 'Reply to a customer asking about a warranty repair', kind: 'approve', outbound: true, follow_up_days: 3, action_type: 'customer-reply',
        source: 'Text from a past customer: "One of the path lights is out. Is that covered?"',
        draft: 'Yes, that is covered for five years. I can swap it Thursday between 3 and 5. Does that work?' }, now - 3 * H);
      s.raise({ area: 'Ortiz Lighting', title: 'Review request to the Nguyen job', state: 'waiting_them', outbound: true, follow_up_days: 7 }, now - 1 * D);
      s.raise({ area: 'Ortiz Lighting', title: 'Quotes out, waiting on customers', state: 'waiting_them', outbound: true, batch: 3, follow_up_days: 4 }, now - 1 * D);
      s.raise({ area: 'TrailFork app', title: 'Release 44', state: 'auto', progress: 55 }, now - 30 * 60e3);
    },
  },

  clear: {
    title: 'All clear',
    blurb: 'Everything is handled. This is the quiet screen.',
    build(s, now) {
      base(s, now); running(s, now);
      [['Ortiz Lighting', 'Reply to the Hendersons', true], ['TrailFork app', 'Fix the trailhead name', false], ['Ortiz Lighting', 'Send the HOA quote', true], ['Family', 'Sign the field trip form', false]].forEach((r, i) => {
        const l = s.raise({ area: r[0], title: r[1], kind: r[2] ? 'approve' : 'todo', outbound: r[2], follow_up_days: r[2] ? 3 : 0, draft: r[2] ? 'Drafted reply.' : '' }, now - 3 * H);
        s.act(l.id, r[2] ? 'approve' : 'done', { tookMs: 9000 + i * 2000 }, now - 20 * 60e3 + i * 30e3);
      });
      s.ack(s.db.lights.map((l) => l.id));
      s.raise({ area: 'TrailFork app', title: 'Outreach to trail clubs, no reply yet', state: 'waiting_them', outbound: true, batch: 6, follow_up_days: 2 }, now - 1 * D);
      s.raise({ area: 'TrailFork app', title: 'Release 41: offline maps', state: 'auto', progress: 80 }, now - 1 * H);
    },
  },

  'first-day': {
    title: 'First day, empty board',
    blurb: 'A brand-new board with nothing set up.',
    build() { /* nothing at all */ },
  },
};

module.exports = { scenarios, D, H };
