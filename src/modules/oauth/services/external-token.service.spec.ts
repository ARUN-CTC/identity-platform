import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { ExternalTokenError } from '../errors';
import { ExternalTokenService } from './external-token.service';
import { SigningKeyService } from './signing-key.service';

const ISSUER = 'https://identity.example.com';
const AUDIENCE = 'travel-api';

function configOf(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('ExternalTokenService', () => {
  let signingKeys: SigningKeyService;
  let service: ExternalTokenService;
  let signingPrivateKeyPem: string;
  let signingKid: string;

  beforeAll(() => {
    signingKeys = new SigningKeyService(configOf({ APP_ENV: 'development' }));
    signingKeys.onModuleInit();
    const active = signingKeys.getSigningKey();
    signingPrivateKeyPem = active.privateKeyPem;
    signingKid = active.kid;

    service = new ExternalTokenService(signingKeys, configOf({ OAUTH_ISSUER: ISSUER, OAUTH_AUDIENCE: AUDIENCE }));
  });

  describe('sign -> verify round-trip', () => {
    it('a freshly signed token verifies successfully and round-trips every claim', () => {
      const token = service.sign({ sub: 'user-123', scope: 'openid profile', client_id: 'app-1' });
      const claims = service.verify(token);

      expect(claims.sub).toBe('user-123');
      expect(claims.scope).toBe('openid profile');
      expect(claims.client_id).toBe('app-1');
      expect(claims.iss).toBe(ISSUER);
      expect(claims.aud).toBe(AUDIENCE);
      expect(claims.jti).toBeTruthy();
      expect(typeof claims.iat).toBe('number');
      expect(typeof claims.exp).toBe('number');
    });

    it('signs with the active kid in the header, and verify() resolves the correct public key by that kid', () => {
      const token = service.sign({ sub: 'user-123' });
      const decoded = jwt.decode(token, { complete: true });
      expect(decoded).not.toBeNull();
      expect((decoded as { header: { kid?: string } }).header.kid).toBe(signingKid);
    });

    it('honors an explicit per-call audience override', () => {
      const token = service.sign({ sub: 'user-123' }, { audience: 'health-api' });
      const claims = service.verify(token, 'health-api');
      expect(claims.aud).toBe('health-api');
    });
  });

  describe('security test matrix', () => {
    it('rejects a token signed with HS256 (wrong algorithm) even with a plausible-looking header', () => {
      const forged = jwt.sign({ sub: 'attacker' }, 'some-arbitrary-secret', { algorithm: 'HS256', keyid: signingKid, issuer: ISSUER, audience: AUDIENCE });
      expect(() => service.verify(forged)).toThrow(ExternalTokenError);
      try {
        service.verify(forged);
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('invalid_algorithm');
      }
    });

    it('rejects alg=none', () => {
      // jsonwebtoken requires an explicit opt-in even to construct an alg=none token.
      const forged = jwt.sign({ sub: 'attacker' }, '', { algorithm: 'none' });
      expect(() => service.verify(forged)).toThrow(ExternalTokenError);
      try {
        service.verify(forged);
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('invalid_algorithm');
      }
    });

    it('rejects RS384/RS512 (unsupported, even though cryptographically valid for the same RSA key)', () => {
      const forgedRs384 = jwt.sign({ sub: 'x' }, signingPrivateKeyPem, { algorithm: 'RS384', keyid: signingKid, issuer: ISSUER, audience: AUDIENCE });
      try {
        service.verify(forgedRs384);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('invalid_algorithm');
      }
    });

    it('rejects the wrong audience', () => {
      const token = service.sign({ sub: 'user-123' });
      try {
        service.verify(token, 'a-completely-different-api');
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('invalid_audience');
      }
    });

    it('rejects the wrong issuer', () => {
      const forged = jwt.sign({ sub: 'x' }, signingPrivateKeyPem, {
        algorithm: 'RS256',
        keyid: signingKid,
        issuer: 'https://not-this-platform.example.com',
        audience: AUDIENCE,
      });
      try {
        service.verify(forged);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('invalid_issuer');
      }
    });

    it('rejects an unrecognized kid', () => {
      const forged = jwt.sign({ sub: 'x' }, signingPrivateKeyPem, { algorithm: 'RS256', keyid: 'some-unknown-kid', issuer: ISSUER, audience: AUDIENCE });
      try {
        service.verify(forged);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('unknown_kid');
      }
    });

    it('rejects a token with no kid at all', () => {
      const forged = jwt.sign({ sub: 'x' }, signingPrivateKeyPem, { algorithm: 'RS256', issuer: ISSUER, audience: AUDIENCE });
      try {
        service.verify(forged);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('unknown_kid');
      }
    });

    it('rejects an expired token', () => {
      const forged = jwt.sign({ sub: 'x', iat: Math.floor(Date.now() / 1000) - 1000 }, signingPrivateKeyPem, {
        algorithm: 'RS256',
        keyid: signingKid,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: 1,
      });
      try {
        service.verify(forged);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('expired_token');
      }
    });

    it('rejects a not-yet-valid token (nbf in the future)', () => {
      const forged = jwt.sign({ sub: 'x' }, signingPrivateKeyPem, {
        algorithm: 'RS256',
        keyid: signingKid,
        issuer: ISSUER,
        audience: AUDIENCE,
        notBefore: '1h',
      });
      try {
        service.verify(forged);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('not_yet_valid');
      }
    });

    it('rejects a token with a tampered signature', () => {
      const token = service.sign({ sub: 'user-123' });
      const tampered = token.slice(0, -4) + 'abcd';
      try {
        service.verify(tampered);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toMatch(/invalid_(signature|token)/);
      }
    });

    it('rejects a token whose sub claim was tampered with after signing (payload modified without re-signing)', () => {
      const token = service.sign({ sub: 'user-123' });
      const [headerB64, payloadB64, sigB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      payload.sub = 'attacker-controlled-id';
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${sigB64}`;
      try {
        service.verify(tamperedToken);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('invalid_signature');
      }
    });

    it('rejects a token whose tenant_id/organization_id claims were tampered with after signing', () => {
      const token = service.sign({ sub: 'user-123', tenant_id: 'tenant-a', organization_id: 'org-a' });
      const [headerB64, payloadB64, sigB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      payload.tenant_id = 'tenant-b';
      payload.organization_id = 'org-b';
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${sigB64}`;
      try {
        service.verify(tamperedToken);
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('invalid_signature');
      }
    });

    it('rejects a malformed token', () => {
      try {
        service.verify('not-a-jwt-at-all');
        fail('expected rejection');
      } catch (e) {
        expect((e as ExternalTokenError).code).toBe('invalid_token');
      }
    });
  });
});
