import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { MessageTemplate, WhatsAppConnection } from '@core/models/whatsapp.model';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class WhatsAppService {
  private readonly api = inject(ApiService);

  getConnection(): Observable<WhatsAppConnection> {
    return this.api.get<WhatsAppConnection>('/whatsapp/connection');
  }

  syncConnection(): Observable<WhatsAppConnection> {
    return this.api.post<WhatsAppConnection>('/whatsapp/connection/sync');
  }

  listTemplates(): Observable<readonly MessageTemplate[]> {
    return this.api.get<readonly MessageTemplate[]>('/templates');
  }

  syncTemplates(): Observable<readonly MessageTemplate[]> {
    return this.api.post<readonly MessageTemplate[]>('/templates/sync');
  }
}
