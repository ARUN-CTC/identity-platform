import { Application } from '@prisma/client';
import { AppException } from '../../../common';
import { RedirectUriPolicy, validateRedirectUriFormat } from './redirect-uri.policy';

function appWith(redirectUris: string[]): Pick<Application, 'redirectUris'> {
  return { redirectUris };
}

describe('RedirectUriPolicy', () => {
  const policy = new RedirectUriPolicy();
  const REGISTERED = 'https://app.travelos.com/callback';

  describe('isRedirectUriAllowed (runtime check) — exact match only', () => {
    it('PASS: the exact registered URI', () => {
      expect(policy.isRedirectUriAllowed(appWith([REGISTERED]), REGISTERED)).toBe(true);
    });

    it('DENY: an unregistered URI', () => {
      expect(policy.isRedirectUriAllowed(appWith([REGISTERED]), 'https://evil.com/callback')).toBe(false);
    });

    it('DENY: a similar-looking URI (trailing slash difference)', () => {
      expect(policy.isRedirectUriAllowed(appWith([REGISTERED]), `${REGISTERED}/`)).toBe(false);
    });

    it('DENY: prefix attack (registered URI as a prefix of the attacker URI)', () => {
      expect(policy.isRedirectUriAllowed(appWith([REGISTERED]), `${REGISTERED}.evil.com`)).toBe(false);
    });

    it('DENY: suffix/path-appended attack', () => {
      expect(policy.isRedirectUriAllowed(appWith([REGISTERED]), `${REGISTERED}/../admin`)).toBe(false);
    });

    it('DENY: subdomain attack', () => {
      expect(policy.isRedirectUriAllowed(appWith(['https://app.travelos.com/callback']), 'https://evil.app.travelos.com/callback')).toBe(false);
    });

    it('DENY: fragment appended to an otherwise-registered URI', () => {
      expect(policy.isRedirectUriAllowed(appWith([REGISTERED]), `${REGISTERED}#evil`)).toBe(false);
    });

    it('DENY: case-different host (exact string match is case-sensitive by design)', () => {
      expect(policy.isRedirectUriAllowed(appWith([REGISTERED]), REGISTERED.replace('app', 'APP'))).toBe(false);
    });
  });

  describe('validateRedirectUriFormat — registration-time format rules', () => {
    it('accepts a well-formed HTTPS URI', () => {
      expect(() => validateRedirectUriFormat('https://app.travelos.com/callback')).not.toThrow();
    });

    it('accepts http://localhost for development', () => {
      expect(() => validateRedirectUriFormat('http://localhost:5173/callback')).not.toThrow();
      expect(() => validateRedirectUriFormat('http://127.0.0.1:5173/callback')).not.toThrow();
    });

    it('rejects http:// for a non-loopback host', () => {
      expect(() => validateRedirectUriFormat('http://app.travelos.com/callback')).toThrow(AppException);
    });

    it('accepts a custom mobile/native scheme', () => {
      expect(() => validateRedirectUriFormat('com.travelos.app://callback')).not.toThrow();
    });

    it('rejects a wildcard redirect URI', () => {
      expect(() => validateRedirectUriFormat('https://*.travelos.com/callback')).toThrow(AppException);
    });

    it('rejects a URI containing a fragment', () => {
      expect(() => validateRedirectUriFormat('https://app.travelos.com/callback#token')).toThrow(AppException);
    });

    it('rejects a malformed/relative URI', () => {
      expect(() => validateRedirectUriFormat('/callback')).toThrow(AppException);
      expect(() => validateRedirectUriFormat('not-a-url')).toThrow(AppException);
    });

    it('rejects userinfo embedded in the URI', () => {
      expect(() => validateRedirectUriFormat('https://user:pass@app.travelos.com/callback')).toThrow(AppException);
    });
  });

  describe('validateRedirectUrisForRegistration', () => {
    it('rejects duplicate redirect URIs', () => {
      expect(() => policy.validateRedirectUrisForRegistration(['https://app.travelos.com/callback', 'https://app.travelos.com/callback'])).toThrow(AppException);
    });

    it('accepts multiple distinct, well-formed URIs', () => {
      expect(() => policy.validateRedirectUrisForRegistration(['https://app.travelos.com/callback', 'com.travelos.app://callback'])).not.toThrow();
    });
  });
});
