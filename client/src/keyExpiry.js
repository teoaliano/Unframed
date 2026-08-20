// A key can be given an expiry while the user approves it at OpenRouter, and
// nothing renews one: the credential is long-lived by design and has no refresh
// mechanism, so the only useful thing to do with `expires_at` is say so BEFORE
// the key lapses. Afterwards it is indistinguishable from a revoked key -- the
// status route reads the 401 and reports `revoked` -- which is accurate and
// arrives too late to be worth anything.
//
// Returns null whenever there is nothing worth saying, which includes an expiry
// far enough out that mentioning it is noise. A separate module because getting
// the boundaries wrong is silent: an off-by-one here tells someone their key is
// fine on the morning it dies.
const HOUR = 3_600_000;

export function expiryNote(iso, now = Date.now()) {
  if (!iso) return null;
  const at = Date.parse(iso);
  // An upstream string in a shape we do not understand is not worth guessing at.
  if (Number.isNaN(at)) return null;

  const hours = (at - now) / HOUR;
  if (hours <= 0) return 'This key has expired at OpenRouter. Reconnect to keep generating.';

  if (hours < 48) {
    // Rounded up, never down: "expires in 0 hours" is not a sentence, and a key
    // with 40 minutes left should not be reported as having none.
    const h = Math.max(1, Math.ceil(hours));
    return `This key expires in ${h} hour${h === 1 ? '' : 's'}, and nothing renews it. Reconnect before then.`;
  }

  const days = Math.floor(hours / 24);
  if (days <= 14) return `This key expires in ${days} days, and nothing renews it.`;

  return null;
}
