import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { WhatsAppAccount, WhatsAppAccountList } from '@core/models/whatsapp-account.model';
import { ApiService } from './api.service';

const BASE = '/whatsapp/accounts';

/**
 * The workspace's WhatsApp numbers.
 *
 * Every list is already filtered by the API to what the signed-in user may
 * view — an employee with access to one number never receives the others.
 * Connecting a **new** number still goes through `WhatsAppService.connect`
 * (Embedded Signup), which creates the account.
 */
@Injectable({ providedIn: 'root' })
export class WhatsAppAccountsService {
  private readonly api = inject(ApiService);

  list(): Observable<WhatsAppAccountList> {
    return this.api.get<WhatsAppAccountList>(BASE);
  }

  get(id: string): Observable<WhatsAppAccount> {
    return this.api.get<WhatsAppAccount>(`${BASE}/${encodeURIComponent(id)}`);
  }

  /** 409 `whatsapp_label_taken` when another number already uses the label. */
  rename(id: string, label: string): Observable<WhatsAppAccount> {
    return this.api.patch<WhatsAppAccount, { label: string }>(`${BASE}/${encodeURIComponent(id)}`, {
      label,
    });
  }

  /** Returns every account: the previous default's flag flipped too. */
  setDefault(id: string): Observable<readonly WhatsAppAccount[]> {
    return this.api.post<readonly WhatsAppAccount[]>(`${BASE}/${encodeURIComponent(id)}/default`);
  }

  sync(id: string): Observable<WhatsAppAccount> {
    return this.api.post<WhatsAppAccount>(`${BASE}/${encodeURIComponent(id)}/sync`);
  }

  /** Keeps history and assignments, so reconnecting the same number restores them. */
  disconnect(id: string): Observable<WhatsAppAccount> {
    return this.api.post<WhatsAppAccount>(`${BASE}/${encodeURIComponent(id)}/disconnect`);
  }

  /** Frees the plan slot. Only allowed once disconnected. */
  remove(id: string): Observable<null> {
    return this.api.delete(`${BASE}/${encodeURIComponent(id)}`);
  }
}
