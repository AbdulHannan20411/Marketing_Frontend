import { isStaleChunkError, shouldReloadFor } from './stale-chunk-recovery';

describe('stale page file recovery', () => {
  beforeEach(() => sessionStorage.removeItem('vd.chunk-reload'));

  it('recognises every browser’s failed dynamic import', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: http://x/chunk-A.js'))).toBeTrue();
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBeTrue();
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBeTrue();
    expect(isStaleChunkError(new Error('Loading chunk 42 failed.'))).toBeTrue();
  });

  it('leaves every other navigation failure alone', () => {
    expect(isStaleChunkError(new Error('NG04002: Cannot match any routes'))).toBeFalse();
    expect(shouldReloadFor(new Error('guard threw'), '/superadmin/security', sessionStorage)).toBeFalse();
  });

  it('reloads once for a URL, not in a loop', () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /chunk-A.js');
    expect(shouldReloadFor(error, '/superadmin/security', sessionStorage, 1_000)).toBeTrue();
    expect(shouldReloadFor(error, '/superadmin/security', sessionStorage, 5_000)).toBeFalse();
    // A different page, or the same one much later, may reload again.
    expect(shouldReloadFor(error, '/superadmin/audit', sessionStorage, 6_000)).toBeTrue();
    expect(shouldReloadFor(error, '/superadmin/security', sessionStorage, 60_000)).toBeTrue();
  });
});
