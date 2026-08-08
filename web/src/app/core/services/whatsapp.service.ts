import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { MessageTemplate, WhatsAppConnection } from '@core/models/whatsapp.model';
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
}
