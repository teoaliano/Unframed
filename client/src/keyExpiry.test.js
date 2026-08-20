// node client/src/keyExpiry.test.js  (also runs as part of `npm test`)
import assert from 'node:assert/strict';
import { expiryNote } from './keyExpiry.js';

const now = Date.parse('2026-08-20T12:00:00Z');
const at = (iso) => expiryNote(iso, now);

// Nothing to say: no expiry set, or a string we cannot read. Both must be silent
// rather than rendering "Invalid Date" or "NaN hours" into the dialog.
assert.equal(at(null), null);
assert.equal(at(''), null);
assert.equal(at('whenever'), null);
assert.equal(at('2026-13-45T99:99:99Z'), null);

// Already gone. Reported as expired rather than as "expires in 0 hours", and
// distinct from the revoked wording, since reconnecting is the fix for both but
// the cause is not the same.
assert.match(at('2026-08-20T11:59:00Z'), /has expired/);
assert.match(at('2026-08-01T00:00:00Z'), /has expired/);

// The real case that prompted this: the key observed on 2026-08-20 expired the
// same evening, and the dialog said nothing at all.
assert.match(at('2026-08-20T23:14:00.002Z'), /expires in 12 hours/);

// Hours are rounded UP, so a key with minutes left never reads as having none,
// and the singular is a real sentence.
assert.match(at('2026-08-20T12:40:00Z'), /expires in 1 hour,/);
assert.match(at('2026-08-20T13:30:00Z'), /expires in 2 hours/);

// The hour/day boundary. Just under 48h still counts in hours; at 48h it becomes
// days, and must not say "2 days" one minute and "48 hours" the next.
assert.match(at('2026-08-22T11:59:00Z'), /expires in 48 hours/);
assert.match(at('2026-08-22T12:01:00Z'), /expires in 2 days/);

// Days are floored, so the sentence never promises a day the key does not have.
assert.match(at('2026-08-25T11:00:00Z'), /expires in 4 days/);

// Far enough out that saying so is noise, and the line disappears entirely.
assert.match(at('2026-09-03T12:00:00Z'), /expires in 14 days/);
assert.equal(at('2026-09-04T13:00:00Z'), null, 'past a fortnight, silent');
assert.equal(at('2027-08-20T12:00:00Z'), null);

console.log('keyExpiry.test.js: ok');
