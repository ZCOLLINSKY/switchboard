# HTTP API

Base: `http://127.0.0.1:4747`. Writes are `POST` with `content-type: application/json`.

**Page-only calls.** `act`, `bulk`, `promote`, `demote`, `settings`, `learn`, `unlearn`, `reoffer`, `areas/rename`, `areas/remove`, `sim`, `dump` and loading the examples (`demo` without `clear`) are the person's own actions. They need the page key in an `x-switchboard-key` header. A browser gets the key by opening the link the server prints (`/?key=…`); the page keeps it for that address and port and removes it from the address bar. There is no cookie. Without the key these calls answer 403. A refused call changes nothing. Assistants and scripts use the other calls. `/api/state` says `canAct` for the caller.

**From another device.** A request counts as this computer's only when it comes from a loopback address, names `localhost`, `127.0.0.1` or `[::1]` as its host, and carries no proxy header (`X-Forwarded-For`, `Forwarded`, `X-Forwarded-Host`, `X-Real-IP`, `Tailscale-User-Login` or `Tailscale-User-Name`). Anything else, such as a phone through `tailscale serve`, needs the key for every `/api` call, reading included. The page itself and `GET /api/health` stay open, and health then leaves out `data`. `GET /api/events` may carry the key as `?key=…`, because a browser's live feed cannot send headers.

| Call | What it does |
|---|---|
| `GET /api/state` | Everything the screen shows: areas, lights, queue order, counts, total seconds. Also `lastCheckIn` (when an assistant last asked for decisions), `connected` (whether a light has ever come in through the assistant connector, which sends `x-switchboard-client: mcp`) and `connect`, how to connect an assistant: `plugin` (the two Claude Code lines), `mcp` (the `claude mcp add` line for this board, with its folder and port when they are not the usual ones), `desktop` (the release page with the `.mcpb` file) and `folder`. `connect` is `null` in a simulation |
| `POST /api/lights` | Raise a light (fields below) |
| `POST /api/lights/:id` | Update a light: any field below, plus `state` and `reason`. `{"adopt":true,"agent":"NAME"}` takes over a light that was raised with no `agent` (see the state rules) |
| `POST /api/lights/:id/act` | What the person does: `{"action":"approve"|"no"|"answer"|"done"|"snooze"|"wake"|"drop"|"move"|"redo"|"replied"|"stop_followups"|"release"|"release_at"|"undo"}` with `rev`, `text`, `value`, `days`, `until`, `why` or `area`, and `tookMs` (how long the person looked, which the reading-speed rule uses) |
| `POST /api/bulk` | `{"ids":[...],"action":"approve"|"no"|"done"|"drop"|"snooze"|"undo"}`. Refuses to approve messages to people in bulk |
| `POST /api/decisions` | `{"agent":"NAME"}` collects what the person decided on lights `NAME` raised (and on lights raised with no name): `decisions`, `sent_by_you`, `need_drafts`, `unsorted`. A decision appears once its hold has passed. **Collecting is a commitment and a claim**: the person can no longer undo it, and nobody else is handed it for 10 minutes. Each decision carries `decision_id`, the approved `text`, `to`, `attachments` and `payload` as they were at the tap, `retry_of` when it repeats a failed one, and `needs_check: true` when it was collected before and never reported. `"all":true` includes other assistants' lights; `"only":true` hands out only lights raised (or adopted) by `NAME`, never ones raised with no name. A `GET` answers 405 |
| `POST /api/complete` | `{"id","decision_id","outcome":"sent"|"done"|"failed"|"unsure","detail"}`. `decision_id` is required; a report for a decision that was since replaced is refused, and so is one sent before the hold ends. `sent` turns a message blue and starts the follow-up clock. `failed` turns the light red with `detail`. `unsure` asks the person whether it went out |
| `POST /api/wait` | `{"id","seconds","agent"}` waits up to 50 seconds for one light's decision. Only for a light this `agent` raised (or one raised with no name). Getting the answer this way collects it, like `decisions`. Answers `{"decided":false}` or `{"decided":true,"decision":{...}}`; if the person sent it themselves, the decision says `sent_by_you: true`. For a light another agent raised it answers at once with `{"decided":false,"reason":"raised by NAME; only that session can collect it"}`. Hanging up before the answer collects nothing |
| `GET /api/pending?agent=NAME` | Counts only, and collects nothing: `decisions` ready for `NAME` (or for anyone, on lights raised with no name), `held` (still inside their hold) with `next_release_at`, `unreported` (collected, claim still running) and `sent_by_you`. `&only=1` counts only lights raised (or adopted) by `NAME`. For a relay that should start work only when there is some |
| `GET /api/history?q=` | Past decisions, newest first, filtered by words |
| `GET /api/fit?minutes=N` | What fits in N minutes: due today and blockers first, then the rest in order, none of those taking more than half |
| `POST /api/ack` | `{"ids":[...],"agent"}`: short for `complete` with `done` on each, only for decisions this agent collected. Messages to people are skipped (they need `sent`, `failed` or `unsure`); what was skipped comes back in `warnings` |
| `POST /api/areas` | Create or update a container: `name`, `note`, `voice` (how its drafts should sound; rules the person set with "Always" are kept), `color`, `wake_at` (a date: the container's lights stay out of the queue until then) |
| `POST /api/areas/rename`, `/api/areas/remove` | `{"id","name"}` / `{"id"}`. Page only. Remove only works on a container with no open lights |
| `GET /api/health` | `{"ok":true,"name":"switchboard","data","lock"}`: whether a board answers here, where its data is, and the id of its lock |
| `POST /api/dump` | `{"text":"..."}` files a quick note under the best-matching container. Several things in one sentence become several lights; returns `{"lights":[...]}` |
| `POST /api/settings` | `{"autonomy":true}` switches the "runs by itself" offer on or off. Off by default |
| `POST /api/promote` | `{"key":"<container id>|<action type>","yes":true}`. Refused unless autonomy is on and that key has a real streak |
| `POST /api/demote` | `{"key":"…"}` stops a rule |
| `POST /api/learn` | `{"area","why","yes"}` adds a repeated "Ask for changes" note to the container's voice note, or dismisses the offer |
| `POST /api/demo` | Add the examples (page only); `{"clear":true}` removes them (anyone) |
| `POST /api/sim` | In a simulation only: `{"name"}` loads a scenario |
| `GET /api/events` | Server-sent events; a `change` event fires after every write |

## Light fields

| Field | Notes |
|---|---|
| `area` | Container name. Required. A new name creates the container |
| `title` | Required. Written as an action |
| `state` | Raise with `need_you` (default), `waiting_them`, `auto`, `queued` or `broken`. The board also uses `approved` (yes, not yet sent), `done` and `dropped`. An unknown state or kind is an error |
| `agent` | Who raised it. `get_decisions` returns only the caller's own lights |
| `key` | A stable thread id. Raising again with the same key and agent updates the same light, including its `state`. A new draft or source on a light that was waiting or queued brings it back to `need_you`. `area` cannot change this way and comes back in `warnings`. Without a key, raising exactly the same light again (same container, agent, title, draft, change, options, recipient, attachments and payload) while the first is still open and undecided returns the first one with a warning instead of a second light; lights with an `action_type` are never matched this way |
| `to` | Who it goes to, shown on the card and returned with the decision |
| `attachments` | Up to 6 `{name, link}`, shown as chips |
| `payload` | Anything up to 4 KB, stored untouched and handed back with the decision |
| `expect_by` | For `auto`: when you expect to report again. Silence past it turns the light amber |
| `kind` | `approve` (default), `decide`, `sense`, `todo`, `fix` |
| `draft` | Exact text to send or apply |
| `source` | What came in that triggered this |
| `change_from`, `change_to` | For a change to a record |
| `options` | Up to 6 answer buttons |
| `link` | Page to open |
| `phone` | Recipient for a text the person sends from their own phone |
| `channel` | `agent` (default), `sms`, `copy` |
| `outbound` | `true` if approving sends a message to a person |
| `follow_up_days`, `follow_up_draft` | How long to wait for a reply, and optional follow-up text |
| `seconds` | The tap, in seconds. Corrected by how long this job type really takes once there are three samples. Omit it and the person's own middle value is used; with no samples the light counts as "not timed yet" |
| `work_minutes` | Work away from the board (a phone call, a form, an errand). Listed as a chore, outside the headline minutes, "Under 2 min" and rapid mode |
| `holds_up` | On a `broken` light: what it blocks, in a few words. Without it a broken job counts as background and sorts last |
| `due` | ISO date or datetime. A bare date (`2026-11-20`) means the end of that day where the person is. Dates before 2020 are refused with a warning. Due within a day sorts to the top |
| `value` | Whole dollars riding on it. Higher sorts first |
| `next` | One line on what happens after they act |
| `action_type` | Stable name for a recurring action; streaks are tracked per type |
| `batch` | How many similar items this light stands for |
| `progress` | 0 to 100, for `auto` lights |
| `note` | Background, up to 4,000 characters. Not for what you changed |
| `changed` | After a request for changes: one line on what you changed. Shown next to the request; cleared when the person decides |
| `question` | A question back to the person about their request. Shown with a reply box; the reply comes back as a new request |

## State rules

- Approving a light an assistant will act on moves it to `approved`, shown as "approved, not yet sent". `complete` with `sent` moves a message to `waiting_them` (or `done` with no follow-up); `done` closes a change. If the person sends it themselves (`channel` `sms` or `copy`), approval moves it straight on.
- An approval nobody collects within 15 minutes turns red: "Approved 15 minutes ago. No assistant has collected it." The text and the decision stay; an assistant that arrives later still gets it. This needs an assistant to have checked in (called `decisions` or `wait`) in the last 24 hours. On a board where none has, the approval stays `approved` with `waitingCheckIn: true` and says "Waiting for an assistant to check in". `/api/state` gives `lastCheckIn`.
- While a decision the person made has not been collected, an assistant may change only `note`, `progress`, `expect_by`, `seconds`, `work_minutes`, `holds_up` and `next`. Everything else, including `state`, `to`, `attachments` and `payload`, is refused. After an approval is collected and until it is reported, the same holds except that `state` may change: a new message on the thread is refused until the first one is reported (then the same key brings it back to the person). The assistant that collected it keeps its claim by sending `progress` or `note` with its `agent`.
- New words (`draft`, `to`, `options`, `title`…) on a light showing a failure or "Keep chasing?" replace that card with a new request. While the person is being asked whether a message went out, such changes are refused.
- A light with a `to` is a message to a person (`outbound`), whether or not `outbound` was sent.
- A draft longer than 4,000 characters is refused, never cut. Other text that is cut (title, note, options) comes back in `warnings`.
- A light raised with no `agent` (MCP: `for_anyone: true`) can be collected by any assistant. An assistant can take one over with `adopt` (and its `agent`), after which only that assistant is handed its decisions (or one collecting with `all`) and the same `key` from it updates that light. Adopting is refused for a light another assistant raised, for the person's own notes, while a decision on it is not settled (not reported, failed, or being checked with the person), and when the adopter already has an open light with the same `key`.
- "I sent it" (channels `sms` and `copy`) closes the decision as sent by the person. It is listed once under `sent_by_you` and never under `decisions`.
- A decision that was collected and not reported within 10 minutes turns red and asks the person "It went out / It did not go out" ("It was done / It was not done" for other decisions). Nothing is handed out again until they answer; "It did not go out" re-issues it with `retry_of`.
- "Try again" on a failed light re-issues the same decision (same action, value and text) with `retry_of` set. It never turns a "no" or an answer into an approval.
- A `waiting_them` light past its follow-up date returns to `need_you`. A message to a person comes back titled "Follow up: …"; anything else comes back as a to-do titled "Check on: …". What was sent before is kept. If there is no `follow_up_draft`, it appears in `need_drafts` with `sent_before`. After two follow-ups the third asks "Keep chasing?".
- `act` with `replied` or `stop_followups` ends the chasing from the person's side.
- A raise or update that ignores something returns `warnings`, for example a number out of range, a link that is not http, an unknown field, or a draft that names a day while `due` is empty.
- Every change is appended to `events.jsonl`, including snoozes, moves, releases, settings, rules, containers and clearing the examples. `GET /api/history` reads from it; each row has `to` and `sentAt` when it went out.
- A snoozed light leaves the queue until its date, or until something new arrives on it. `act` with `snooze` takes `days` (1 to 60) or an `until` time within a year; a snooze ends at least two hours before the light's `due`. Only lights that are asking can be snoozed. `act` with `wake` ends a snooze now.
- The queue is ordered by meaning, and `/api/state` returns the same list in words as `order`: due within a day; messages to people waiting on you (among those, more `value` first; money never outranks a deadline or a person); broken jobs that hold something up; everything else by age; broken background jobs. Each light carries its `tier`, and `keep` when it must never be folded away.
- `/api/state` also returns `seconds` (taps only), `chores` `{count, minutes}`, `unsized`, and `counts.snoozed`.
- The hold before a decision can be collected depends on what it is: none for the person's own to-dos and answers on broken jobs, 20 seconds for changes and answers, 60 for a message to a person. `act` with `release` ends a hold now; `release_at` with `until` moves it (up to a day).
- The third `snooze` on a light needs an `until` date. A snooze does not reset a light's age.
- Decisions on the person's own notes and to-dos are never handed out. At most 50 decisions come back per call, with `more` saying how many are left. Finished lights older than 30 days move to `archive.jsonl`.
- `act` with `undo` puts a light back as it was, until an agent has picked the decision up. Undo on a quick note removes the note.
- Every light in `/api/state` carries a `rev`, a fingerprint of what is being approved (title, draft, change, options, recipient, attachments and payload). `approve` must send it back as `rev`, and bulk approve as `revs: {id: rev}`; `answer`, `no` and `done` are checked against it when sent. If the light changed since, the answer is "This changed. Look again."
- `approve`, `no`, `answer` and `done` are refused unless the light is gold or red. A message to a person with no text cannot be approved.
- `/api/state` includes `held`: every decision still inside its undo window.
- Every response carries `X-Frame-Options: DENY`. The data folder is 0700 and its files 0600. A second server on the same data folder refuses to start and says where the first one is.
- One in 20 automatic approvals stays in the queue as a spot check ("Looks right" / "Flag it"). A flag, a `failed` report, or an agent marking an automatic approval `broken` ends that action type's autonomy. Cards the board puts up itself (spot checks, failures, "not sure", "Keep chasing?", "Keep going?") accept only their own buttons.
- A `need_you` or `broken` light older than two days is flagged `stale`.
- Trust is per container and `action_type`, belongs to the assistant that earned it, and is only for typed changes: `change_from`/`change_to` set, no `draft`, no `to`, not `outbound`. The streak counts single approvals that carried a `rev`, not bulk taps, and needs ten of them on three different days. A promoted rule approves a matching typed change on arrival; a light with the same label that is not a typed change still asks. The first five runs and then a random one in twenty stay in the queue as a look ("Looks right" / "Flag it"). More than 20 runs in an hour pauses the rule and raises a "Keep going?" light.
- `act` with `redo` and `why` asks for changes ("Ask for changes" on the page). The decision carries `original_draft` (the text sent back), `draft_now` and `source`. Updating the light to `need_you` with the new draft closes the request: the assistant gets a decision with action `redo` and the reason as `text`, and the light waits as `queued` until the assistant updates it.
- A message to a person approved faster than about 150 ms per word is held twice as long. Each light says `firstTime` when its `to` has never been sent to before.
