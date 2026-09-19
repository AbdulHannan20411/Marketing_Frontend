import type { NavigationError } from '@angular/router';

/**
 * Recovers from a page that can no longer be downloaded.
 *
 * Each lazy page is a file whose name changes on every build. A tab opened
 * before a rebuild — or before a deploy, in production — still asks for the old
 * name, the server answers 404, and the router drops the navigation without a
 * word: the user clicks a sidebar item and nothing happens. Reloading the page
 * at the URL they asked for fetches the current build and lands them there.
 *
 * Reloads at most once per URL in a short window, so a file that is genuinely
 * missing shows the router's normal failure instead of looping.
 */

const RELOAD_KEY = 'vd.chunk-reload';
const LOOP_WINDOW_MS = 15_000;

/** The wording each browser uses when a dynamic `import()` fails to fetch. */
const STALE_CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /loading chunk [\w-]+ failed/i, // webpack builds
];

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message));
}

interface ReloadMark {
  readonly url: string;
  readonly at: number;
}

function readMark(storage: Storage): ReloadMark | null {
  try {
    const raw = storage.getItem(RELOAD_KEY);
    return raw === null ? null : (JSON.parse(raw) as ReloadMark);
  } catch {
    return null;
  }
}

/**
 * Whether to reload for this failed navigation, and records it if so.
 * Split from the handler so it can be tested without reloading anything.
 */
export function shouldReloadFor(error: unknown, url: string, storage: Storage, now = Date.now()): boolean {
  if (!isStaleChunkError(error)) {
    return false;
  }
  const last = readMark(storage);
  if (last !== null && last.url === url && now - last.at < LOOP_WINDOW_MS) {
    return false;
  }
  try {
    storage.setItem(RELOAD_KEY, JSON.stringify({ url, at: now } satisfies ReloadMark));
  } catch {
    // Without storage there is no loop guard, so do not risk the reload.
    return false;
  }
  return true;
}

/** For `withNavigationErrorHandler`: a full page load to the page that failed. */
export function recoverFromStaleChunk(event: NavigationError): void {
  if (shouldReloadFor(event.error, event.url, sessionStorage)) {
    window.location.assign(event.url);
  }
}
