import {
  HttpErrorResponse,
  HttpResponse,
  type HttpEvent,
  type HttpInterceptorFn,
  type HttpParams,
  type HttpRequest,
} from '@angular/common/http';
import { Observable, delay, of, throwError } from 'rxjs';
import {
  MOCK_CATEGORIES,
  mockBusinessSearch,
  mockPlaces,
  mockReversePlace,
} from './mock-business-data';
import { avoidsCommonPatterns } from '@core/models/password-policy';
import { environment } from '@env/environment';
import type { ApiResponse, PagedResult } from '@core/models/api.model';
import type {
  AuthTokens,
  CurrentUserResponse,
  LoginRequest,
} from '@core/models/auth.model';
import type { Contact } from '@core/models/contact.model';
import type { Employee } from '@core/models/employee.model';
import type { ConversationMessage, MessageTemplate } from '@core/models/whatsapp.model';
import { isWindowOpen } from '@core/models/whatsapp.model';
import type { AppNotification } from '@core/models/notification.model';
import { PERMISSIONS, type Permission } from '@core/models/permission.model';
import type { SubscriptionPlan } from '@core/models/subscription.model';
import {
  AUDIT_LOGS,
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
import {
  ADMIN_ACCOUNTS,
  PLATFORM_OVERVIEW,
  campaignsForAdmin,
  connectionForAdmin,
  contactsForAdmin,
  dashboardForAdmin,
  employeesForAdmin,
} from './mock-platform-data';
import { decodeJwt } from '@core/auth/jwt.util';
import {
  IMPORT_TEMPLATE_CSV,
  allMockBatches,
  createMockBatch,
  exportCsv,
  exportStatus,
  findMockBatch,
  rowsOf,
  startExport,
  statusOf,
  toDetails,
  toListItem,
} from './mock-import-data';
import type { MockPaymentRequest } from './mock-payment-data';
import {
  activeChannels,
  channelDetails,
  createPaymentRequest,
  decidePaymentRequest,
  findPaymentRequest,
  paymentChannelStore,
  paymentRequestStore,
  proofBlobFor,
  updateChannel,
} from './mock-payment-data';
import {
  appendMessage,
  conversationStore,
  createMediaAsset,
  findConversation,
  messageStore,
  replaceConversation,
} from './mock-inbox-data';
import { campaignStore, handleCampaigns } from './mock-campaign-handler';
import { searchEverything } from './mock-search';
import {
  MOCK_ACCOUNTS,
  type MockAccount,
  accountFromRefreshToken,
  issueMockTokens,
  permissionsForRole,
} from './mock-tokens';
/** Simulated round-trip latency. Set to 0 to make mock responses synchronous. */
const LATENCY_MS: number = 380;
/**
 * Mutable slices of the dataset. Plan CRUD and notification read-state are
 * genuinely stateful in the UI, so the mock keeps them in memory for the
 * lifetime of the page rather than pretending the writes succeeded.
 */
const planStore: SubscriptionPlan[] = PLANS.map((plan) => ({ ...plan }));
const notificationStore: AppNotification[] = NOTIFICATIONS.map((entry) => ({ ...entry }));
const employeeStore: Employee[] = EMPLOYEES.map((entry) => ({ ...entry }));
const templateStore: MessageTemplate[] = TEMPLATES.map((entry) => ({ ...entry }));
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
/**
 * A file download. Unlike every other response this one is *not* enveloped —
 * `ApiService.download` asks for a blob and hands it straight to the caller.
 */
function okFile(content: string, mimeType: string): Observable<HttpResponse<Blob>> {
  return okBlob(new Blob([content], { type: mimeType }));
}
function okBlob(blob: Blob): Observable<HttpResponse<Blob>> {
  const response = of(new HttpResponse({ status: 200, body: blob }));
  return LATENCY_MS === 0 ? response : response.pipe(delay(LATENCY_MS));
}
function fail(
  status: number,
  title: string,
  detail: string,
  errorCode?: string,
): Observable<never> {
  return throwError(
    () =>
      new HttpErrorResponse({
        status,
        error: { title, detail, errorCode, traceId: crypto.randomUUID() },
      }),
  );
}
/**
 * A 422 carrying field errors, shaped exactly as the API sends them.
 *
 * Keys stay **PascalCase** on purpose: that is what the real API returns, and a
 * camelCase mock would let a case-sensitive lookup pass here and fail in
 * production, which is the opposite of what a mock is for.
 */
function failValidation(errors: Readonly<Record<string, readonly string[]>>): Observable<never> {
  return throwError(
    () =>
      new HttpErrorResponse({
        status: 422,
        error: {
          title: 'Validation failed',
          errors,
          errorCode: 'validation_failed',
          traceId: crypto.randomUUID(),
        },
      }),
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
/**
 * The Admin account a SuperAdmin is viewing as, or `null` for their own /
 * global context. A real API would authorise this against the caller's role;
 * the mock simply honours it.
 */
function scopeOf(params: HttpParams): string | null {
  return params.get('adminId');
}
/**
 * Templates, filtered and paged the way the API is being asked to.
 *
 * Filtering here rather than in the client is the point: it is what proves the
 * screen works against a server that only ever returns one page, and it catches
 * the mismatches — a filter value the API would not recognise, a page beyond
 * the end — that a client-side slice over a full array never would.
 */
function pageTemplates(params: HttpParams): PagedResult<MessageTemplate> {
  const search = (params.get('search') ?? '').trim().toLowerCase();
  const status = params.get('status') ?? 'all';
  const category = params.get('category') ?? 'all';

  const matched = templateStore.filter((template) => {
    const matchesSearch =
      search === '' ||
      template.name.toLowerCase().includes(search) ||
      template.bodyText.toLowerCase().includes(search);

    return (
      matchesSearch &&
      (status === 'all' || template.status === status) &&
      (category === 'all' || template.category === category)
    );
  });

  return paginate(matched, params);
}

/**
 * Counts across every page, under the same search and category as the list.
 *
 * Status is not applied — these counts are the breakdown by status. Search and
 * category are, or a chip reads "Pending 1" beside an empty list and the filter
 * looks broken when it is working.
 */
function countTemplates(params: HttpParams) {
  const search = (params.get('search') ?? '').trim().toLowerCase();
  const category = params.get('category') ?? 'all';

  const scoped = templateStore.filter((template) => {
    const matchesSearch =
      search === '' ||
      template.name.toLowerCase().includes(search) ||
      template.bodyText.toLowerCase().includes(search);

    return matchesSearch && (category === 'all' || template.category === category);
  });

  const of = (status: MessageTemplate['status']): number =>
    scoped.filter((template) => template.status === status).length;

  return {
    total: scoped.length,
    approved: of('approved'),
    pending: of('pending'),
    rejected: of('rejected'),
    paused: of('paused'),
  };
}

function filterContacts(params: HttpParams): readonly Contact[] {
  const search = (params.get('search') ?? '').trim().toLowerCase();
  const status = params.get('status') ?? 'all';
  const groupId = params.get('groupId') ?? 'all';
  const adminId = scopeOf(params);
  const source = adminId === null ? CONTACTS : contactsForAdmin(adminId);
  return source.filter((contact) => {
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
  request: HttpRequest<unknown>,
): Observable<HttpEvent<unknown>> | null {
  // The profile lives behind /auth/me, not in the token, so the mock has to
  // serve it too — the app initializer calls it before the first route runs.
  if (method === 'GET' && path === '/auth/me') {
    const bearer = request.headers.get('Authorization') ?? '';
    const claims = decodeJwt(bearer.replace(/^Bearer\s+/i, ''));
    // Resolved by `sub`, never by name or email — the profile screen can change
    // both, and a token issued before the change must still identify its owner.
    const account =
      claims === null
        ? undefined
        : MOCK_ACCOUNTS.find((candidate) => candidate.id === claims.sub);
    if (account === undefined) {
      return fail(401, 'Session expired', 'Please sign in again.');
    }
    return ok<CurrentUserResponse>({
      id: MOCK_ACCOUNTS.indexOf(account) + 1,
      email: account.email,
      displayName: account.name,
      tenantName: account.role === 'SuperAdmin' ? null : account.workspaceName,
      isSuperAdmin: account.role === 'SuperAdmin',
      roles: [account.role],
      permissions: [...permissionsForRole(account.role)],
    });
  }
  if (method === 'POST' && path === '/auth/login') {
    const credentials = body as LoginRequest;
    const account = MOCK_ACCOUNTS.find(
      (candidate) =>
        candidate.email.toLowerCase() === credentials.email.trim().toLowerCase() &&
        candidate.password === credentials.password,
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
  if (method === 'POST' && path === '/auth/change-password') {
    const account = accountFromRequest(request);
    if (account === null) {
      return fail(401, 'Session expired', 'Please sign in again.');
    }

    const { currentPassword, newPassword } = body as {
      currentPassword: string;
      newPassword: string;
    };

    // Field keys are PascalCase, exactly as the real API sends them — the
    // client has to match case-insensitively, and a camelCase mock would hide
    // the bug rather than expose it.
    if (account.password !== currentPassword) {
      return failValidation({ CurrentPassword: ['That is not your current password.'] });
    }
    if (!meetsMockPasswordPolicy(newPassword)) {
      return failValidation({
        NewPassword: ['Use at least 12 characters, including a letter and a digit.'],
      });
    }

    account.password = newPassword;
    return ok<null>(null);
  }

  if (method === 'PATCH' && path === '/auth/me') {
    const account = accountFromRequest(request);
    if (account === null) {
      return fail(401, 'Session expired', 'Please sign in again.');
    }

    const update = body as {
      displayName?: string;
      email?: string;
      newPassword?: string;
      currentPassword?: string;
    };

    const nextEmail = update.email?.trim() ?? null;
    const nextName = update.displayName?.trim() ?? null;
    const nextPassword = update.newPassword ?? null;

    const emailChanging =
      nextEmail !== null && nextEmail.toLowerCase() !== account.email.toLowerCase();

    // Everything is validated before anything is written: the API applies all
    // three in one transaction, and a mock that half-applied them would let a
    // partial-success bug through unnoticed.
    if ((emailChanging || nextPassword !== null) && account.password !== (update.currentPassword ?? '')) {
      return failValidation({ CurrentPassword: ['That is not your current password.'] });
    }

    if (nextName !== null && nextName === '') {
      return failValidation({ DisplayName: ['A name is required.'] });
    }

    if (nextPassword !== null && !meetsMockPasswordPolicy(nextPassword)) {
      return failValidation({
        NewPassword: [
          'Use at least 12 characters, including a letter and a digit, and not a common word or pattern.',
        ],
      });
    }

    if (emailChanging) {
      const taken = MOCK_ACCOUNTS.some(
        (candidate) =>
          candidate.id !== account.id &&
          candidate.email.toLowerCase() === (nextEmail ?? '').toLowerCase(),
      );
      if (taken) {
        return fail(
          409,
          'Email already in use',
          'Another account already uses that address.',
          'email_in_use',
        );
      }
    }

    // Commit.
    if (emailChanging && nextEmail !== null) {
      account.email = nextEmail;
    }
    if (nextName !== null && nextName !== '') {
      account.name = nextName;
    }
    if (nextPassword !== null) {
      account.password = nextPassword;
    }

    return ok<null>(null, 'Profile updated.');
  }

  if (method === 'POST' && (path === '/auth/logout' || path === '/auth/forgot-password')) {
    return ok<null>(null);
  }
  return null;
}

/**
 * Workspace deactivation.
 *
 * Verifies the password like the real endpoint must, so the wrong-password path
 * is reachable — that is the one branch worth exercising, since it is the only
 * thing standing between an open session and a switched-off company.
 */
function handleWorkspace(
  path: string,
  method: string,
  body: unknown,
  request: HttpRequest<unknown>,
): Observable<HttpEvent<unknown>> | null {
  if (method !== 'POST' || path !== '/workspace/deactivate') {
    return null;
  }

  const account = accountFromRequest(request);
  if (account === null) {
    return fail(401, 'Session expired', 'Please sign in again.');
  }
  if (account.role !== 'Admin') {
    return fail(
      403,
      'Not permitted',
      'Only the workspace owner can deactivate the workspace.',
      'forbidden',
    );
  }

  const payload = body as { currentPassword?: string; reason?: string };
  if (account.password !== (payload.currentPassword ?? '')) {
    return failValidation({ CurrentPassword: ['That is not your current password.'] });
  }
  if ((payload.reason ?? '') === '') {
    return failValidation({ Reason: ['A reason is required.'] });
  }

  const retained = new Date();
  retained.setDate(retained.getDate() + 30);

  return ok({
    deactivatedAt: new Date().toISOString(),
    dataRetainedUntil: retained.toISOString().slice(0, 10),
  });
}

/** The signed-in account, resolved from the bearer token's `sub`. */
function accountFromRequest(request: HttpRequest<unknown>): MockAccount | null {
  const bearer = request.headers.get('Authorization') ?? '';
  const claims = decodeJwt(bearer.replace(/^Bearer\s+/i, ''));
  if (claims === null) {
    return null;
  }
  return MOCK_ACCOUNTS.find((candidate) => candidate.id === claims.sub) ?? null;
}

/**
 * Mirrors `core/models/password-policy.ts`, which mirrors the API — including
 * the forbidden fragments, so a password the client would wave through is still
 * refused here if the client-side rule is ever dropped.
 */
function meetsMockPasswordPolicy(value: string): boolean {
  return (
    value.length >= 12 &&
    /[a-zA-Z]/.test(value) &&
    /\d/.test(value) &&
    avoidsCommonPatterns(value)
  );
}
/**
 * Business discovery.
 *
 * Stands in for a provider-backed API so the flow can be exercised offline.
 * Deliberately reproduces the awkward cases — businesses with no phone, some
 * already in Contacts, paging that must not duplicate rows — because a mock
 * where everything is tidy verifies nothing.
 */
function handleBusinessDiscovery(
  path: string,
  method: string,
  body: unknown,
  params: HttpParams,
): Observable<HttpEvent<unknown>> | null {
  if (!path.startsWith('/business-discovery')) {
    return null;
  }

  if (method === 'GET' && path === '/business-discovery/categories') {
    return ok(MOCK_CATEGORIES);
  }

  if (method === 'GET' && path === '/business-discovery/places') {
    return ok(mockPlaces(params.get('query') ?? ''));
  }

  if (method === 'GET' && path === '/business-discovery/places/reverse') {
    return ok(
      mockReversePlace(Number(params.get('latitude') ?? 0), Number(params.get('longitude') ?? 0)),
    );
  }

  if (method === 'POST' && path === '/business-discovery/search') {
    const query = body as {
      latitude: number;
      longitude: number;
      radiusKm: number;
      category: string;
      page: number;
      pageSize: number;
    };

    // The real API caps the radius; refusing here proves the client surfaces it.
    if (query.radiusKm > 50) {
      return fail(
        422,
        'Radius too large',
        'The maximum search radius is 50 km.',
        'radius_too_large',
      );
    }

    const { items, total } = mockBusinessSearch(
      query.latitude,
      query.longitude,
      query.radiusKm,
      query.category,
      query.page,
      query.pageSize,
    );

    return ok({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasNextPage: query.page * query.pageSize < total,
      searchId: `search_${query.category}_${query.page}`,
    });
  }

  if (method === 'POST' && path === '/business-discovery/import') {
    const request = body as { businessIds: readonly string[] };
    const ids = request.businessIds ?? [];

    // A deterministic slice fails and another is skipped, so the result screen
    // and its failure list are both reachable without editing the mock.
    const failed = ids.filter((_, index) => index % 11 === 10);
    const skipped = ids.filter((_, index) => index % 6 === 0 && index % 11 !== 10);

    return ok({
      imported: ids.length - failed.length - skipped.length,
      skipped: skipped.length,
      failed: failed.length,
      failures: failed.map((id) => ({
        businessId: id,
        name: id.replace(/^biz_[a-z_]+_/, 'Business '),
        reason: 'The phone number could not be normalised to E.164.',
      })),
    });
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
 * Contact import.
 *
 * The batch's status is derived from elapsed time rather than driven by a
 * worker, so uploading a file walks the UI through queued → processing →
 * needs review, and committing walks it through importing → completed, at a
 * pace that exercises both the push path and the polling fallback.
 */
function handleContactImports(
  path: string,
  method: string,
  body: unknown,
  params: HttpParams,
): Observable<HttpEvent<unknown>> | null {
  if (!path.startsWith('/contact-imports')) {
    return null;
  }
  if (method === 'GET' && path === '/contact-imports/template') {
    return okFile(IMPORT_TEMPLATE_CSV, 'text/csv');
  }
  if (method === 'GET' && path === '/contact-imports') {
    return ok(paginate(allMockBatches().map(toListItem), params));
  }
  if (method === 'POST' && path === '/contact-imports') {
    const file = body instanceof FormData ? body.get('file') : null;
    if (!(file instanceof File)) {
      return fail(422, 'No file', 'Attach a CSV or XLSX file.');
    }
    // Fixed at upload, exactly as the API fixes it — the parse classifies against it.
    const strategy = (body instanceof FormData ? body.get('duplicateStrategy') : null) ?? 'Skip';
    const batch = createMockBatch(file.name, file.size, String(strategy));
    return ok(
      {
        batchId: batch.batchId,
        fileName: batch.fileName,
        fileSizeBytes: batch.fileSizeBytes,
        status: statusOf(batch),
        uploadedAt: new Date(batch.uploadedAt).toISOString(),
      },
      'File accepted and queued.',
    );
  }
  const exportDownload = /^\/contact-imports\/exports\/([^/]+)\/download$/.exec(path);
  if (method === 'GET' && exportDownload !== null) {
    return okFile(exportCsv(exportDownload[1]), 'text/csv');
  }
  const exportPoll = /^\/contact-imports\/exports\/([^/]+)$/.exec(path);
  if (method === 'GET' && exportPoll !== null) {
    const job = exportStatus(exportPoll[1]);
    return job === null
      ? fail(404, 'Export not found', 'That export has expired.')
      : ok(job);
  }
  const rowsMatch = /^\/contact-imports\/([^/]+)\/rows$/.exec(path);
  if (method === 'GET' && rowsMatch !== null) {
    const batch = findMockBatch(rowsMatch[1]);
    return batch === undefined
      ? fail(404, 'Import not found', 'That batch does not exist in this workspace.')
      : ok(paginate(rowsOf(batch, params.get('status') ?? 'all'), params));
  }
  const detailMatch = /^\/contact-imports\/([^/]+)$/.exec(path);
  if (method === 'GET' && detailMatch !== null) {
    const batch = findMockBatch(detailMatch[1]);
    return batch === undefined
      ? fail(404, 'Import not found', 'That batch does not exist in this workspace.')
      : ok(toDetails(batch));
  }
  const mappingMatch = /^\/contact-imports\/([^/]+)\/mapping$/.exec(path);
  if (method === 'PUT' && mappingMatch !== null) {
    const batch = findMockBatch(mappingMatch[1]);
    if (batch === undefined) {
      return fail(404, 'Import not found', 'That batch does not exist in this workspace.');
    }
    batch.mapping = (body as { mapping: never }).mapping;
    return ok(toDetails(batch), 'Mapping saved.');
  }
  const commitMatch = /^\/contact-imports\/([^/]+)\/commit$/.exec(path);
  if (method === 'POST' && commitMatch !== null) {
    const batch = findMockBatch(commitMatch[1]);
    if (batch === undefined) {
      return fail(404, 'Import not found', 'That batch does not exist in this workspace.');
    }
    if (batch.mapping === null) {
      return fail(
        409,
        'Business rule violated',
        'Choose which column holds each field before importing.',
        'import_not_mapped',
      );
    }
    if (batch.committedAt !== null) {
      // Redelivery is expected of a queue; committing twice must not re-import.
      return ok({
        batchId: batch.batchId,
        status: statusOf(batch),
        queuedAt: new Date(batch.committedAt).toISOString(),
      });
    }
    if (statusOf(batch) !== 'AwaitingMapping') {
      return fail(
        409,
        'Business rule violated',
        'This import is not waiting to be confirmed.',
        'import_not_committable',
      );
    }
    batch.committedAt = Date.now();
    return ok(
      {
        batchId: batch.batchId,
        status: statusOf(batch),
        queuedAt: new Date(batch.committedAt).toISOString(),
      },
      'Import queued.',
    );
  }
  const cancelMatch = /^\/contact-imports\/([^/]+)\/cancel$/.exec(path);
  if (method === 'POST' && cancelMatch !== null) {
    const batch = findMockBatch(cancelMatch[1]);
    if (batch === undefined) {
      return fail(404, 'Import not found', 'That batch does not exist in this workspace.');
    }
    // Once contacts are being written, calling it "cancelled" would misdescribe it.
    const current = statusOf(batch);
    if (current === 'Committing') {
      return fail(
        409,
        'Business rule violated',
        'This import is already writing contacts and can no longer be cancelled.',
        'import_not_cancellable',
      );
    }
    if (current === 'Completed' || current === 'CompletedWithErrors' || current === 'Failed') {
      return fail(
        409,
        'Business rule violated',
        'This import has already finished.',
        'import_not_cancellable',
      );
    }
    batch.cancelled = true;
    return ok(toDetails(batch), 'Import cancelled.');
  }
  const failedExport = /^\/contact-imports\/([^/]+)\/failed-records\/export$/.exec(path);
  if (method === 'POST' && failedExport !== null) {
    const batch = findMockBatch(failedExport[1]);
    if (batch === undefined) {
      return fail(404, 'Import not found', 'That batch does not exist in this workspace.');
    }
    if (!toListItem(batch).hasFailedRecords) {
      return fail(
        409,
        'Business rule violated',
        'Every row in this import was used.',
        'import_has_no_failures',
      );
    }
    return ok(startExport(batch));
  }
  return null;
}
/**
 * Manual payments.
 *
 * The customer's own submissions and the platform review queue are the same
 * store seen from two sides. Approving is the only thing that would change a
 * plan; the mock records the decision without touching the subscription, since
 * the real grant happens server-side.
 */
/**
 * Employee lifecycle.
 *
 * Stateful for the life of the page, because the permission matrix and the
 * seat gauge are only meaningful if a change sticks long enough to see it
 * reflected everywhere.
 */
function handleEmployees(
  path: string,
  method: string,
  body: unknown,
): Observable<HttpEvent<unknown>> | null {
  if (!path.startsWith('/employees')) {
    return null;
  }
  if (method === 'POST' && path === '/employees/invite') {
    const request = body as {
      name: string;
      email: string;
      jobTitle?: string;
      role?: 'Admin' | 'Employee';
      permissionSetId?: string;
    };
    if (employeeStore.some((e) => e.email.toLowerCase() === request.email.toLowerCase())) {
      // Platform-wide, matching the API: the address may belong to another
      // customer entirely, which is why the wording is not workspace-scoped.
      return fail(
        409,
        'That address is already registered',
        'An account already exists for that email address.',
        'email_taken',
      );
    }
    const set =
      request.permissionSetId === undefined
        ? undefined
        : PERMISSION_SETS.find((entry) => entry.id === request.permissionSetId);
    const invited: Employee = {
      id: `emp_${crypto.randomUUID().slice(0, 8)}`,
      name: request.name,
      initials: request.name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
      email: request.email,
      jobTitle: request.jobTitle ?? '',
      role: request.role ?? 'Employee',
      status: 'invited',
      // A co-admin's access comes from the role, not the matrix.
      permissions: request.role === 'Admin' ? [...PERMISSIONS] : [...(set?.permissions ?? [])],
      lastActiveAt: null,
      invitedAt: new Date().toISOString(),
    };
    employeeStore.unshift(invited);
    return ok(invited, `Invitation sent to ${invited.email}.`);
  }
  const withId = /^\/employees\/([^/]+)(\/[a-z-]+)?$/.exec(path);
  if (withId === null) {
    return null;
  }
  const [, id, suffix] = withId;
  const index = employeeStore.findIndex((employee) => employee.id === id);
  if (index === -1) {
    return fail(404, 'Not found', 'That employee is no longer in this workspace.');
  }
  const current = employeeStore[index];
  // Replaced rather than mutated, so a signal `set()` is not a no-op.
  const replace = (patch: Partial<Employee>): Employee => {
    employeeStore[index] = { ...current, ...patch };
    return employeeStore[index];
  };
  if (method === 'PUT' && suffix === '/permissions') {
    const permissions = (body as { permissions: Permission[] }).permissions ?? [];
    return ok(replace({ permissions }), 'Permissions updated.');
  }
  if (method === 'PUT' && suffix === '/role') {
    const role = (body as { role: 'Admin' | 'Employee' }).role;
    return ok(
      replace({
        role,
        permissions: role === 'Admin' ? [...PERMISSIONS] : current.permissions,
      }),
      'Role updated.',
    );
  }
  if (method === 'PUT' && suffix === '/status') {
    const status = (body as { status: Employee['status'] }).status;
    return ok(replace({ status }), 'Status updated.');
  }
  if (method === 'POST' && suffix === '/resend-invite') {
    return ok(null, `Invitation resent to ${current.email}.`);
  }
  if (method === 'DELETE' && suffix === '/invite') {
    employeeStore.splice(index, 1);
    return ok(null, 'Invitation revoked.');
  }
  if (method === 'DELETE' && suffix === undefined) {
    employeeStore.splice(index, 1);
    return ok(null, 'Employee removed.');
  }
  if (method === 'PUT' && suffix === undefined) {
    return ok(replace(body as Partial<Employee>), 'Employee updated.');
  }
  return null;
}
/**
 * WhatsApp: template authoring, media and the inbox.
 *
 * The window rule is enforced here as well as in the UI, so the closed-window
 * path can actually be exercised rather than only reasoned about.
 */
function handleWhatsApp(
  path: string,
  method: string,
  body: unknown,
  params: HttpParams,
): Observable<HttpEvent<unknown>> | null {
  /* ---------------------------- templates ---------------------------- */
  if (method === 'POST' && path === '/templates') {
    const draft = body as {
      name: string;
      category: MessageTemplate['category'];
      language: string;
      headerText: string;
      bodyText: string;
      footerText: string;
      buttons: { label: string }[];
    };
    if (templateStore.some((entry) => entry.name === draft.name)) {
      return fail(
        409,
        'Name already used',
        'A template with that name already exists in this account.',
        'template_name_taken',
      );
    }
    const created: MessageTemplate = {
      id: `tpl_${crypto.randomUUID().slice(0, 8)}`,
      name: draft.name,
      category: draft.category,
      status: 'pending',
      language: draft.language,
      headerText: draft.headerText === '' ? null : draft.headerText,
      bodyText: draft.bodyText,
      footerText: draft.footerText === '' ? null : draft.footerText,
      variables: [...(draft.bodyText.match(/\{\{\s*\d+\s*\}\}/g) ?? [])],
      buttons: draft.buttons.map((button) => button.label),
      qualityScore: 'green',
      timesUsed: 0,
      updatedAt: new Date().toISOString(),
      rejectionReason: null,
    };
    templateStore.unshift(created);
    return ok(created, 'Submitted to Meta for review.');
  }
  // Literal sub-routes must be claimed before the `{id}` pattern, or `counts`
  // is read as a template id and answers 404. This is the same collision the
  // real API has with `/campaigns/preview-audience`, and it is worth reproducing
  // faithfully rather than special-casing away.
  if (method === 'GET' && path === '/templates/counts') {
    return ok(countTemplates(params));
  }

  const templateMatch = /^\/templates\/([^/]+)$/.exec(path);
  if (templateMatch !== null) {
    const index = templateStore.findIndex((entry) => entry.id === templateMatch[1]);
    if (index === -1) {
      return fail(404, 'Not found', 'That template no longer exists.');
    }
    if (method === 'DELETE') {
      templateStore.splice(index, 1);
      return ok(null, 'Template deleted.');
    }
    if (method === 'PUT') {
      const draft = body as { bodyText: string; category: MessageTemplate['category'] };
      // Resubmitting sends it back to review; Meta does not keep the rejection.
      templateStore[index] = {
        ...templateStore[index],
        ...(body as Partial<MessageTemplate>),
        category: draft.category,
        bodyText: draft.bodyText,
        status: 'pending',
        rejectionReason: null,
        updatedAt: new Date().toISOString(),
      };
      return ok(templateStore[index], 'Resubmitted to Meta.');
    }
  }
  /* ---------------------------- media ---------------------------- */
  if (method === 'POST' && path === '/whatsapp/media') {
    const form = body instanceof FormData ? body : null;
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return fail(422, 'No file', 'Attach a file to upload.', 'validation_failed');
    }
    return ok(createMediaAsset(file, String(form?.get('kind') ?? 'image')));
  }
  /* ---------------------------- conversations ---------------------------- */
  if (method === 'GET' && path === '/whatsapp/conversations') {
    const search = (params.get('search') ?? '').trim().toLowerCase();
    const filtered =
      search === ''
        ? conversationStore
        : conversationStore.filter(
            (entry) =>
              entry.contactName.toLowerCase().includes(search) ||
              entry.phoneNumber.includes(search),
          );
    return ok(paginate(filtered, params));
  }
  const messagesMatch = /^\/whatsapp\/conversations\/([^/]+)\/messages$/.exec(path);
  if (messagesMatch !== null) {
    const conversation = findConversation(messagesMatch[1]);
    if (conversation === undefined) {
      return fail(404, 'Not found', 'That conversation no longer exists.');
    }
    if (method === 'GET') {
      return ok(paginate(messageStore[conversation.id] ?? [], params));
    }
    if (method === 'POST') {
      // The server owns the clock: a UI that has drifted must still be refused.
      if (!isWindowOpen(conversation)) {
        return fail(
          409,
          'The 24-hour window has closed',
          'This customer has not messaged in 24 hours. Send an approved template instead.',
          'window_closed',
        );
      }
      const request = body as { kind: ConversationMessage['kind']; body: string; mediaId: string | null };
      return ok(
        appendMessage(conversation.id, {
          direction: 'outbound',
          kind: request.kind,
          body: request.body,
          media: null,
          status: 'sent',
          failureReason: null,
          templateName: null,
        }),
      );
    }
  }
  const readMatch = /^\/whatsapp\/conversations\/([^/]+)\/read$/.exec(path);
  if (method === 'POST' && readMatch !== null) {
    const conversation = findConversation(readMatch[1]);
    return conversation === undefined
      ? fail(404, 'Not found', 'That conversation no longer exists.')
      : ok(replaceConversation({ ...conversation, unreadCount: 0 }));
  }
  const conversationMatch = /^\/whatsapp\/conversations\/([^/]+)$/.exec(path);
  if (method === 'GET' && conversationMatch !== null) {
    const conversation = findConversation(conversationMatch[1]);
    return conversation === undefined
      ? fail(404, 'Not found', 'That conversation no longer exists.')
      : ok(conversation);
  }
  return null;
}
/** The single mock customer identity, standing in for tenant scoping. */
const MOCK_CUSTOMER_EMAIL = 'admin@nextreach.io';
function ownRequests(): readonly MockPaymentRequest[] {
  return paymentRequestStore.filter(
    (request) => request.submittedByEmail === MOCK_CUSTOMER_EMAIL,
  );
}
function handlePayments(
  path: string,
  method: string,
  body: unknown,
  params: HttpParams,
): Observable<HttpEvent<unknown>> | null {
  // Customers see active channels only; the platform sees all of them.
  if (method === 'GET' && path === '/billing/payment-channels') {
    return ok(activeChannels());
  }
  if (method === 'GET' && path === '/superadmin/payment-channels') {
    return ok([...paymentChannelStore]);
  }
  const channelSave = /^\/superadmin\/payment-channels\/([^/]+)$/.exec(path);
  if (method === 'PUT' && channelSave !== null) {
    const patch = body as { accountTitle?: string; accountNumber?: string };
    if ((patch.accountTitle ?? '').trim() === '' || (patch.accountNumber ?? '').trim() === '') {
      return fail(
        422,
        'Missing details',
        'An account title and number are required.',
        'validation_failed',
      );
    }
    const updated = updateChannel(
      channelSave[1] as 'JazzCash' | 'EasyPaisa' | 'BankTransfer',
      body as Partial<typeof paymentChannelStore[number]>,
    );
    return updated === undefined
      ? fail(404, 'Unknown channel', 'That payment method does not exist.')
      : ok(updated, 'Payment method saved.');
  }
  const qrUpload = /^\/superadmin\/payment-channels\/([^/]+)\/qr$/.exec(path);
  if (method === 'POST' && qrUpload !== null) {
    const image = body instanceof FormData ? body.get('qr') : null;
    if (!(image instanceof File)) {
      return fail(422, 'No image', 'Attach a PNG, JPG or WEBP.', 'validation_failed');
    }
    const updated = updateChannel(qrUpload[1] as 'JazzCash' | 'EasyPaisa' | 'BankTransfer', {
      qrImageUrl: URL.createObjectURL(image),
    });
    return updated === undefined
      ? fail(404, 'Unknown channel', 'That payment method does not exist.')
      : ok(updated, 'QR code updated.');
  }
  const channelQr = /^\/billing\/payment-channels\/([^/]+)\/qr$/.exec(path);
  if (method === 'GET' && channelQr !== null) {
    const details = channelDetails(channelQr[1] as 'JazzCash' | 'EasyPaisa' | 'BankTransfer');
    return details === undefined || details.qrImageUrl === ''
      ? fail(404, 'No QR', 'This channel has no QR image.')
      : okFile('placeholder', 'image/svg+xml');
  }
  const proofMatch = /^\/billing\/payment-requests\/([^/]+)\/proof$/.exec(path);
  if (method === 'GET' && proofMatch !== null) {
    const request = findPaymentRequest(proofMatch[1]);
    return request === undefined
      ? fail(404, 'Not found', 'That payment no longer exists.')
      : okBlob(proofBlobFor(request));
  }
  // The API scopes these to the caller's tenant. The mock has one customer
  // identity, so it filters by that — without it, a workspace would see (and be
  // blocked by) another organisation's payments.
  if (method === 'GET' && path === '/billing/payment-requests') {
    return ok(paginate(ownRequests(), params));
  }
  if (method === 'POST' && path === '/billing/payment-requests') {
    const form = body instanceof FormData ? body : null;
    const proof = form?.get('proof');
    if (form === null || !(proof instanceof File)) {
      return fail(422, 'No proof attached', 'Attach a screenshot of your payment.');
    }
    // One open request per workspace, as the API enforces.
    if (ownRequests().some((entry) => entry.status === 'Pending')) {
      return fail(
        409,
        'Business rule violated',
        'You already have a payment awaiting review. Withdraw it before submitting another.',
        'payment_request_pending',
      );
    }
    const planId = String(form.get('planId') ?? '');
    const plan = planStore.find((entry) => entry.id === planId);
    if (plan === undefined) {
      return fail(404, 'Unknown plan', 'That plan is no longer available.');
    }
    const cycle = String(form.get('billingCycle') ?? 'Monthly');
    const created = createPaymentRequest({
      planId,
      planName: plan.name,
      billingCycle: cycle === 'Yearly' ? 'Yearly' : 'Monthly',
      amount: cycle === 'Yearly' ? plan.yearlyPrice : plan.monthlyPrice,
      currency: plan.currency,
      channel: (String(form.get('channel') ?? 'JazzCash') as 'JazzCash' | 'EasyPaisa' | 'BankTransfer'),
      reference: String(form.get('reference') ?? ''),
      note: String(form.get('note') ?? ''),
      proofFileName: proof.name,
      proofContentType: proof.type,
      organisation: 'Northwind Retail',
      submittedByName: 'Amara Chen',
      submittedByEmail: 'admin@nextreach.io',
      adminId: 'adm_1',
      // The real API stores the file; the mock keeps it inline so the reviewer
      // sees the actual upload rather than a stand-in.
      proofDataUrl: URL.createObjectURL(proof),
    });
    return ok(created, 'Payment submitted for review.');
  }
  const cancelMatch = /^\/billing\/payment-requests\/([^/]+)\/cancel$/.exec(path);
  if (method === 'POST' && cancelMatch !== null) {
    const updated = decidePaymentRequest(cancelMatch[1], 'Cancelled', null);
    return updated === undefined
      ? fail(404, 'Not found', 'That payment no longer exists.')
      : ok(updated, 'Payment withdrawn.');
  }
  const mineMatch = /^\/billing\/payment-requests\/([^/]+)$/.exec(path);
  if (method === 'GET' && mineMatch !== null) {
    const request = findPaymentRequest(mineMatch[1]);
    return request === undefined
      ? fail(404, 'Not found', 'That payment no longer exists.')
      : ok(request);
  }
  /* ---------------------------- platform ---------------------------- */
  if (method === 'GET' && path === '/superadmin/payment-requests') {
    const status = params.get('status') ?? 'all';
    const search = (params.get('search') ?? '').trim().toLowerCase();
    const filtered = paymentRequestStore.filter((request) => {
      const matchesStatus = status === 'all' || request.status === status;
      const matchesSearch =
        search === '' ||
        request.organisation.toLowerCase().includes(search) ||
        request.submittedByEmail.toLowerCase().includes(search);
      return matchesStatus && matchesSearch;
    });
    return ok(paginate(filtered, params));
  }
  const approveMatch = /^\/superadmin\/payment-requests\/([^/]+)\/approve$/.exec(path);
  if (method === 'POST' && approveMatch !== null) {
    const existing = findPaymentRequest(approveMatch[1]);
    if (existing === undefined) {
      return fail(404, 'Not found', 'That payment no longer exists.');
    }
    if (existing.status !== 'Pending') {
      return fail(
        409,
        'Business rule violated',
        'This payment has already been decided.',
        'payment_already_decided',
      );
    }
    return ok(decidePaymentRequest(existing.id, 'Approved', null), 'Payment approved.');
  }
  const rejectMatch = /^\/superadmin\/payment-requests\/([^/]+)\/reject$/.exec(path);
  if (method === 'POST' && rejectMatch !== null) {
    const existing = findPaymentRequest(rejectMatch[1]);
    if (existing === undefined) {
      return fail(404, 'Not found', 'That payment no longer exists.');
    }
    if (existing.status !== 'Pending') {
      return fail(
        409,
        'Business rule violated',
        'This payment has already been decided.',
        'payment_already_decided',
      );
    }
    const reason = (body as { reason?: string })?.reason ?? '';
    if (reason.trim().length < 10) {
      return fail(422, 'Reason required', 'Tell the customer what to fix.', 'validation_failed');
    }
    return ok(decidePaymentRequest(existing.id, 'Rejected', reason.trim()), 'Payment rejected.');
  }
  const reviewMatch = /^\/superadmin\/payment-requests\/([^/]+)$/.exec(path);
  if (method === 'GET' && reviewMatch !== null) {
    const request = findPaymentRequest(reviewMatch[1]);
    return request === undefined
      ? fail(404, 'Not found', 'That payment no longer exists.')
      : ok(request);
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
  const authResponse = handleAuth(path, method, request.body, request);
  if (authResponse !== null) {
    return authResponse;
  }
  const importResponse = handleContactImports(path, method, request.body, params);
  if (importResponse !== null) {
    return importResponse;
  }
  const paymentResponse = handlePayments(path, method, request.body, params);
  if (paymentResponse !== null) {
    return paymentResponse;
  }
  const employeeResponse = handleEmployees(path, method, request.body);
  if (employeeResponse !== null) {
    return employeeResponse;
  }
  const whatsappResponse = handleWhatsApp(path, method, request.body, params);
  if (whatsappResponse !== null) {
    return whatsappResponse;
  }
  const workspaceResponse = handleWorkspace(path, method, request.body, request);
  if (workspaceResponse !== null) {
    return workspaceResponse;
  }
  const businessResponse = handleBusinessDiscovery(path, method, request.body, params);
  if (businessResponse !== null) {
    return businessResponse;
  }
  const campaignResponse = handleCampaigns(path, method, request.body, params, templateStore, { ok, fail });
  if (campaignResponse !== null) {
    return campaignResponse;
  }
  if (method === 'GET') {
    switch (path) {
      case '/dashboard': {
        const adminId = scopeOf(params);
        return ok(adminId === null ? DASHBOARD : dashboardForAdmin(adminId));
      }
      case '/superadmin/admins':
        return ok(ADMIN_ACCOUNTS);
      case '/superadmin/overview':
        return ok(PLATFORM_OVERVIEW);
      case '/contacts':
        return ok(paginate(filterContacts(params), params));
      case '/groups':
        return ok(GROUPS_WITH_COUNTS);
      case '/tags':
        return ok(TAGS_WITH_COUNTS);
      case '/whatsapp/connection': {
        const adminId = scopeOf(params);
        return ok(adminId === null ? WHATSAPP_CONNECTION : connectionForAdmin(adminId));
      }
      case '/templates':
        return ok(pageTemplates(params));
      case '/campaigns': {
        const adminId = scopeOf(params);
        return ok(adminId === null ? [...campaignStore] : campaignsForAdmin(adminId));
      }
      case '/reports/failures':
        return ok(paginate(DELIVERY_FAILURES, params));
      case '/reports/overview': {
        const adminId = scopeOf(params);
        return ok(adminId === null ? DASHBOARD : dashboardForAdmin(adminId));
      }
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
      case '/employees': {
        const adminId = scopeOf(params);
        return ok(adminId === null ? EMPLOYEES : employeesForAdmin(adminId));
      }
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
