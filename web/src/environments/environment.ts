export interface AppEnvironment {
  readonly production: boolean;
  readonly apiBaseUrl: string;
  /** When true, HTTP traffic is served by the in-memory mock backend interceptor. */
  readonly useMockApi: boolean;
  readonly appName: string;
}

export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: '/api/v1',
  useMockApi: true,
  appName: 'Verdant',
};
