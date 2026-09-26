import { Injectable, inject } from '@angular/core';
import { map, switchMap, type Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import type {
  Conversation,
  ConversationFilters,
  ConversationMessage,
  MediaAsset,
  MediaKind,
  MessageTemplate,
  SendMessageRequest,
  TemplateDraft,
  TemplateCountQuery,
  TemplateQuery,
  TemplateStatusCounts,
  WhatsAppConnection,
} from '@core/models/whatsapp.model';
import { DEFAULT_CONVERSATION_FILTERS } from '@core/models/whatsapp.model';
import { sortParams } from '@shared/ui/data-table/sort';
import { ApiService } from './api.service';
import { WhatsAppContextService } from './whatsapp-context.service';

/**
 * One large page stands in for "everything" where a picker needs the full set.
 * Well above any plausible template count — Meta's own per-account ceiling is
 * far lower — so it is a page in name only.
 */
const ALL_TEMPLATES_PAGE_SIZE = 500;

export interface TemplatePage extends PagedResult<MessageTemplate> {
  /**
   * Whether the API did the filtering and slicing.
   *
   * False means this page was cut from a full array client-side, which is
   * correct but does not scale — and means the status counts are exact only
   * because the whole collection happened to be in hand.
   */
  readonly pagedByServer: boolean;

  /**
   * Status counts computed here, present **only** when the whole collection was
   * in hand.
   *
   * These are trustworthy precisely because they are derived from the same
   * array the list came from, under the same search and category. `GET
   * /templates/counts` currently ignores both filters and counts the entire
   * workspace, which is what produced "Pending 1" beside an empty list. When
   * that endpoint honours the filters and the list is genuinely paged, this is
   * absent and the endpoint's answer is used instead.
   */
  readonly counts?: TemplateStatusCounts;
}

/**
 * Normalises the paged response.
 *
 * This used to accept a bare array too, slicing and counting client-side while
 * the endpoint was unpaged. It pages properly now — filtered in SQL — so the
 * array branch was dead, and with it the client-side `counts`: those were only
 * ever exact because the whole collection happened to be in hand.
 */
function normaliseTemplatePage(response: PagedResult<MessageTemplate>): TemplatePage {
  return { ...response, pagedByServer: true };
}

export interface ConnectWhatsAppRequest {
  readonly code: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
}

/**
 * Connecting with a token pasted by hand, bypassing Embedded Signup.
 *
 * **Platform staff only, and a testing tool rather than an onboarding route.**
 * It exists because a Meta *test* number is already claimed inside the
 * developer app — there is no signup flow to run against it — so this is the
 * only way to exercise the messaging path before the app has been reviewed.
 *
 * A token arriving this way has come through a channel nobody audited, which is
 * why the API restricts it to Super Admins and why tenant administrators must
 * use Embedded Signup instead.
 */
export interface ManualConnectWhatsAppRequest {
  readonly accessToken: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
}

@Injectable({ providedIn: 'root' })
export class WhatsAppService {
  private readonly api = inject(ApiService);
  private readonly context = inject(WhatsAppContextService);

  /**
   * The number a call is about, unless the caller names one.
   *
   * Sent as `?accountId=`. When the workspace has a single number — or the API
   * predates multiple numbers — it is simply absent, which the API reads as
   * "the default account", so nothing changes for anyone with one number.
   */
  private scoped<T>(explicit: string | null | undefined, call: (accountId: string) => Observable<T>): Observable<T> {
    if (explicit !== null && explicit !== undefined && explicit !== '') {
      return call(explicit);
    }
    // Empty rather than undefined: `toHttpParams` drops empty values, so the
    // parameter is simply absent — exactly what a single-number server expects.
    return this.context.resolvedAccountId().pipe(switchMap((id) => call(id ?? '')));
  }

  /** Query string for the calls whose helper takes no params object. */
  private pathWith(path: string, accountId: string): string {
    return accountId === '' ? path : `${path}?accountId=${encodeURIComponent(accountId)}`;
  }

  /** Never 404s — an unconnected tenant returns `status: 'disconnected'`. */
  getConnection(accountId?: string | null): Observable<WhatsAppConnection> {
    return this.scoped(accountId, (id) => this.api.get<WhatsAppConnection>('/whatsapp/connection', { accountId: id }));
  }

  syncConnection(accountId?: string | null): Observable<WhatsAppConnection> {
    return this.scoped(accountId, (id) =>
      this.api.post<WhatsAppConnection>(this.pathWith('/whatsapp/connection/sync', id)),
    );
  }

  /**
   * Completes Meta Embedded Signup. The popup returns these three values and
   * the server exchanges the code — there is no OAuth redirect to handle.
   */
  connect(request: ConnectWhatsAppRequest): Observable<WhatsAppConnection> {
    return this.api.post<WhatsAppConnection, ConnectWhatsAppRequest>('/whatsapp/connect', request);
  }

  /**
   * Connects using a token supplied directly. Super Admin only — the API
   * refuses anyone else.
   *
   * The workspace is chosen by the scope bar: `scopeInterceptor` attaches
   * `?adminId=` automatically, and this endpoint is one of the few writes that
   * honours it. Nothing about the token is kept client-side.
   */
  connectManually(request: ManualConnectWhatsAppRequest): Observable<WhatsAppConnection> {
    return this.api.post<WhatsAppConnection, ManualConnectWhatsAppRequest>(
      '/whatsapp/connect/manual',
      request,
    );
  }

  /**
   * Restarts a failed onboarding using the credential already stored.
   *
   * No new authorisation code, so no second trip through the Meta popup — the
   * token is fine, one Graph call failed. Steps that already succeeded or were
   * skipped are left alone, so a number is never re-registered.
   *
   * Refused with `409` for `token_rejected`: that credential is dead and
   * retrying it can only fail again. The server enforces the rule rather than
   * trusting the client to hide the button.
   */
  resumeConnect(accountId?: string | null): Observable<WhatsAppConnection> {
    return this.scoped(accountId, (id) =>
      this.api.post<WhatsAppConnection>(this.pathWith('/whatsapp/connect/resume', id)),
    );
  }

  /** Destroys the stored credential; reconnecting means running signup again. */
  disconnect(accountId?: string | null): Observable<WhatsAppConnection> {
    return this.scoped(accountId, (id) =>
      this.api.post<WhatsAppConnection>(this.pathWith('/whatsapp/disconnect', id)),
    );
  }

  /**
   * One page of templates, filtered and searched by the API.
   *
   * **Accepts both shapes.** The endpoint returns a bare array today and a
   * `PagedResult` once the paging work lands; rather than break until then,
   * an array response is filtered and sliced here so the screen behaves
   * identically either way. `pagedByServer` on the result says which happened,
   * because the difference matters for the counts — see `countTemplates`.
   */
  listTemplates(query: TemplateQuery, accountId?: string | null): Observable<TemplatePage> {
    return this.scoped(accountId, (id) =>
      this.api
        .get<PagedResult<MessageTemplate>>('/templates', {
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          status: query.status,
          category: query.category,
          // Templates belong to a WABA, so a number with its own WABA has its own set.
          accountId: id,
          ...sortParams(query.sortBy, query.sortDirection),
        })
        .pipe(map((response) => normaliseTemplatePage(response))),
    );
  }

  /**
   * Every template, for the pickers that need to offer all of them.
   *
   * The campaign wizard lists approved templates to choose from; a page of ten
   * would silently hide the eleventh. Asks for one large page and unwraps.
   */
  listAllTemplates(accountId?: string | null): Observable<readonly MessageTemplate[]> {
    return this.listTemplates(
      {
        page: 1,
        pageSize: ALL_TEMPLATES_PAGE_SIZE,
        search: '',
        status: 'all',
        category: 'all',
      },
      accountId,
    ).pipe(map((page) => page.items));
  }

  /**
   * How many templates sit in each status, under the current search and
   * category — but across every page, not just this one.
   *
   * Status is deliberately not sent: these counts *are* the breakdown by
   * status. Search and category are, because a chip reading "Pending 1" beside
   * an empty list is worse than no number at all — it tells the operator the
   * filter is broken when it is working perfectly.
   */
  countTemplates(query: TemplateCountQuery): Observable<TemplateStatusCounts> {
    return this.scoped(undefined, (id) =>
      this.api.get<TemplateStatusCounts>('/templates/counts', {
        search: query.search,
        category: query.category,
        accountId: id,
      }),
    );
  }

  syncTemplates(): Observable<readonly MessageTemplate[]> {
    return this.scoped(undefined, (id) =>
      this.api.post<readonly MessageTemplate[]>(this.pathWith('/templates/sync', id)),
    );
  }

  deleteTemplate(id: string): Observable<null> {
    return this.api.delete(`/templates/${id}`);
  }

  /**
   * Creates a template and submits it to Meta for review in one step.
   *
   * There is no draft state: Meta owns approval, and a local draft that has
   * never been submitted would show a status the customer cannot act on.
   */
  createTemplate(draft: TemplateDraft, accountId?: string | null): Observable<MessageTemplate> {
    // Submitted to the chosen number's WABA. Edits and deletes need no number:
    // the API uses the template's own WABA.
    return this.scoped(accountId, (id) =>
      this.api.post<MessageTemplate, TemplateDraft>('/templates', draft, { accountId: id }),
    );
  }

  /** Only a rejected template may be edited; approved ones are immutable at Meta. */
  updateTemplate(id: string, draft: TemplateDraft): Observable<MessageTemplate> {
    return this.api.put<MessageTemplate, TemplateDraft>(`/templates/${id}`, draft);
  }

  /* ------------------------------ media ------------------------------ */

  /**
   * Uploads a file and returns the handle Meta gave it.
   *
   * The client never sends raw bytes to Meta: the API holds the credential and
   * proxies the upload, so a media id is all that crosses back.
   */
  /**
   * Meta's media handle belongs to the number that uploaded it, so a reply's
   * attachment must be uploaded through the conversation's own number — one
   * uploaded through another number cannot be sent from this one.
   */
  uploadMedia(file: File, kind: MediaKind | 'audio', accountId?: string | null): Observable<MediaAsset> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('kind', kind);
    return this.scoped(accountId, (id) => this.api.upload<MediaAsset>(this.pathWith('/whatsapp/media', id), form));
  }

  /* ------------------------------ conversations ------------------------------ */

  /**
   * The inbox deliberately does **not** default to the selected number: "every
   * number I can see" is the useful starting point for someone who answers on
   * several. The filter bar picks one explicitly.
   */
  listConversations(
    page: number,
    pageSize: number,
    search = '',
    filters: ConversationFilters = DEFAULT_CONVERSATION_FILTERS,
  ): Observable<PagedResult<Conversation>> {
    const only = (value: string): string => (value === 'all' ? '' : value);
    return this.api.get<PagedResult<Conversation>>('/whatsapp/conversations', {
      page,
      pageSize,
      search,
      accountId: only(filters.accountId),
      status: only(filters.status),
      assignedTo: only(filters.assignedTo),
      messageType: only(filters.messageType),
    });
  }

  /** `null` unassigns. The assignee must be able to see the conversation's number. */
  assignConversation(conversationId: string, userId: string | null): Observable<Conversation> {
    return this.api.post<Conversation, { userId: string | null }>(
      `/whatsapp/conversations/${conversationId}/assign`,
      { userId },
    );
  }

  getConversation(id: string): Observable<Conversation> {
    return this.api.get<Conversation>(`/whatsapp/conversations/${id}`);
  }

  /** Oldest first, so the thread renders in reading order. */
  listMessages(
    conversationId: string,
    page: number,
    pageSize: number,
  ): Observable<PagedResult<ConversationMessage>> {
    return this.api.get<PagedResult<ConversationMessage>>(
      `/whatsapp/conversations/${conversationId}/messages`,
      { page, pageSize },
    );
  }

  /**
   * Sends inside the 24-hour window. Rejected with `window_closed` once it has
   * shut — the UI blocks it first, but the server is the authority on the clock.
   */
  sendMessage(request: SendMessageRequest): Observable<ConversationMessage> {
    return this.api.post<ConversationMessage, SendMessageRequest>(
      `/whatsapp/conversations/${request.conversationId}/messages`,
      request,
    );
  }

  /** Clears the unread count; safe to call repeatedly. */
  markRead(conversationId: string): Observable<Conversation> {
    return this.api.post<Conversation>(`/whatsapp/conversations/${conversationId}/read`);
  }
}
