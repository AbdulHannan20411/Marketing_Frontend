import type { AppEnvironment } from './environment.model';

export const environment: AppEnvironment = {
  production: true,
  // Served behind the same origin in production; the reverse proxy forwards /api and /hubs.
  apiBaseUrl: '/api/v1',
  realtimeUrl: '/hubs/realtime',
  useMockApi: false,
  appName: 'NextReach',
  // The same Meta app serves development and production, so these match environment.ts. Should
  // production ever move to its own app, both values change together: an app id paired with
  // another app's configuration id opens a signup that returns no WhatsApp account at all.
  // graphVersion stays pinned to the server's Graph version; v21.0 expires on 21 January 2027.
  meta: {
    appId: '934175505679137',
    configId: '1597003388716127',
    graphVersion: 'v21.0',
  },
};
