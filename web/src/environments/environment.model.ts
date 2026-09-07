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

  /**
   * Features the configuration declares, by name.
   *
   * **Copy these from Meta's own generated snippet for the same config id** —
   * the console shows the exact `extras` it expects. Guessing does not work:
   * a mismatch does not error, it makes the dialog fall through to an ordinary
   * Facebook login that returns a code and runs no WhatsApp flow at all.
   *
   * Empty omits the key entirely, which is what a config with no features
   * wants — sending `features: []` is not the same as not sending it.
   */
  /**
   * Graph version the **browser SDK** initialises with.
   *
   * Separate from `graphVersion`, which is the version the *server* calls and
   * is pinned to the backend's `WhatsApp:ApiVersion`. These were one field,
   * which conflated two unrelated concerns: the SDK version decides whether
   * the login dialog can run a given Embedded Signup flow, and Meta's own
   * generated snippet for the app states which to use.
   */
  readonly sdkVersion: string;

  readonly signupFeatures: readonly string[];

  /**
   * Legacy single-feature form, for configurations that use it.
   *
   * Older configs declare one `featureType` instead of a `features` array.
   * Empty omits the key. Both forms are supported because which one a config
   * uses is not something this code can infer — only Meta's snippet says.
   */
  readonly signupFeatureType: string;

  /**
   * Embedded Signup flow version, from that same hosted link.
   *
   * Distinct from `graphVersion`, which is the API version the server calls.
   */
  readonly signupVersion: string;
}
