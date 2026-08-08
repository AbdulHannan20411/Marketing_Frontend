import type { AppEnvironment } from './environment';

export const environment: AppEnvironment = {
  production: true,
  // Served behind the same origin in production; the reverse proxy forwards /api and /hubs.
  apiBaseUrl: '/api/v1',
  realtimeUrl: '/hubs/realtime',
  useMockApi: false,
  appName: 'Verdant',
};
