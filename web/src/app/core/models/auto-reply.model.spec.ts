import {
  AUTO_REPLY_RANGES,
  type AutoReplyDraft,
  autoReplyProblems,
  formatMinutes,
  formatSeconds,
} from './auto-reply.model';

const VALID: AutoReplyDraft = {
  enabled: true,
  triggers: { greeting: true, first_message: false, unanswered: false },
  delaySeconds: 60,
  unansweredAfterMinutes: 300,
  instructions: 'We are a salon in Lahore.',
  maxPerConversationPerDay: 3,
};

/**
 * These mirror the API's ranges. The point of testing them here is that the
 * screen must refuse what the server would refuse — a save that fails
 * validation after a round trip is a worse experience than a disabled button.
 */
describe('autoReplyProblems', () => {
  it('accepts a valid draft', () => {
    expect(autoReplyProblems(VALID)).toEqual([]);
  });

  it('enforces the delay range at both ends', () => {
    const { min, max } = AUTO_REPLY_RANGES.delaySeconds;

    expect(autoReplyProblems({ ...VALID, delaySeconds: min })).toEqual([]);
    expect(autoReplyProblems({ ...VALID, delaySeconds: max })).toEqual([]);
    expect(autoReplyProblems({ ...VALID, delaySeconds: min - 1 }).length).toBe(1);
    expect(autoReplyProblems({ ...VALID, delaySeconds: max + 1 }).length).toBe(1);
  });

  it('enforces the unanswered wait and the per-customer ceiling', () => {
    expect(autoReplyProblems({ ...VALID, unansweredAfterMinutes: 4 }).length).toBe(1);
    expect(autoReplyProblems({ ...VALID, unansweredAfterMinutes: 1441 }).length).toBe(1);
    expect(autoReplyProblems({ ...VALID, maxPerConversationPerDay: 0 }).length).toBe(1);
    expect(autoReplyProblems({ ...VALID, maxPerConversationPerDay: 21 }).length).toBe(1);
  });

  it('treats an emptied number box as out of range rather than valid', () => {
    // An empty input parses to NaN, and every comparison against NaN is false —
    // so a naive range check would call it acceptable.
    expect(autoReplyProblems({ ...VALID, delaySeconds: Number.NaN }).length).toBe(1);
  });

  it('refuses instructions past the limit', () => {
    const limit = AUTO_REPLY_RANGES.instructionsMaxLength;

    expect(autoReplyProblems({ ...VALID, instructions: 'a'.repeat(limit) })).toEqual([]);
    expect(autoReplyProblems({ ...VALID, instructions: 'a'.repeat(limit + 1) }).length).toBe(1);
  });

  it('requires an occasion only while auto-reply is on', () => {
    const none = { greeting: false, first_message: false, unanswered: false };

    expect(autoReplyProblems({ ...VALID, triggers: none }).length).toBe(1);
    // Off with nothing chosen is a coherent state: it is how you switch it off.
    expect(autoReplyProblems({ ...VALID, enabled: false, triggers: none })).toEqual([]);
  });
});

describe('formatting', () => {
  it('reads a delay in seconds or minutes', () => {
    expect(formatSeconds(1)).toBe('1 second');
    expect(formatSeconds(45)).toBe('45 seconds');
    expect(formatSeconds(60)).toBe('1 minute');
    expect(formatSeconds(1800)).toBe('30 minutes');
  });

  it('reads a wait in minutes or hours', () => {
    expect(formatMinutes(5)).toBe('5 minutes');
    expect(formatMinutes(60)).toBe('1 hour');
    expect(formatMinutes(300)).toBe('5 hours');
    expect(formatMinutes(90)).toBe('1.5 hours');
  });
});
