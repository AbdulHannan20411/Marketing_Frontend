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
    /**
     * Where in Meta's own flow it stopped, when Meta said so.
     *
     * Meta posts `current_step` on both CANCEL and ERROR. It is the difference
     * between "they changed their mind on the first screen" and "they got to
     * phone verification and the SMS never arrived" — the second is a support
     * conversation, the first is not.
     */
    readonly metaStep: string | null = null,
    /**
     * Which `WA_EMBEDDED_SIGNUP` events actually arrived.
     *
     * When signup ends without an account this is the only evidence of why.
     * "no events" means Meta never spoke to us at all — usually an origin
     * missing from *Allowed Domains for the JavaScript SDK*, or a Facebook
     * account that is not a role on an app still in review. Without it the
     * failure is a dead end for whoever has to diagnose it.
     */
    readonly diagnostic: string | null = null,
  ) {
    super(message);
    this.name = 'EmbeddedSignupError';
  }
}

/**
 * Meta's signup payload, however it happens to arrive.
 *
 * `postMessage` sometimes carries a JSON **string** and sometimes an already
 * parsed **object**, depending on the SDK build. `JSON.parse(String(data))` on
 * an object yields `"[object Object]"`, throws, and — behind a bare `catch` —
 * silently discards the one message that matters. Both shapes are accepted.
 */
function readSignupPayload(data: unknown): SignupPayload | null {
  if (typeof data === 'object' && data !== null) {
    return data as SignupPayload;
  }
  if (typeof data !== 'string') {
    return null;
  }
  try {
    return JSON.parse(data) as SignupPayload;
  } catch {
    // Facebook posts plenty of unrelated non-JSON chatter on this channel.
    return null;
  }
}

interface SignupPayload {
  readonly type?: string;
  readonly event?: string;
  readonly data?: {
    readonly waba_id?: string;
    readonly phone_number_id?: string;
    readonly current_step?: string;
    readonly error_message?: string;
  };
}

/**
 * Every event Meta treats as a completed run.
 *
 * `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` is the same outcome by another
 * name; matching only `FINISH` drops it and reports a successful signup as a
 * failure. `FINISH_ONLY_WABA` is deliberately **not** here — see below.
 */
const FINISH_EVENTS: readonly string[] = ['FINISH', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'];

/**
 * Meta's own step names, mapped to something an admin can read.
 *
 * Unknown keys pass through untouched rather than being dropped: a step Meta
 * adds later is still more useful in a support ticket than nothing.
 */
const META_STEP_LABELS: Readonly<Record<string, string>> = {
  BUSINESS_ACCOUNT_SELECTION: 'choosing a business account',
  BUSINESS_VERIFICATION: 'business verification',
  WABA_SELECTION: 'choosing a WhatsApp account',
  PHONE_NUMBER_SELECTION: 'choosing a phone number',
  PHONE_NUMBER_VERIFICATION: 'verifying the phone number',
  LOADING: 'loading',
  ERROR: 'an error screen',
};

export function describeMetaStep(step: string | null): string | null {
  if (step === null || step === '') {
    return null;
  }
  return META_STEP_LABELS[step] ?? step.toLowerCase().replace(/_/g, ' ');
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

/** Hostname of an origin, or the input when it will not parse. */
function originHost(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/** Every origin Meta is known to post signup events from. */
const TRUSTED_ORIGINS = new Set([
  'https://www.facebook.com',
  'https://web.facebook.com',
  'https://business.facebook.com',
  'https://m.facebook.com',
  'https://facebook.com',
]);

/** Payload shape Meta posts back. Pinned here so it cannot drift silently. */
const SESSION_INFO_VERSION = '3';

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
const SDK_ELEMENT_ID = 'facebook-jssdk';

/**
 * A message's shape, for the diagnostic trail — never its contents.
 *
 * Meta posts plenty of unrelated chatter on this channel, and payloads can
 * carry tokens. Enough to tell a signup event from noise, and nothing more.
 */
function describeShape(data: unknown): string {
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed.startsWith('{')) {
      return `string(${trimmed.slice(0, 24)})`;
    }
    try {
      const parsed = JSON.parse(trimmed) as { type?: unknown };
      return typeof parsed.type === 'string' ? `json:${parsed.type}` : 'json(no type)';
    } catch {
      return 'string(unparsed)';
    }
  }
  if (typeof data === 'object' && data !== null) {
    const type = (data as { type?: unknown }).type;
    return typeof type === 'string' ? `object:${type}` : 'object(no type)';
  }
  return typeof data;
}

/**
 * The `extras` object for `FB.login`, assembled from configuration.
 *
 * Built rather than written literally so that matching a new configuration is
 * an environment change, not a code change — this has already been wrong
 * twice, and each correction cost a rebuild and a round trip.
 *
 * Which of `features` and `featureType` a config wants is only knowable from
 * Meta's own generated snippet, so both are supported and whichever is left
 * blank is left out entirely.
 */
function buildSignupExtras(): Record<string, unknown> {
  const extras: Record<string, unknown> = {
    // Kept although Meta's JS snippet omits it: this is what asks for the
    // FINISH postMessage carrying `waba_id` and `phone_number_id`, which the
    // whole connect call depends on. Meta's own hosted launcher sends it, and
    // their step 2 tells you to listen for exactly that message — the snippet
    // simply leaves it at its default.
    sessionInfoVersion: SESSION_INFO_VERSION,
    version: environment.meta.signupVersion,
  };

  const variant = extrasVariant();

  if (variant.features && environment.meta.signupFeatures.length > 0) {
    extras['features'] = environment.meta.signupFeatures.map((name) => ({ name }));
  }
  if (variant.featureType && environment.meta.signupFeatureType !== '') {
    extras['featureType'] = environment.meta.signupFeatureType;
  }
  return extras;
}

/**
 * Which optional extras to include, overridable from the URL outside production.
 *
 * `extras` are a *request*, not a description of the configuration: asking for
 * `app_only_install` may narrow the dialog rather than describe it. Which
 * combination a given configuration actually wants has taken several rebuilds
 * to explore, so `?esExtras=` makes the remaining ones testable in one sitting:
 *
 *   ?esExtras=none        neither key
 *   ?esExtras=features    features only
 *   ?esExtras=featureType featureType only
 *   ?esExtras=both        both (the configured default)
 *
 * Ignored in production, where the environment is the only source.
 */
function extrasVariant(): { features: boolean; featureType: boolean } {
  const both = { features: true, featureType: true };
  if (environment.production) {
    return both;
  }

  const requested = new URLSearchParams(window.location.search).get('esExtras');
  switch (requested) {
    case 'none':
      return { features: false, featureType: false };
    case 'features':
      return { features: true, featureType: false };
    case 'featureType':
      return { features: false, featureType: true };
    default:
      return both;
  }
}

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
      let lastStep: string | null = null;
      let cancelled = false;
      let metaError: string | null = null;
      let wabaOnly = false;
      const seenEvents: string[] = [];
      const rejectedOrigins = new Set<string>();
      // Message `type` values only — never payload contents.
      const observedTypes = new Set<string>();
      // Origin + shape of every message, trusted or not. Never contents.
      const allMessages: string[] = [];

      // Meta posts the account ids here; the code arrives via the callback.
      const onMessage = (event: MessageEvent): void => {
        // Counted before any filtering. The previous trail only saw messages
        // that passed the origin check *and* parsed with a `type`, so the one
        // case we most need to distinguish — Meta posting something we do not
        // recognise — looked identical to Meta posting nothing at all.
        allMessages.push(`${originHost(event.origin)}:${describeShape(event.data)}`);

        // Exact hosts, not `endsWith('facebook.com')` — that also matches
        // `notfacebook.com`, letting any such origin post a forged FINISH here.
        if (!TRUSTED_ORIGINS.has(event.origin)) {
          // Recorded, never trusted. Without this a Meta origin added in future
          // would be dropped silently and report as "no signup events" — the
          // allowlist would have become the very mystery it was meant to solve.
          if (/(^|\.)facebook\.com$/.test(originHost(event.origin))) {
            rejectedOrigins.add(event.origin);
          }
          return;
        }
        const payload = readSignupPayload(event.data);

        // Every message from Meta is noted, not only the ones we understand.
        // "Meta sent nothing at all" and "Meta sent something we failed to
        // parse" have completely different causes — one is the Meta app's
        // configuration, the other is a bug here — and without this trail the
        // two are indistinguishable from the outside.
        if (payload !== null && typeof payload.type === 'string') {
          observedTypes.add(payload.type);
        }

        if (payload === null || payload.type !== 'WA_EMBEDDED_SIGNUP') {
          return;
        }

        // Recorded before anything is interpreted, so an outcome this build
        // does not recognise still leaves a trail.
        seenEvents.push(payload.event ?? 'UNNAMED');

        // Meta reports where it got to on every outcome. Held here because
        // `FB.login` fires afterwards with no idea any of this happened.
        lastStep = payload.data?.current_step ?? lastStep;

        if (payload.event !== undefined && FINISH_EVENTS.includes(payload.event)) {
          const wabaId = payload.data?.waba_id;
          if (wabaId !== undefined && wabaId !== '') {
            account = { wabaId, phoneNumberId: payload.data?.phone_number_id ?? '' };
          }
          return;
        }

        // A real, successful outcome that is nonetheless unusable: the account
        // exists but has no number on it, so there is nothing to register or
        // send from. Distinguished from a generic failure because the remedy is
        // specific and the admin is most of the way there.
        if (payload.event === 'FINISH_ONLY_WABA') {
          wabaOnly = true;
          return;
        }

        if (payload.event === 'CANCEL') {
          cancelled = true;
          return;
        }
        if (payload.event === 'ERROR') {
          metaError = payload.data?.error_message ?? 'Meta reported an error during signup.';
        }
      };

      window.addEventListener('message', onMessage);

      const done = (): void => window.removeEventListener('message', onMessage);

      sdk.login(
  (response) => {
    console.log('=== META FB.LOGIN RESPONSE ===');
    console.log(response);
    console.log('=== META CONFIG ===');
    console.log({
      appId: environment.meta.appId,
      configId: environment.meta.configId,
      graphVersion: environment.meta.graphVersion,
      signupFeatureType: environment.meta.signupFeatureType,
      signupVersion: environment.meta.signupVersion,
      origin: window.location.origin,
    });

    done();


          // An error Meta reported outranks the shape of the callback: without
          // this, a genuine failure is indistinguishable from a cancellation
          // and gets swallowed silently.
          const trail = [
            seenEvents.length === 0
              ? 'Meta sent no signup events.'
              : `Meta sent: ${seenEvents.join(' → ')}.`,
            rejectedOrigins.size === 0
              ? null
              : `Ignored messages from: ${[...rejectedOrigins].join(', ')}.`,
            observedTypes.size === 0
              ? 'No recognised signup messages arrived.'
              : `Message types seen: ${[...observedTypes].join(', ')}.`,
            allMessages.length === 0
              ? 'No window messages arrived at all — the signup flow never started.'
              : `${allMessages.length} window message(s): ${[...new Set(allMessages)].slice(0, 8).join(' | ')}.`,
          ]
            .filter((part): part is string => part !== null)
            .join(' ');

          if (metaError !== null) {
            reject(new EmbeddedSignupError(metaError, 'failed', lastStep, trail));
            return;
          }

          const code = response.authResponse?.code;
          if (code === undefined || code === '') {
            const where = describeMetaStep(lastStep);
            reject(
              new EmbeddedSignupError(
                where === null
                  ? 'Signup was closed before it finished.'
                  : `Signup was closed at ${where}.`,
                'cancelled',
                lastStep,
                trail,
              ),
            );
            return;
          }
          if (wabaOnly) {
            reject(
              new EmbeddedSignupError(
                'Your WhatsApp Business Account was created, but no phone number was added to it. Run signup again and add a number at the phone number step.',
                'failed',
                lastStep,
                trail,
              ),
            );
            return;
          }

          if (cancelled || account === null) {
            reject(
              new EmbeddedSignupError(
                seenEvents.length === 0
                  ? 'Meta signed you in and issued an authorisation, but never ran WhatsApp signup — so the dialog behaved as an ordinary Facebook login. The usual cause is that the configuration id does not belong to a WhatsApp Embedded Signup configuration, or belongs to a different Meta app than the app id.'
                  : 'Signup ended without returning a WhatsApp Business Account. Run it again and complete every step, including choosing a phone number.',
                'failed',
                lastStep,
                trail,
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
          // Exactly the extras Meta's console generates for this config id,
          // and nothing more. Keys are omitted rather than sent empty: a
          // `featureType: ''` alongside `features` is not a harmless default,
          // it is a contradictory instruction, and Meta answers it by running
          // an ordinary login instead of signup.
          extras: buildSignupExtras(),
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
          version: environment.meta.sdkVersion,
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
