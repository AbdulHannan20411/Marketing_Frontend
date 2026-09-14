import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { AiGenerateRequest, AiGenerateResponse } from '@core/models/ai-assistant.model';
import { ApiService } from './api.service';

/**
 * The AI marketing assistant.
 *
 * **Calls our own API, never an AI provider.** The provider key exists only on
 * the server; a browser that could reach the provider directly would publish
 * that key to every customer.
 */
@Injectable({ providedIn: 'root' })
export class AiAssistantService {
  private readonly api = inject(ApiService);

  generate(prompt: string): Observable<AiGenerateResponse> {
    return this.api.post<AiGenerateResponse, AiGenerateRequest>('/ai/generate', { prompt });
  }
}
