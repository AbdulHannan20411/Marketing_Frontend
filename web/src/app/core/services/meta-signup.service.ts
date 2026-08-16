import { Injectable, signal } from '@angular/core';

import { environment } from '@env/environment';

/**
 * What the popup hands back once signup completes.
 *
 * The `code` is single-use and short-lived. It is passed straight to the API
 * and **never stored** — not in a signal that outlives the call, not in
 * storage, not on the URL. Exchanging it requires the app secret, which lives
 * only on the server.
 */
export interface EmbeddedSignupResult {
  readonly code: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
}

export class EmbeddedSignupError extends Error {
  constructor(
    message: string,
    /** `cancelled` when the user closed the popup; nothing went wrong. */
    readonly reason: 'cancelled' | 'blocked' | 'unconfigured' | 'failed',
  ) {
    super(message);
    this.name = 'EmbeddedSignupError';
  }
}

/** The subset of the Facebook JS SDK this service touches. */
interface FacebookSdk {
  init(options: Record<string, unknown>): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
    options: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
const SDK_ELEMENT_ID = 'facebook-jssdk';

/**
 * Meta Embedded Signup.
 *
 * The SDK is loaded on demand rather than in `index.html`: it is a third-party
 * script on every page load otherwise, and only this one screen needs it.
 *
 * Signup returns its two halves through different channels — the WABA and phone
 * number ids arrive as a `postMessage` from the popup, the authorisation code
 * through the `FB.login` callback — so both are collected before resolving.
 */
@Injectable({ providedIn: 'root' })
export class MetaSignupService {
  private loading: Promise<void> | null = null;

  /** True once the SDK is on the page, for disabling the button until then. */
  readonly ready = signal(false);

  /** False when the app id or config id is missing, which makes signup impossible. */
  readonly isConfigured = signal(
    environment.meta.appId !== '' && environment.meta.configId !== '',
  );

  /**
   * Opens the popup and resolves once Meta has returned everything needed.
   *
   * Rejects with `cancelled` if the user closes it — that is a normal outcome
   * and callers should stay silent rather than reporting a failure.
   */
  async launch(): Promise<EmbeddedSignupResult> {
    if (!this.isConfigured()) {
      throw new EmbeddedSignupError(
        'Meta app id and config id are not set for this environment.',
        'unconfigured',
      );
    }

    await this.load();

    const sdk = window.FB;
    if (sdk === undefined) {
      throw new EmbeddedSignupError('The Facebook SDK failed to load.', 'blocked');
    }

    return new Promise<EmbeddedSignupResult>((resolve, reject) => {
      let account: { wabaId: string; phoneNumberId: string } | null = null;

      // Meta posts the account ids here; the code arrives via the callback.
      const onMessage = (event: MessageEvent): void => {
        if (!event.origin.endsWith('facebook.com')) {
          return;
        }
        try {
          const payload = JSON.parse(String(event.data)) as {
            type?: string;
            event?: string;
            data?: { waba_id?: string; phone_number_id?: string };
          };
          if (payload.type !== 'WA_EMBEDDED_SIGNUP') {
            return;
          }
          if (payload.event === 'FINISH' && payload.data?.waba_id !== undefined) {
            account = {
              wabaId: payload.data.waba_id,
              phoneNumberId: payload.data.phone_number_id ?? '',
            };
          }
        } catch {
          // Facebook posts plenty of non-JSON chatter; ignore anything else.
        }
      };

      window.addEventListener('message', onMessage);

      const done = (): void => window.removeEventListener('message', onMessage);

      sdk.login(
        (response) => {
          done();

          const code = response.authResponse?.code;
          if (code === undefined || code === '') {
            reject(new EmbeddedSignupError('Signup was closed before it finished.', 'cancelled'));
            return;
          }
          if (account === null) {
            reject(
              new EmbeddedSignupError(
                'Signup finished without returning a WhatsApp account.',
                'failed',
              ),
            );
            return;
          }

          resolve({ code, wabaId: account.wabaId, phoneNumberId: account.phoneNumberId });
        },
        {
          config_id: environment.meta.configId,
          // `code` rather than a token: the exchange happens server-side.
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        },
      );
    });
  }

  /** Injects the SDK once; concurrent callers share the same promise. */
  private load(): Promise<void> {
    if (this.loading !== null) {
      return this.loading;
    }

    this.loading = new Promise<void>((resolve, reject) => {
      if (window.FB !== undefined) {
        this.ready.set(true);
        resolve();
        return;
      }

      window.fbAsyncInit = () => {
        window.FB?.init({
          appId: environment.meta.appId,
          cookie: true,
          xfbml: false,
          version: environment.meta.graphVersion,
        });
        this.ready.set(true);
        resolve();
      };

      const existing = document.getElementById(SDK_ELEMENT_ID);
      if (existing !== null) {
        return;
      }

      const script = document.createElement('script');
      script.id = SDK_ELEMENT_ID;
      script.src = SDK_URL;
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      // Ad blockers and strict CSPs both take this script out; the caller needs
      // to say so rather than leaving the button spinning.
      script.onerror = () => {
        this.loading = null;
        reject(new EmbeddedSignupError('The Facebook SDK could not be loaded.', 'blocked'));
      };

      document.body.appendChild(script);
    });

    return this.loading;
  }
}
