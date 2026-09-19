const STORAGE_KEY = 'vd.device.id';

/** What the API accepts: letters, digits, `-` and `_`, up to 64 characters. */
const VALID = /^[A-Za-z0-9_-]{1,64}$/;

/** Kept for this page's lifetime when storage is blocked, so one tab stays one device. */
let fallback: string | null = null;

/**
 * This browser's device id, sent as `X-Device-Id` on every API call.
 *
 * Generated once and kept in `localStorage`, so the same browser is recognised
 * as the same device across sessions. Without it the server falls back to a
 * user-agent fingerprint, under which every Chrome on Windows looks like one
 * device — and the device list and risk score both get worse.
 *
 * Not a secret and not an identity: it is only ever compared, never trusted to
 * authenticate anything.
 */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && VALID.test(stored)) {
      return stored;
    }
    const created = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // Blocked storage (private mode, policy): still one id per tab rather than one per request.
    fallback ??= crypto.randomUUID();
    return fallback;
  }
}
