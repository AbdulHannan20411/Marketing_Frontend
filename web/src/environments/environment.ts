import type { AppEnvironment } from './environment.model';

export type { AppEnvironment };

export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: 'https://localhost:7108/api/v1',
  realtimeUrl: 'https://localhost:7108/hubs/realtime',
  useMockApi: false,
  appName: 'NextReach',
  // configId is still empty: Embedded Signup cannot open without it, and the connect button
  // stays disabled until it is filled in from Meta's WhatsApp > Configuration screen.
  meta: {
    appId: '934175505679137',
    configId: '',
    graphVersion: 'v21.0',
  },
};
