import { describe, it, expect } from 'vitest';
import { rateLimitMessage } from '../src/api.js';

describe('rate limiting', () => {
  // A parallel sweep over the catalogue got this back on every call, and a
  // script that read it as "no data" reported an empty catalogue.
  it('recognises the API throttling message', () => {
    const message = rateLimitMessage('Access temporarily restricted. Please try again later.');
    expect(message).toMatch(/too many requests/);
    expect(message).toMatch(/one request at a time/);
    expect(message).toMatch(/Access temporarily restricted/);
  });

  it('matches the other wordings', () => {
    expect(rateLimitMessage('Too many requests')).toBeTruthy();
    expect(rateLimitMessage('rate limit exceeded')).toBeTruthy();
  });

  it('leaves unrelated errors alone', () => {
    expect(rateLimitMessage('Authentication failed')).toBeNull();
    expect(rateLimitMessage(undefined)).toBeNull();
  });
});
