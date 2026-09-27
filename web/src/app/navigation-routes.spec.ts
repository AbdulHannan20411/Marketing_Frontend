import type { Route } from '@angular/router';

import { NAVIGATION, SUPERADMIN_NAVIGATION } from '@core/config/navigation.config';
import { adminPortalGuard, superAdminPortalGuard } from '@core/guards/portal.guard';
import { routes } from './app.routes';

/**
 * Every link the sidebar offers has a route behind it, in the portal that offers it.
 *
 * This is the fourth time in this project that a link has pointed at nothing: the route table has
 * two portals with overlapping paths, the last entry is `**` → the landing guard, and a path
 * registered under only one of them **silently redirects to the dashboard** in the other. Nothing
 * throws, nothing logs, and it reads to the person clicking as the wrong link rather than a missing
 * route — which is how "Downloads opens the dashboard" was reported.
 *
 * Static on purpose: no guards, no HTTP, no shell. The question is only whether the path exists,
 * and a test that answers it in a millisecond is one that will still be run.
 */
describe('sidebar links resolve to routes', () => {
  /** Paths registered under the portal whose parent carries `guard`. */
  function pathsFor(guard: unknown): ReadonlySet<string> {
    const parents = routes.filter((route) => (route.canActivate ?? []).includes(guard as never));
    const paths = new Set<string>();

    const walk = (children: readonly Route[], prefix: string): void => {
      for (const child of children) {
        const path = [prefix, child.path].filter((part) => part !== undefined && part !== '').join('/');

        if (child.path !== undefined) {
          paths.add(path);
        }
        if (child.children !== undefined) {
          walk(child.children, path);
        }
      }
    };

    for (const parent of parents) {
      walk(parent.children ?? [], '');
    }

    return paths;
  }

  /** A nav route as a path: `/contacts` → `contacts`. */
  const asPath = (route: string): string => route.replace(/^\//, '');

  it('registers every workspace nav route under the workspace portal', () => {
    const registered = pathsFor(adminPortalGuard);

    const missing = NAVIGATION.flatMap((section) => section.items)
      .map((item) => asPath(item.route))
      .filter((path) => !registered.has(path));

    expect(missing).toEqual([]);
  });

  it('registers every platform nav route under the platform portal', () => {
    const registered = pathsFor(superAdminPortalGuard);

    const missing = SUPERADMIN_NAVIGATION.flatMap((section) => section.items)
      .map((item) => asPath(item.route))
      .filter((path) => !registered.has(path));

    expect(missing).toEqual([]);
  });

  it('offers the export centre to both portals', () => {
    // Named rather than left to the sweep above: Settings links to it as
    // "Downloads" and an export belongs to the person who asked for it, not to
    // the portal they happen to be in.
    expect(pathsFor(adminPortalGuard).has('exports')).toBeTrue();
    expect(pathsFor(superAdminPortalGuard).has('exports')).toBeTrue();
  });
});
