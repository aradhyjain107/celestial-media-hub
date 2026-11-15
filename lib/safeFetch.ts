/**
 * Safe fetch utility that falls back to pristine browser native fetch if
 * a browser extension (such as BlockSite, ad-blockers, or content blockers)
 * has corrupted or monkey-patched window.fetch in the global scope.
 */
export function getSafeFetch(): typeof fetch {
  if (typeof window === 'undefined') {
    return fetch;
  }
  if (typeof (window as any).__nativeFetch === 'function') {
    return (window as any).__nativeFetch;
  }
  return window.fetch.bind(window);
}

export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const fetchFn = getSafeFetch();
  return fetchFn(input, init);
}
