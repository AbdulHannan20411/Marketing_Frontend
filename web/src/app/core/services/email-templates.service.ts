import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  EmailTemplate,
  EmailTemplateDraft,
  EmailTemplateSummary,
  TestEmailResult,
} from '@core/models/email-template.model';
import { ApiService } from './api.service';

const BASE = '/superadmin/email-templates';

/**
 * Platform email templates. Super Admin only.
 *
 * Under `/superadmin`, so the scope interceptor never attaches `?adminId=`:
 * templates belong to the platform, not to any workspace.
 */
@Injectable({ providedIn: 'root' })
export class EmailTemplatesService {
  private readonly api = inject(ApiService);

  list(): Observable<readonly EmailTemplateSummary[]> {
    return this.api.get<readonly EmailTemplateSummary[]>(BASE);
  }

  get(key: string): Observable<EmailTemplate> {
    return this.api.get<EmailTemplate>(`${BASE}/${encodeURIComponent(key)}`);
  }

  /** Validated on the server with the same rules as the editor; rejected with 422 otherwise. */
  update(key: string, draft: EmailTemplateDraft): Observable<EmailTemplate> {
    return this.api.put<EmailTemplate, EmailTemplateDraft>(`${BASE}/${encodeURIComponent(key)}`, draft);
  }

  /**
   * Renders the **unsaved** draft on the server with sample data and emails it
   * to the signed-in staff member — so a change can be checked in a real inbox
   * before anyone else receives it.
   */
  sendTest(key: string, draft: EmailTemplateDraft): Observable<TestEmailResult> {
    return this.api.post<TestEmailResult, EmailTemplateDraft>(
      `${BASE}/${encodeURIComponent(key)}/test`,
      draft,
    );
  }

  /** Replaces the stored template with the shipped default. */
  reset(key: string): Observable<EmailTemplate> {
    return this.api.post<EmailTemplate>(`${BASE}/${encodeURIComponent(key)}/reset`);
  }
}
