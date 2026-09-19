import {
  accessProblems,
  accountHealth,
  atAccountLimit,
  toggleAccessPermission,
  type WhatsAppAccount,
} from './whatsapp-account.model';

const NOW = new Date('2026-09-18T12:00:00Z').getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function account(overrides: Partial<WhatsAppAccount> = {}): WhatsAppAccount {
  return {
    id: 'wa_1',
    label: 'Sales',
    displayPhoneNumber: '+92 300 1234567',
    verifiedName: 'Northwind',
    wabaId: 'waba_1',
    phoneNumberId: 'pn_1',
    status: 'connected',
    qualityRating: 'green',
    messagingTier: 'tier_1k',
    messagingLimit: 1000,
    messagesLast24h: 10,
    tokenExpiresAt: null,
    connectedAt: new Date(NOW - 30 * DAY).toISOString(),
    isDefault: true,
    myPermissions: ['view', 'reply', 'broadcast'],
    health: {
      apiStatus: 'ok',
      phoneNumberStatus: 'CONNECTED',
      accountStatus: 'APPROVED',
      lastWebhookAt: new Date(NOW - HOUR).toISOString(),
      lastMessageSentAt: null,
      lastMessageReceivedAt: null,
      lastError: null,
    },
    ...overrides,
  };
}

describe('toggleAccessPermission', () => {
  it('ticks View along with Reply or Broadcast', () => {
    expect(toggleAccessPermission([], 'reply', true)).toEqual(['view', 'reply']);
    expect(toggleAccessPermission([], 'broadcast', true)).toEqual(['view', 'broadcast']);
  });

  it('clears the whole row when View is unticked', () => {
    // Reply without View is a set the API refuses, so the editor never makes one.
    expect(toggleAccessPermission(['view', 'reply', 'broadcast'], 'view', false)).toEqual([]);
  });

  it('keeps View when Reply is unticked', () => {
    expect(toggleAccessPermission(['view', 'reply'], 'reply', false)).toEqual(['view']);
  });

  it('returns a stable order whatever order the clicks came in', () => {
    expect(toggleAccessPermission(['broadcast', 'view'], 'reply', true)).toEqual(['view', 'reply', 'broadcast']);
  });
});

describe('accessProblems', () => {
  it('accepts no access at all', () => {
    expect(accessProblems({ access: [], defaultAccountId: null })).toEqual([]);
  });

  it('refuses a default the person cannot see', () => {
    const problems = accessProblems({
      access: [{ accountId: 'wa_1', permissions: ['view'] }],
      defaultAccountId: 'wa_2',
    });
    expect(problems.length).toBe(1);
  });

  it('refuses Reply without View and duplicate numbers', () => {
    expect(
      accessProblems({ access: [{ accountId: 'wa_1', permissions: ['reply'] }], defaultAccountId: null }).length,
    ).toBe(1);
    expect(
      accessProblems({
        access: [
          { accountId: 'wa_1', permissions: ['view'] },
          { accountId: 'wa_1', permissions: ['view'] },
        ],
        defaultAccountId: null,
      }).length,
    ).toBe(1);
  });
});

describe('accountHealth', () => {
  it('calls a connected, recently heard-from number healthy', () => {
    expect(accountHealth(account(), NOW)).toEqual({ level: 'healthy', reasons: [] });
  });

  it('marks a disconnected number down', () => {
    expect(accountHealth(account({ status: 'disconnected' }), NOW).level).toBe('down');
  });

  it('warns a week before the token expires, and calls an expired one down', () => {
    const soon = accountHealth(account({ tokenExpiresAt: new Date(NOW + 3 * DAY).toISOString() }), NOW);
    expect(soon.level).toBe('attention');
    expect(soon.reasons[0]).toContain('3 days');

    const expired = accountHealth(account({ tokenExpiresAt: new Date(NOW - HOUR).toISOString() }), NOW);
    expect(expired.level).toBe('down');
  });

  it('treats a null token expiry as no expiry, not as expired', () => {
    expect(accountHealth(account({ tokenExpiresAt: null }), NOW).level).toBe('healthy');
  });

  it('flags a connected number Meta has gone quiet on', () => {
    // The one failure nothing else on screen would reveal.
    const silent = account({
      health: { ...account().health, lastWebhookAt: new Date(NOW - 2 * DAY).toISOString() },
    });
    const verdict = accountHealth(silent, NOW);
    expect(verdict.level).toBe('attention');
    expect(verdict.reasons).toContain('No webhook received in 24 hours');
  });

  it('does not expect webhooks from a disconnected number', () => {
    const verdict = accountHealth(
      account({ status: 'disconnected', health: { ...account().health, lastWebhookAt: null } }),
      NOW,
    );
    expect(verdict.reasons).not.toContain('No webhook received in 24 hours');
  });

  it('keeps every reason, with the level set by the worst', () => {
    const verdict = accountHealth(account({ status: 'error', qualityRating: 'yellow' }), NOW);
    expect(verdict.level).toBe('down');
    expect(verdict.reasons.length).toBe(2);
  });
});

describe('atAccountLimit', () => {
  it('knows unlimited from full', () => {
    expect(atAccountLimit({ items: [], limit: null, used: 50, myDefaultAccountId: null })).toBeFalse();
    expect(atAccountLimit({ items: [], limit: 3, used: 3, myDefaultAccountId: null })).toBeTrue();
    expect(atAccountLimit({ items: [], limit: 3, used: 2, myDefaultAccountId: null })).toBeFalse();
  });
});
