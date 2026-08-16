import type { AppEnvironment } from './environment.model';

export type { AppEnvironment };

export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: 'https://localhost:7108/api/v1',
  realtimeUrl: 'https://localhost:7108/hubs/realtime',
  useMockApi: false,
  appName: 'NextReach',
  // Replace with the real values from your Meta app before running signup.
  meta: {
    appId: '',
    configId: '',
    graphVersion: 'v21.0',
  },
};
