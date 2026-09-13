import { parseCorsAllowedOrigins } from './cors.config';

describe('parseCorsAllowedOrigins (Phase 2D.11)', () => {
  it('returns undefined when unset — reflect-any-origin, the local-development default', () => {
    expect(parseCorsAllowedOrigins(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseCorsAllowedOrigins('')).toBeUndefined();
  });

  it('parses a single origin', () => {
    expect(parseCorsAllowedOrigins('https://app.travelos.com')).toEqual(['https://app.travelos.com']);
  });

  it('parses a comma-separated list, trimming whitespace', () => {
    expect(parseCorsAllowedOrigins('https://app.travelos.com, https://app.healthcare.example.com ,https://gym.example.com')).toEqual([
      'https://app.travelos.com',
      'https://app.healthcare.example.com',
      'https://gym.example.com',
    ]);
  });

  it('drops empty entries from a trailing/stray comma', () => {
    expect(parseCorsAllowedOrigins('https://app.travelos.com,,')).toEqual(['https://app.travelos.com']);
  });
});
