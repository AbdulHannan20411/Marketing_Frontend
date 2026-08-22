import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  DeactivateWorkspaceRequest,
  DeactivateWorkspaceResult,
} from '@core/models/workspace.model';
import { ApiService } from './api.service';

/**
 * Workspace-level operations the tenant owner performs on the whole account.
 *
 * Separate from `AuthService`, which is about *who you are*. Deactivation is
 * about *what the workspace is*, and it affects every user in it.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly api = inject(ApiService);

  /**
   * Switches the workspace off.
   *
   * The tenant is resolved from the token — no id is sent, and the endpoint
   * must never accept one. A workspace id in the body would let any admin
   * deactivate any other workspace by guessing.
   *
   * Not yet served; see `docs/API-WORKSPACE-DEACTIVATION.md`. The caller
   * surfaces the failure rather than pretending it worked, which matters more
   * here than anywhere else in the app: a user who believes their workspace is
   * off will stop watching it.
   */
  deactivate(request: DeactivateWorkspaceRequest): Observable<DeactivateWorkspaceResult> {
    return this.api.post<DeactivateWorkspaceResult, DeactivateWorkspaceRequest>(
      '/workspace/deactivate',
      request,
    );
  }
}
