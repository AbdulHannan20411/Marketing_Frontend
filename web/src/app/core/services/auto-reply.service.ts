import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { AutoReplyDraft, AutoReplySettings } from '@core/models/auto-reply.model';
import { ApiService } from './api.service';

const BASE = '/whatsapp/auto-reply';

/**
 * AI auto-reply settings.
 *
 * Module-gated on the API (`ai`) and behind `settings.integrations`, so a 403
 * here is a real answer rather than a bug.
 */
@Injectable({ providedIn: 'root' })
export class AutoReplyService {
  private readonly api = inject(ApiService);

  get(): Observable<AutoReplySettings> {
    return this.api.get<AutoReplySettings>(BASE);
  }

  /** Rejected with 409 `auto_reply_trigger_not_in_plan` for a trigger the plan excludes. */
  update(draft: AutoReplyDraft): Observable<AutoReplySettings> {
    return this.api.put<AutoReplySettings, AutoReplyDraft>(BASE, draft);
  }
}
