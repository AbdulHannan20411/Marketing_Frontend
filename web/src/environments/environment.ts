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

export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: 'https://localhost:7108/api/v1',
  realtimeUrl: 'https://localhost:7108/hubs/realtime',
  useMockApi: false,
  appName: 'Verdant',
};
