'use strict';
// Ports above 1024 that browsers will not open and Node's fetch will not call (the "bad ports" of the Fetch standard).
// A board there would start and then be unreachable from its own page and its own connector, so it is refused up front.
const UNSAFE = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);
const unsafePort = (n) => UNSAFE.has(Number(n));
const unsafeMessage = (n) => `Port ${n} is one that browsers refuse to open and Node's fetch refuses to call, so the board would be unreachable there. Pick another, like 4747.`;
module.exports = { unsafePort, unsafeMessage };
