---
description: Set up Switchboard. Asks you three one-tap questions on the board, then checks that it works.
---

Set up the person's Switchboard now.

1. Call the `setup_guide` tool from the `switchboard` MCP server and follow its `guide` exactly. You are already
   connected, so skip any install step. Call `open_board` so the board is open in their browser.
2. Raise the setup questions on the board as one-tap lights, with the keys and options the guide gives. Do not
   ask them in this chat.
3. Tell the person in one sentence: "Your board is open with a few quick questions; tap an answer on each." Then wait
   for their answers with `wait_for_decision`, and do what each answer says.
4. Finish with the "Setup check" light. Say setup is done only after that round trip has worked, and report what you
   set up in plain words: the containers, what always waits for their tap, and how the board gets their attention.

Put nothing in their list they did not ask for: no "reach out to" suggestions in front of them. If this chat already
named one (an old lead, a past customer), it goes in only the way the guide says, with `optional: true` and
`last_contact`, folded in "Reach out?" where they can look it up and choose. Send nothing to anyone.

$ARGUMENTS
