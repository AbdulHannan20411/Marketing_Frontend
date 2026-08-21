/**
 * The password policy, in one place.
 *
 * Mirrors what the API enforces so the rules are visible *before* submitting
 * rather than arriving as a rejection. Two screens set passwords — the
 * invitation/reset flow and the profile form — and a policy that drifts between
 * them would let someone choose a password on one screen that the other would
 * refuse.
 *
 * The API remains the authority: this is a courtesy check, and a `422` with
 * field errors is still handled wherever a password is submitted. The minimum
 * length is server configuration, so if it is ever raised this mirror goes
 * stale — the failure mode is a server rejection rendered inline, which is
 * survivable, and cheaper than fetching the policy on every startup.
 */

export const PASSWORD_MIN_LENGTH = 12;

/**
 * Fragments the server rejects anywhere in a password, case-insensitively.
 *
 * Without this mirrored here, `marketingplan2026` passes every visible rule —
 * seventeen characters, letters, digits, strength bar full — and is then
 * refused by the API, which reads as an unexplained failure rather than a rule
 * the user could have seen.
 *
 * Listing them costs nothing: these are the first guesses anyone would make.
 */
export const FORBIDDEN_PASSWORD_FRAGMENTS: readonly string[] = [
  'password',
  'qwerty',
  'welcome',
  'letmein',
  'marketing',
  'whatsapp',
  '123456',
];

export interface PasswordRule {
  readonly label: string;
  readonly met: boolean;
}

/** Whether the value avoids every forbidden fragment. Empty counts as clean. */
export function avoidsCommonPatterns(value: string): boolean {
  if (value === '') {
    return true;
  }
  const lower = value.toLowerCase();
  return !FORBIDDEN_PASSWORD_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

export function passwordRules(value: string): readonly PasswordRule[] {
  return [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: value.length >= PASSWORD_MIN_LENGTH },
    { label: 'Contains a letter', met: /[a-zA-Z]/.test(value) },
    { label: 'Contains a digit', met: /\d/.test(value) },
    // Server wording, so a client refusal and a server refusal read alike.
    { label: 'Does not contain a common word or pattern', met: avoidsCommonPatterns(value) },
  ];
}

export function meetsPasswordPolicy(value: string): boolean {
  return passwordRules(value).every((rule) => rule.met);
}

/**
 * A coarse 0–3 strength read, purely to give the field some feedback.
 *
 * Deliberately not a real entropy estimate — presenting one as authoritative
 * would imply a guarantee the policy does not make.
 */
export function passwordStrength(value: string): number {
  if (value === '') {
    return 0;
  }

  // A full bar is reserved for a password that actually passes. Scoring purely
  // by rules met would show three-of-four as full, telling the user they were
  // done moments before the field turned red.
  if (!meetsPasswordPolicy(value)) {
    return passwordRules(value).filter((rule) => rule.met).length >= 3 ? 2 : 1;
  }

  return 3;
}
