/**
 * The shape both environment files implement.
 *
 * It lives in its own file because the production build *replaces*
 * `environment.ts` with `environment.production.ts`. Declaring the interface in
 * `environment.ts` made the replacement file import itself, so the type
 * vanished and only the production bundle failed to compile.
 */
export interface AppEnvironment {
  readonly production: boolean;
  readonly apiBaseUrl: string;
  /** SignalR hub for campaign progress and notification pushes. */
  readonly realtimeUrl: string;
  /**
   * When true, HTTP traffic is served by the in-memory mock backend interceptor.
   * Kept for offline UI work; the real API is the default.
   */
  readonly useMockApi: boolean;
  readonly appName: string;
}
