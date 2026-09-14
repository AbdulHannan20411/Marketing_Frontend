import type { ApiError } from './api.model';
import { AI_GENERIC_ERROR, aiErrorMessage } from './ai-assistant.model';

function apiError(overrides: Partial<ApiError>): ApiError {
  return {
    status: 500,
    title: 'Something went wrong',
    detail: 'The request could not be completed. Quote reference abc when contacting support.',
    errorCode: '',
    fieldErrors: {},
    traceId: null,
    exceptionId: null,
    ...overrides,
  };
}

describe('aiErrorMessage', () => {
  it('shows the friendly generic message for provider failures, never the server text', () => {
    for (const status of [0, 500, 502, 503]) {
      expect(aiErrorMessage(apiError({ status }))).toBe(AI_GENERIC_ERROR);
    }
  });

  it('shows the validation message for the prompt', () => {
    const error = apiError({ status: 422, fieldErrors: { Prompt: ['Keep the prompt under 4,000 characters.'] } });
    expect(aiErrorMessage(error)).toBe('Keep the prompt under 4,000 characters.');
  });

  it('tells the user to wait when rate limited', () => {
    expect(aiErrorMessage(apiError({ status: 429 }))).toContain('wait a minute');
  });

  it('explains an unconfigured assistant and a withheld answer', () => {
    expect(aiErrorMessage(apiError({ status: 409, errorCode: 'ai_not_configured' }))).toContain('administrator');
    expect(aiErrorMessage(apiError({ status: 409, errorCode: 'ai_response_blocked' }))).toContain('rewording');
  });
});
