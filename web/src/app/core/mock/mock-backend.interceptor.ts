import {
  HttpErrorResponse,
  HttpResponse,
  type HttpEvent,
  type HttpInterceptorFn,
  type HttpParams,
} from '@angular/common/http';
import { Observable, delay, of, throwError } from 'rxjs';

import { environment } from '@env/environment';
import type { ApiResponse, PagedResult } from '@core/models/api.model';
import type { AuthTokens, LoginRequest } from '@core/models/auth.model';
import type { Contact } from '@core/models/contact.model';
import type { AppNotification } from '@core/models/notification.model';
import type { SubscriptionPlan } from '@core/models/subscription.model';
import {
  AUDIT_LOGS,
  CAMPAIGNS,
  CONTACTS,
  DASHBOARD,
  DELIVERY_FAILURES,
  GROUPS_WITH_COUNTS,
  SYSTEM,
  TAGS_WITH_COUNTS,
  TEMPLATES,
  TENANTS,
  WHATSAPP_CONNECTION,
} from './mock-data';
import {
  BILLING_HISTORY,
  EMPLOYEES,
  NOTIFICATIONS,
  PERMISSION_SETS,
  PLANS,
  SUBSCRIPTION_SNAPSHOT,
} from './mock-billing-data';
import { searchEverything } from './mock-search';
import { MOCK_ACCOUNTS, accountFromRefreshToken, issueMockTokens } from './mock-tokens';

/** Simulated round-trip latency. Set to 0 to make mock responses synchronous. */
const LATENCY_MS: number = 380;

/**
 * Mutable slices of the dataset. Plan CRUD and notification read-state are
 * genuinely stateful in the UI, so the mock keeps them in memory for the
 * lifetime of the page rather than pretending the writes succeeded.
 */
const planStore: SubscriptionPlan[] = PLANS.map((plan) => ({ ...plan }));
const notificationStore: AppNotification[] = NOTIFICATIONS.map((entry) => ({ ...entry }));

function nextPlanId(): string {
  return `plan_${crypto.randomUUID().slice(0, 8)}`;
}

function ok<T>(data: T, message: string | null = null): Observable<HttpResponse<ApiResponse<T>>> {
  const response = of(
    new HttpResponse({ status: 200, body: { data, message, traceId: crypto.randomUUID() } }),
  );
  // Latency is simulated only when non-zero; setting it to 0 keeps responses
  // synchronous, which matters for tests and for throttled background tabs.
  return LATENCY_MS === 0 ? response : response.pipe(delay(LATENCY_MS));
}

function fail(status: number, title: string, detail: string): Observable<never> {
  return throwError(
    () => new HttpErrorResponse({ status, error: { title, detail, traceId: crypto.randomUUID() } }),
  );
}

function paginate<T>(items: readonly T[], params: HttpParams): PagedResult<T> {
  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '10');
  const start = (page - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    totalItems: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
  };
}

function filterContacts(params: HttpParams): readonly Contact[] {
  const search = (params.get('search') ?? '').trim().toLowerCase();
  const status = params.get('status') ?? 'all';
  const groupId = params.get('groupId') ?? 'all';

  return CONTACTS.filter((contact) => {
    const matchesSearch =
      search === '' ||
      contact.fullName.toLowerCase().includes(search) ||
      contact.phoneNumber.toLowerCase().includes(search) ||
      (contact.email?.toLowerCase().includes(search) ?? false);

    const matchesStatus = status === 'all' || contact.status === status;
    const matchesGroup = groupId === 'all' || contact.groupIds.includes(groupId);

    return matchesSearch && matchesStatus && matchesGroup;
  });
}

function handleAuth(
  path: string,
  method: string,
  body: unknown,
): Observable<HttpEvent<unknown>> | null {
  if (method === 'POST' && path === '/auth/login') {
    const request = body as LoginRequest;
    const account = MOCK_ACCOUNTS.find(
      (candidate) =>
        candidate.email.toLowerCase() === request.email.trim().toLowerCase() &&
        candidate.password === request.password,
    );

    return account === undefined
      ? fail(401, 'Sign-in failed', 'That email and password combination is not recognised.')
      : ok<AuthTokens>(issueMockTokens(account));
  }

  if (method === 'POST' && path === '/auth/refresh') {
    const { refreshToken } = body as { refreshToken: string };
    const account = accountFromRefreshToken(refreshToken);

    return account === null
      ? fail(401, 'Session expired', 'Please sign in again.')
      : ok<AuthTokens>(issueMockTokens(account));
  }

  if (method === 'POST' && (path === '/auth/logout' || path === '/auth/forgot-password')) {
    return ok<null>(null);
  }

  return null;
}

/** Super Admin plan CRUD: create, update, duplicate, archive and delete. */
function handlePlans(
  path: string,
  method: string,
  body: unknown,
): Observable<HttpEvent<unknown>> | null {
  if (method === 'POST' && path === '/admin/plans') {
    const plan = { ...(body as SubscriptionPlan), id: nextPlanId(), updatedAt: new Date().toISOString() };
    planStore.push(plan);
    return ok(plan, `Plan "${plan.name}" created.`);
  }

  const duplicateMatch = /^\/admin\/plans\/([^/]+)\/duplicate$/.exec(path);
  if (method === 'POST' && duplicateMatch !== null) {
    const source = planStore.find((plan) => plan.id === duplicateMatch[1]);
    if (source === undefined) {
      return fail(404, 'Plan not found', 'That plan no longer exists.');
    }
    const copy: SubscriptionPlan = {
      ...source,
      id: nextPlanId(),
      name: `${source.name} (copy)`,
      status: 'inactive',
      isMostPopular: false,
      isRecommended: false,
      sortOrder: planStore.length,
      updatedAt: new Date().toISOString(),
    };
    planStore.push(copy);
    return ok(copy, `Duplicated "${source.name}".`);
  }

  const idMatch = /^\/admin\/plans\/([^/]+)$/.exec(path);
  if (idMatch === null) {
    return null;
  }
  const index = planStore.findIndex((plan) => plan.id === idMatch[1]);
  if (index === -1) {
    return fail(404, 'Plan not found', 'That plan no longer exists.');
  }

  if (method === 'PUT') {
    const updated = {
      ...planStore[index],
      ...(body as Partial<SubscriptionPlan>),
      id: planStore[index].id,
      updatedAt: new Date().toISOString(),
    };
    planStore[index] = updated;
    return ok(updated, `Plan "${updated.name}" saved.`);
  }

  if (method === 'DELETE') {
    const [removed] = planStore.splice(index, 1);
    return ok<null>(null, `Plan "${removed.name}" deleted.`);
  }

  return null;
}

function handleNotifications(path: string, method: string): Observable<HttpEvent<unknown>> | null {
  if (method !== 'POST') {
    return null;
  }

  if (path === '/notifications/read-all') {
    for (let index = 0; index < notificationStore.length; index++) {
      notificationStore[index] = { ...notificationStore[index], read: true };
    }
    return ok([...notificationStore], 'All notifications marked as read.');
  }

  const readMatch = /^\/notifications\/([^/]+)\/read$/.exec(path);
  if (readMatch !== null) {
    const index = notificationStore.findIndex((entry) => entry.id === readMatch[1]);
    if (index === -1) {
      return fail(404, 'Notification not found', 'That notification no longer exists.');
    }
    notificationStore[index] = { ...notificationStore[index], read: true };
    return ok([...notificationStore]);
  }

  return null;
}

/**
 * In-memory stand-in for the ASP.NET Core API. Enabled by `environment.useMockApi`;
 * flipping that flag is the only change needed to talk to the real backend.
 */
export const mockBackendInterceptor: HttpInterceptorFn = (request, next) => {
  if (!environment.useMockApi || !request.url.startsWith(environment.apiBaseUrl)) {
    return next(request);
  }

  const path = request.url.slice(environment.apiBaseUrl.length);
  const method = request.method.toUpperCase();
  const params = request.params;

  const authResponse = handleAuth(path, method, request.body);
  if (authResponse !== null) {
    return authResponse;
  }

  if (method === 'GET') {
    switch (path) {
      case '/dashboard':
        return ok(DASHBOARD);
      case '/contacts':
        return ok(paginate(filterContacts(params), params));
      case '/groups':
        return ok(GROUPS_WITH_COUNTS);
      case '/tags':
        return ok(TAGS_WITH_COUNTS);
      case '/whatsapp/connection':
        return ok(WHATSAPP_CONNECTION);
      case '/templates':
        return ok(TEMPLATES);
      case '/campaigns':
        return ok(CAMPAIGNS);
      case '/reports/failures':
        return ok(paginate(DELIVERY_FAILURES, params));
      case '/reports/overview':
        return ok(DASHBOARD);
      case '/admin/tenants':
        return ok(paginate(TENANTS, params));
      case '/admin/audit':
        return ok(paginate(AUDIT_LOGS, params));
      case '/admin/system':
        return ok(SYSTEM);
      case '/subscription':
        return ok(SUBSCRIPTION_SNAPSHOT);
      case '/plans':
        return ok(planStore.filter((plan) => plan.status !== 'archived'));
      // A copy, never the live array: returning the same reference would make
      // `signal.set()` a no-op under `Object.is` and freeze every computed.
      case '/admin/plans':
        return ok([...planStore]);
      case '/billing/history':
        return ok(BILLING_HISTORY);
      case '/employees':
        return ok(EMPLOYEES);
      case '/permission-sets':
        return ok(PERMISSION_SETS);
      case '/notifications':
        return ok([...notificationStore]);
      case '/search':
        return ok(searchEverything(params.get('q') ?? ''));
      default:
        break;
    }
  }

  if (method === 'POST' && path === '/whatsapp/connection/sync') {
    return ok(WHATSAPP_CONNECTION, 'Connection refreshed from Meta.');
  }

  if (method === 'POST' && path === '/templates/sync') {
    return ok(TEMPLATES, `Synced ${TEMPLATES.length} templates from Meta.`);
  }

  const planResponse = handlePlans(path, method, request.body);
  if (planResponse !== null) {
    return planResponse;
  }

  const notificationResponse = handleNotifications(path, method);
  if (notificationResponse !== null) {
    return notificationResponse;
  }

  return fail(404, 'Not implemented', `The mock backend has no handler for ${method} ${path}.`);
};
