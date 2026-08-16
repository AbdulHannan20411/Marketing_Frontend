import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import type {
  Conversation,
  ConversationMessage,
  MediaAsset,
  MediaKind,
  MessageTemplate,
  SendMessageRequest,
  TemplateDraft,
  WhatsAppConnection,
} from '@core/models/whatsapp.model';
import { ApiService } from './api.service';

export interface ConnectWhatsAppRequest {
  readonly code: string;
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

  /** Destroys the stored credential; reconnecting means running signup again. */
  disconnect(): Observable<WhatsAppConnection> {
    return this.api.post<WhatsAppConnection>('/whatsapp/disconnect');
  }

  listTemplates(): Observable<readonly MessageTemplate[]> {
    return this.api.get<readonly MessageTemplate[]>('/templates');
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
