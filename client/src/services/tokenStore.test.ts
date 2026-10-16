import { afterEach, describe, expect, it } from 'vitest';
import { getAccessToken, setAccessToken } from './tokenStore';

afterEach(() => {
  setAccessToken(null);
  sessionStorage.clear();
});

describe('tokenStore', () => {
  it('persists the token to sessionStorage', () => {
    setAccessToken('tok-123');
    expect(getAccessToken()).toBe('tok-123');
    expect(sessionStorage.getItem('accessToken')).toBe('tok-123');
  });

  it('clears the token from sessionStorage when set to null', () => {
    setAccessToken('tok-123');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
    expect(sessionStorage.getItem('accessToken')).toBeNull();
  });

  it('reads a token that already exists in sessionStorage (survives a reload)', () => {
    sessionStorage.setItem('accessToken', 'from-storage');
    // A fresh read (simulating a reload where the in-memory cache is empty) must
    // fall back to sessionStorage.
    expect(getAccessToken()).toBe('from-storage');
  });
});
