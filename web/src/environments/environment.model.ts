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
  readonly meta: MetaSignupConfig;
}

/**
 * Meta Embedded Signup parameters.
 *
 * All three are public — the app id and config id are visible in any client
 * that runs signup, and Meta expects them in browser code. No secret belongs
 * here: the `code` the popup returns is exchanged server-side, using an app
 * secret the client never sees.
 */
export interface MetaSignupConfig {
  readonly appId: string;
  readonly configId: string;
  /** Graph API version the SDK initialises with, e.g. `v21.0`. */
  readonly graphVersion: string;
}
