import { ICON_PATHS } from '@shared/ui/icon/icon.registry';
import {
  type AppNotificationDto,
  resolveIcon,
  resolvePriority,
  toNotification,
} from './notification.model';

function dto(overrides: Partial<AppNotificationDto> = {}): AppNotificationDto {
  return {
    id: 'n1',
    kind: 'payment.submitted',
    title: 'Payment submitted',
    body: 'A customer submitted proof of payment.',
    priority: 'info',
    icon: 'credit-card',
    read: false,
    actionLabel: 'Review',
    actionRoute: '/superadmin/payments',
    occurredAt: '2026-09-04T09:00:00Z',
    ...overrides,
  };
}

describe('notification normalisation', () => {
  describe('resolveIcon', () => {
    it("maps the API's kebab-case onto the registry's camelCase", () => {
      // The payment kinds arrive as `credit-card`; the registry calls it
      // `creditCard`. Unhandled, every payment notification renders no icon.
      expect(resolveIcon('credit-card')).toBe('creditCard');
    });

    it('passes through a name the registry already has', () => {
      expect(resolveIcon('bell')).toBe('bell');
      expect(resolveIcon('creditCard')).toBe('creditCard');
    });

    it('falls back for a name this build has never heard of', () => {
      expect(resolveIcon('some-future-icon')).toBe('bell');
      expect(resolveIcon('')).toBe('bell');
    });

    it('always returns a name the icon component can actually draw', () => {
      // The component does ICON_PATHS[name] and iterates the result, so an
      // unresolvable name is a blank icon at best.
      for (const name of ['credit-card', 'bell', 'nonsense', 'snake_case_icon']) {
        expect(ICON_PATHS[resolveIcon(name)]).withContext(name).toBeDefined();
      }
    });
  });

  describe('resolvePriority', () => {
    it('accepts the four the UI styles', () => {
      for (const value of ['critical', 'warning', 'info', 'success']) {
        expect(resolvePriority(value)).toBe(value as never);
      }
    });

    it('falls back to info for anything else', () => {
      expect(resolvePriority('urgent')).toBe('info');
      expect(resolvePriority('')).toBe('info');
    });
  });

  describe('toNotification', () => {
    it('keeps a kind this build does not know, and still renders it', () => {
      const result = toNotification(dto({ kind: 'something.invented.later' }));

      // The whole point: a new backend kind must not become an invisible
      // notification. Nothing switches on kind, so it survives untouched and
      // presentation comes from the server's own icon and priority.
      expect(result.kind).toBe('something.invented.later');
      expect(ICON_PATHS[result.icon]).toBeDefined();
      expect(result.title).toBe('Payment submitted');
    });

    it('normalises the payment payload the backend described', () => {
      const result = toNotification(dto());

      expect(result.icon).toBe('creditCard');
      expect(result.priority).toBe('info');
      expect(result.actionRoute).toBe('/superadmin/payments');
    });

    it('leaves every other field exactly as sent', () => {
      const source = dto({ read: true, actionLabel: null, actionRoute: null });
      const result = toNotification(source);

      expect(result.id).toBe(source.id);
      expect(result.body).toBe(source.body);
      expect(result.read).toBeTrue();
      expect(result.actionLabel).toBeNull();
      expect(result.actionRoute).toBeNull();
      expect(result.occurredAt).toBe(source.occurredAt);
    });
  });
});
