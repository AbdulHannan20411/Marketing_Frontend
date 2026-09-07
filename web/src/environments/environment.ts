import type { AppEnvironment } from './environment.model';

export type { AppEnvironment };

export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: 'https://localhost:7108/api/v1',
  realtimeUrl: 'https://localhost:7108/hubs/realtime',
  useMockApi: false,
  appName: 'NextReach',
  // graphVersion is pinned to match the server's own Graph version rather than tracking the
  // newest one Meta offers, so the browser's SDK and the API cannot end up on two versions of
  // the same flow. v21.0 expires on 21 January 2027; the bump is a deliberate change to make in
  // all three places at once, not something to drift into.
  meta: {
    appId: '934175505679137',
    configId: '1597003388716127',
    graphVersion: 'v21.0',
    // From Meta's own generated snippet for this app. The SDK version and the
    // server's Graph version are independent; only this one gates the dialog.
    sdkVersion: 'v26.0',
    // Copied from Meta's generated snippet for config 1597003388716127,
    // which declares `app_only_install` and no featureType. These two must
    // agree with the console or the dialog silently degrades to a plain login.
    signupFeatures: ['app_only_install'],
    signupFeatureType: 'whatsapp_business_app_onboarding',
    signupVersion: 'v4',
  },
};
