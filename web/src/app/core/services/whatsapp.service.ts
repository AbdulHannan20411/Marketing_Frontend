import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import type {
  Conversation,
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
import { ApiService } from './api.service';

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
 * Search and category only.
 *
 * Status is applied separately because the counts are a breakdown *by* status
 * and must not have it applied — the same rule the counts endpoint is supposed
 * to follow.
 */
function matchesScope(template: MessageTemplate, query: TemplateQuery): boolean {
  const term = query.search.trim().toLowerCase();

  const matchesSearch =
    term === '' ||
    template.name.toLowerCase().includes(term) ||
    template.bodyText.toLowerCase().includes(term);

  return matchesSearch && (query.category === 'all' || template.category === query.category);
}

function countByStatus(templates: readonly MessageTemplate[]): TemplateStatusCounts {
  const of = (status: MessageTemplate['status']): number =>
    templates.filter((template) => template.status === status).length;

  return {
    total: templates.length,
    approved: of('approved'),
    pending: of('pending'),
    rejected: of('rejected'),
    paused: of('paused'),
  };
}

/** Wraps a bare array into the paged shape the screen expects. */
function normaliseTemplatePage(
  response: PagedResult<MessageTemplate> | readonly MessageTemplate[],
  query: TemplateQuery,
): TemplatePage {
  if (!Array.isArray(response)) {
    return { ...(response as PagedResult<MessageTemplate>), pagedByServer: true };
  }

  // Scoped by search and category first: that set is what the counts describe.
  const scoped = (response as readonly MessageTemplate[]).filter((template) =>
    matchesScope(template, query),
  );

  const matched =
    query.status === 'all'
      ? scoped
      : scoped.filter((template) => template.status === query.status);

  const start = (query.page - 1) * query.pageSize;

  return {
    items: matched.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    totalItems: matched.length,
    totalPages: Math.max(1, Math.ceil(matched.length / query.pageSize)),
    pagedByServer: false,
    counts: countByStatus(scoped),
  };
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

  /** Never 404s — an unconnected tenant returns `status: 'disconnected'`. */
  getConnection(): Observable<WhatsAppConnection> {
    return this.api.get<WhatsAppConnection>('/whatsapp/connection');
  }

  syncConnection(): Observable<WhatsAppConnection> {
    return this.api.post<WhatsAppConnection>('/whatsapp/connection/sync');
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

  /** Destroys the stored credential; reconnecting means running signup again. */
  disconnect(): Observable<WhatsAppConnection> {
    return this.api.post<WhatsAppConnection>('/whatsapp/disconnect');
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
  listTemplates(query: TemplateQuery): Observable<TemplatePage> {
    return this.api
      .get<PagedResult<MessageTemplate> | readonly MessageTemplate[]>('/templates', {
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
        status: query.status,
        category: query.category,
      })
      .pipe(map((response) => normaliseTemplatePage(response, query)));
  }

  /**
   * Every template, for the pickers that need to offer all of them.
   *
   * The campaign wizard lists approved templates to choose from; a page of ten
   * would silently hide the eleventh. Asks for one large page and unwraps.
   */
  listAllTemplates(): Observable<readonly MessageTemplate[]> {
    return this.listTemplates({
      page: 1,
      pageSize: ALL_TEMPLATES_PAGE_SIZE,
      search: '',
      status: 'all',
      category: 'all',
    }).pipe(map((page) => page.items));
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
    return this.api.get<TemplateStatusCounts>('/templates/counts', {
      search: query.search,
      category: query.category,
    });
  }

  syncTemplates(): Observable<readonly MessageTemplate[]> {
    return this.api.post<readonly MessageTemplate[]>('/templates/sync');
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
  createTemplate(draft: TemplateDraft): Observable<MessageTemplate> {
    return this.api.post<MessageTemplate, TemplateDraft>('/templates', draft);
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
  uploadMedia(file: File, kind: MediaKind | 'audio'): Observable<MediaAsset> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('kind', kind);
    return this.api.upload<MediaAsset>('/whatsapp/media', form);
  }

  /* ------------------------------ conversations ------------------------------ */

  listConversations(page: number, pageSize: number, search = ''): Observable<PagedResult<Conversation>> {
    return this.api.get<PagedResult<Conversation>>('/whatsapp/conversations', {
      page,
      pageSize,
      search,
    });
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
