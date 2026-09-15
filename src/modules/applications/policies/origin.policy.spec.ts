import { Application } from '@prisma/client';
import { AppException } from '../../../common';
import { OriginPolicy, validateOriginFormat } from './origin.policy';

function appWith(allowedOrigins: string[]): Pick<Application, 'allowedOrigins'> {
  return { allowedOrigins };
}

describe('OriginPolicy', () => {
  const policy = new OriginPolicy();

  describe('isOriginAllowed (runtime check)', () => {
    it('PASS: a registered origin', () => {
      expect(policy.isOriginAllowed(appWith(['https://app.travelos.com']), 'https://app.travelos.com')).toBe(true);
    });

    it('DENY: an unregistered origin', () => {
      expect(policy.isOriginAllowed(appWith(['https://app.travelos.com']), 'https://evil.com')).toBe(false);
    });

    it('DENY: nothing allowed by default', () => {
      expect(policy.isOriginAllowed(appWith([]), 'https://app.travelos.com')).toBe(false);
    });
  });

  describe('validateOriginFormat', () => {
    it('accepts a well-formed HTTPS origin', () => {
      expect(() => validateOriginFormat('https://app.travelos.com')).not.toThrow();
    });

    it('accepts http://localhost for development', () => {
      expect(() => validateOriginFormat('http://localhost:5173')).not.toThrow();
    });

    it('rejects http:// for a non-loopback host', () => {
      expect(() => validateOriginFormat('http://app.travelos.com')).toThrow(AppException);
    });

    it("rejects '*'", () => {
      expect(() => validateOriginFormat('*')).toThrow(AppException);
    });

    it('rejects an origin with a path', () => {
      expect(() => validateOriginFormat('https://app.travelos.com/some/path')).toThrow(AppException);
    });

    it('rejects an origin with a query string', () => {
      expect(() => validateOriginFormat('https://app.travelos.com?x=1')).toThrow(AppException);
    });

    it('rejects a malformed origin', () => {
      expect(() => validateOriginFormat('not-an-origin')).toThrow(AppException);
    });
  });

  describe('validateOriginsForRegistration', () => {
    it('rejects duplicates', () => {
      expect(() => policy.validateOriginsForRegistration(['https://app.travelos.com', 'https://app.travelos.com'])).toThrow(AppException);
    });
  });
});
