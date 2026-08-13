import type { AppEnvironment } from './environment.model';

export type { AppEnvironment };

export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: 'https://localhost:7108/api/v1',
  realtimeUrl: 'https://localhost:7108/hubs/realtime',
  useMockApi: false,
  appName: 'NextReach',
};
