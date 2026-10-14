/**
 * The access token is persisted in sessionStorage so a page reload restores the
 * session without an extra /auth/refresh round-trip. An in-memory cache fronts
 * it to avoid a storage read on every request. sessionStorage (not localStorage)
 * limits exposure: it is cleared when the tab closes and never written to disk.
 *
 * Trade-off: unlike a purely in-memory token, this is readable by injected
 * script while the tab is open — an accepted decision (see the design spec).
 */
const STORAGE_KEY = 'accessToken';

let cached: string | null = null;

export function getAccessToken(): string | null {
  if (cached !== null) {
    return cached;
  }
  cached = sessionStorage.getItem(STORAGE_KEY);
  return cached;
}

export function setAccessToken(token: string | null): void {
  cached = token;
  if (token === null) {
    sessionStorage.removeItem(STORAGE_KEY);
  } else {
    sessionStorage.setItem(STORAGE_KEY, token);
  }
}
