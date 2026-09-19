import { Injectable, inject } from '@angular/core';

import { SessionSecurityService } from './session-security.service';

const INTERVAL_MS = 60_000;

/**
 * Tells the API this session is still in use, about once a minute.
 *
 * It is also how a displaced tab finds out: once another sign-in has ended
 * this session, the next heartbeat answers 401 with `X-Session-Revoked`, and
 * the token interceptor signs the user out with the reason. So it keeps running
 * in a background tab — the browser throttles timers to about once a minute
 * there anyway, which is exactly the rate wanted.
 *
 * Failures are ignored: a missed heartbeat only makes the device look idle for
 * a minute, and the revoked case is handled by the interceptor, not here.
 */
@Injectable({ providedIn: 'root' })
export class SessionHeartbeatService {
  private readonly security = inject(SessionSecurityService);
  private handle: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.handle !== null) {
      return;
    }
    this.beat();
    this.handle = setInterval(() => this.beat(), INTERVAL_MS);
  }

  stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  private beat(): void {
    this.security.heartbeat().subscribe({ error: () => undefined });
  }
}
