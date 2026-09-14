import type { ApiError } from './api.model';

/**
 * The AI marketing assistant.
 *
 * The browser only ever talks to our API. Which AI provider answers, and its
 * key, are server-side concerns — nothing here names or needs them.
 */

/** Mirrors `AiGenerateRequest.MaxPromptLength` on the API. */
export const AI_PROMPT_MAX_LENGTH = 4000;

export interface AiGenerateRequest {
  readonly prompt: string;
}

export interface AiGenerateResponse {
  /** Plain text. Rendered as text, never as HTML. */
  readonly answer: string;
}

export const AI_PROMPT_EXAMPLES: readonly string[] = [
  'Create a promotional message for a dental clinic offering 20% off.',
  'Write a WhatsApp reminder for customers whose gym membership expires next week.',
  'Suggest three short subject lines for a weekend bakery sale.',
];

export const AI_GENERIC_ERROR = 'Unable to generate a response right now. Please try again.';

/**
 * What the user reads when a generation fails.
 *
 * Deliberately never the server's own text for provider failures: that is a
 * generic "quote this reference" message, and the user needs to know whether
 * trying again will help.
 */
export function aiErrorMessage(error: ApiError): string {
  if (error.status === 422) {
    return error.fieldErrors['Prompt']?.[0] ?? 'Check the prompt and try again.';
  }
  if (error.status === 429) {
    return "You've reached the limit for now. Please wait a minute and try again.";
  }
  if (error.errorCode === 'ai_not_configured') {
    return "The AI assistant isn't set up yet. Ask your administrator to configure it.";
  }
  if (error.errorCode === 'ai_response_blocked') {
    return "The assistant couldn't answer that request. Try rewording it.";
  }
  if (error.status === 403) {
    return "You don't have access to the AI assistant.";
  }
  return AI_GENERIC_ERROR;
}
