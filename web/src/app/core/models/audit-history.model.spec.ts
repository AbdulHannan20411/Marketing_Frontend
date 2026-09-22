import {
  auditActorName,
  formatAuditValue,
  humaniseProperty,
  toAuditChanges,
  toAuditEntry,
} from './audit-history.model';

describe('audit history model', () => {
  describe('reading a change set', () => {
    it('reads the audit table own shape: a map of column to old and new', () => {
      const changes = toAuditChanges({
        Name: { old: 'Template A', new: 'Template B' },
        Status: { old: 'Draft', new: 'Published' },
      });

      expect(changes.length).toBe(2);
      expect(changes[0]).toEqual(
        jasmine.objectContaining({ property: 'Name', label: 'Name', oldValue: 'Template A', newValue: 'Template B' }),
      );
      expect(changes[1].oldValue).toBe('Draft');
    });

    it('reads a projected list of property, oldValue and newValue', () => {
      const changes = toAuditChanges([
        { property: 'Name', oldValue: 'Template A', newValue: 'Template B' },
        { property: 'Status', oldValue: 'Draft', newValue: 'Published' },
      ]);

      expect(changes.map((change) => change.property)).toEqual(['Name', 'Status']);
    });

    it('reads the JSON column when it arrives as a string', () => {
      expect(toAuditChanges('{"Name":{"old":"A","new":"B"}}')[0].newValue).toBe('B');
      expect(toAuditChanges('')).toEqual([]);
      expect(toAuditChanges('not json')).toEqual([]);
    });

    it('carries only what the server sent — unchanged fields never appear', () => {
      const changes = toAuditChanges({ Name: { old: 'A', new: 'B' } });
      expect(changes.length).toBe(1);
      expect(changes.some((change) => change.property === 'Category')).toBeFalse();
    });

    it('keeps a redacted field as changed, with no values', () => {
      const [change] = toAuditChanges({ PasswordHash: { redacted: true } });
      expect(change.redacted).toBeTrue();
      expect(change.oldValue).toBeNull();
      expect(change.newValue).toBeNull();
    });

    it('treats a create, which has no old value, as such', () => {
      const [change] = toAuditChanges({ Name: { new: 'Template A' } });
      expect(change.oldValue).toBeNull();
      expect(change.newValue).toBe('Template A');
    });

    it('drops the bookkeeping columns, which only repeat the entry heading', () => {
      const changes = toAuditChanges({
        Color: { old: 'danger', new: 'info' },
        ModifiedBy: { old: null, new: 16 },
        ModifiedOn: { old: null, new: '2026-08-14T16:40:00Z' },
        RowVersion: { old: 1, new: 2 },
        IsDeleted: { old: false, new: true },
        TenantId: { old: 7, new: 7 },
      });

      expect(changes.map((change) => change.property)).toEqual(['Color']);
    });

    it('drops them from a projected list too', () => {
      const changes = toAuditChanges([
        { property: 'Name', oldValue: 'a', newValue: 'b' },
        { property: 'modified_on', oldValue: null, newValue: 'x' },
      ]);
      expect(changes.map((change) => change.property)).toEqual(['Name']);
    });

    it('drops entries with no property, and copes with nonsense', () => {
      expect(toAuditChanges([{ oldValue: 'x' }])).toEqual([]);
      expect(toAuditChanges(null)).toEqual([]);
      expect(toAuditChanges(42)).toEqual([]);
    });
  });

  describe('wording and values', () => {
    it('makes a property name readable', () => {
      expect(humaniseProperty('BodyText')).toBe('Body text');
      expect(humaniseProperty('whatsapp_account_id')).toBe('Whatsapp account');
      expect(humaniseProperty('Name')).toBe('Name');
      expect(humaniseProperty('MaxSearchRadiusKm')).toBe('Max search radius km');
    });

    it('prefers a label the server sends', () => {
      const [change] = toAuditChanges([{ property: 'BodyText', label: 'Message body', newValue: 'x' }]);
      expect(change.label).toBe('Message body');
    });

    it('formats values a person has to read', () => {
      expect(formatAuditValue(true)).toBe('Yes');
      expect(formatAuditValue(false)).toBe('No');
      expect(formatAuditValue(null)).toBeNull();
      expect(formatAuditValue('  ')).toBeNull();
      expect(formatAuditValue('Draft')).toBe('Draft');
      expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
      // An instant becomes local; a plain date the user typed is left alone.
      expect(formatAuditValue('2026-09-22T10:30:00Z')).not.toBe('2026-09-22T10:30:00Z');
      expect(formatAuditValue('2026-09-22')).toBe('2026-09-22');
    });
  });

  describe('reading an entry', () => {
    it('normalises the fields the UI depends on', () => {
      const entry = toAuditEntry({
        id: 7,
        entityName: 'Template',
        entityId: 'tpl_1',
        action: 'Updated',
        userId: 12,
        userName: 'John Rivera',
        occurredAt: '2026-09-22T11:45:00Z',
        changes: { Name: { old: 'A', new: 'B' } },
      });

      expect(entry.id).toBe('7');
      expect(entry.action).toBe('updated');
      expect(entry.userId).toBe('12');
      expect(entry.changes.length).toBe(1);
      expect(auditActorName(entry)).toBe('John Rivera');
    });

    it('accepts the other names the timestamp might arrive under', () => {
      expect(toAuditEntry({ timestamp: '2026-09-22T10:00:00Z' }).occurredAt).toBe('2026-09-22T10:00:00Z');
      expect(toAuditEntry({ occurredOn: '2026-09-22T10:00:00Z' }).occurredAt).toBe('2026-09-22T10:00:00Z');
    });

    it('falls back to "updated" for an action it does not know, rather than dropping the entry', () => {
      expect(toAuditEntry({ action: 'restored' }).action).toBe('updated');
    });

    it('says so plainly when no person made the change', () => {
      const entry = toAuditEntry({ userId: null, userName: null, action: 'updated' });
      expect(entry.userName).toBeNull();
      expect(auditActorName(entry)).toBe('Automatic');
    });
  });
});
