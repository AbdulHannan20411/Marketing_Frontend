import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  SWITCHABLE_CATEGORIES,
  categoryOf,
  categoryOfNotification,
  isAlwaysOn,
  toCategory,
  toPreferences,
} from './notification-category.model';

describe('notification categories', () => {
  it('groups the kinds the backend sends today', () => {
    expect(categoryOf('inbox.message')).toBe('messages');
    expect(categoryOf('campaign.completed')).toBe('campaigns');
    expect(categoryOf('campaign.failed')).toBe('campaigns');
    expect(categoryOf('employee.invited')).toBe('team');
    expect(categoryOf('payment.received')).toBe('billing');
    expect(categoryOf('subscription.expiring')).toBe('billing');
    expect(categoryOf('plan.upgraded')).toBe('billing');
    expect(categoryOf('contacts.limit')).toBe('billing');
    expect(categoryOf('security.new_login')).toBe('security');
    expect(categoryOf('security.account_suspended')).toBe('security');
  });

  it('puts anything it does not recognise in system, which is never silenced', () => {
    expect(categoryOf('meta.disconnected')).toBe('system');
    expect(categoryOf('whatsapp.token.expiring')).toBe('system');
    expect(categoryOf('ai.replies.exhausted')).toBe('system');
    expect(categoryOf('something.brand.new')).toBe('system');
    expect(categoryOf('')).toBe('system');
    expect(isAlwaysOn('system')).toBeTrue();
  });

  it('groups a new kind by its prefix, without this file changing', () => {
    expect(categoryOf('campaign.paused')).toBe('campaigns');
    expect(categoryOf('inbox.assigned')).toBe('messages');
  });

  it('offers only the categories a user may switch off', () => {
    expect(SWITCHABLE_CATEGORIES).toEqual(['messages', 'campaigns', 'team', 'billing']);
    expect(isAlwaysOn('security')).toBeTrue();
    expect(isAlwaysOn('messages')).toBeFalse();
  });

  describe('reading what the server stored', () => {
    it('defaults to everything on', () => {
      expect(toPreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
      expect(toPreferences({})).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it('takes the switches it understands and ignores the rest', () => {
      const prefs = toPreferences({ messages: false, campaigns: true, nonsense: false });
      expect(prefs.messages).toBeFalse();
      expect(prefs.campaigns).toBeTrue();
      expect(prefs.team).toBeTrue();
      expect('nonsense' in prefs).toBeFalse();
    });

    it('never lets a stored value silence security or system', () => {
      const prefs = toPreferences({ security: false, system: false });
      expect(prefs.security).toBeTrue();
      expect(prefs.system).toBeTrue();
    });

    it('treats a non-boolean as on, rather than guessing', () => {
      expect(toPreferences({ messages: 'no' }).messages).toBeTrue();
    });
  });

  describe('the category the server sends', () => {
    it('takes the server own answer over the prefix rule', () => {
      // The server decided this one is billing; the prefix would say campaigns.
      expect(categoryOfNotification({ category: 'billing', kind: 'campaign.completed' })).toBe('billing');
    });

    it('falls back to the prefix when the field is absent or unknown', () => {
      expect(categoryOfNotification({ kind: 'campaign.completed' })).toBe('campaigns');
      expect(categoryOfNotification({ category: null, kind: 'inbox.message' })).toBe('messages');
      expect(categoryOfNotification({ category: 'nonsense', kind: 'inbox.message' })).toBe('messages');
    });

    it('accepts a category name in any case, and rejects anything else', () => {
      expect(toCategory('Messages')).toBe('messages');
      expect(toCategory('messages')).toBe('messages');
      expect(toCategory('nonsense')).toBeNull();
      expect(toCategory(undefined)).toBeNull();
    });
  });
});
