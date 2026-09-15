import { generateKeyPairSync } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SigningKeyService } from './signing-key.service';

function configOf(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('SigningKeyService', () => {
  describe('local development — no OAUTH_PRIVATE_KEY configured', () => {
    let service: SigningKeyService;

    beforeAll(() => {
      service = new SigningKeyService(configOf({ APP_ENV: 'development' }));
      service.onModuleInit();
    });

    it('generates an RSA keypair and a usable signing key', () => {
      const { kid, privateKeyPem } = service.getSigningKey();
      expect(kid).toBeTruthy();
      expect(privateKeyPem).toContain('BEGIN PRIVATE KEY');
    });

    it('derives the public key and exposes it by kid', () => {
      const { kid } = service.getSigningKey();
      const publicKeyPem = service.getPublicKeyForKid(kid);
      expect(publicKeyPem).toContain('BEGIN PUBLIC KEY');
    });

    it('produces a JWKS response containing only public fields', () => {
      const jwks = service.getJwks();
      expect(jwks.keys).toHaveLength(1);
      const [key] = jwks.keys;
      expect(key.kty).toBe('RSA');
      expect(key.use).toBe('sig');
      expect(key.alg).toBe('RS256');
      expect(key.kid).toBeTruthy();
      expect(typeof key.n).toBe('string');
      expect(key.n.length).toBeGreaterThan(0);
      expect(key.e).toBe('AQAB');
      // Private-key fields must be structurally absent, not merely unset.
      expect('d' in key).toBe(false);
      expect('p' in key).toBe(false);
      expect('q' in key).toBe(false);
      expect('dp' in key).toBe(false);
      expect('dq' in key).toBe(false);
      expect('qi' in key).toBe(false);
      expect(JSON.stringify(jwks)).not.toMatch(/BEGIN (RSA )?PRIVATE KEY/);
    });

    it('returns null, not a throw, for an unrecognized kid', () => {
      expect(service.getPublicKeyForKid('nonexistent-kid')).toBeNull();
    });
  });

  describe('production with no OAUTH_PRIVATE_KEY configured', () => {
    it('fails closed at startup rather than generating an insecure fallback key', () => {
      const service = new SigningKeyService(configOf({ APP_ENV: 'production' }));
      expect(() => service.onModuleInit()).toThrow(/OAUTH_PRIVATE_KEY is not configured/);
    });
  });

  describe('explicit OAUTH_PRIVATE_KEY configured', () => {
    it('loads the configured key and derives a stable kid from its fingerprint when OAUTH_KEY_ID is unset', () => {
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      // Simulate the single-line, \n-escaped env-var convention.
      const escaped = privateKey.replace(/\n/g, '\\n');

      const serviceA = new SigningKeyService(configOf({ APP_ENV: 'production', OAUTH_PRIVATE_KEY: escaped }));
      serviceA.onModuleInit();
      const serviceB = new SigningKeyService(configOf({ APP_ENV: 'production', OAUTH_PRIVATE_KEY: escaped }));
      serviceB.onModuleInit();

      // Same key material -> same derived kid, deterministically, across instances.
      expect(serviceA.getSigningKey().kid).toBe(serviceB.getSigningKey().kid);
    });

    it('uses OAUTH_KEY_ID verbatim when explicitly configured', () => {
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const service = new SigningKeyService(
        configOf({ APP_ENV: 'production', OAUTH_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'), OAUTH_KEY_ID: 'my-explicit-kid' }),
      );
      service.onModuleInit();
      expect(service.getSigningKey().kid).toBe('my-explicit-kid');
    });
  });

  describe('retired public keys — verification only, never signing', () => {
    it('loads OAUTH_RETIRED_PUBLIC_KEYS and exposes them in JWKS and via getPublicKeyForKid, but never as the active signing key', () => {
      const retired = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const retiredEntry = { kid: 'retired-key-1', publicKey: retired.publicKey.replace(/\n/g, '\\n') };

      const service = new SigningKeyService(
        configOf({ APP_ENV: 'development', OAUTH_RETIRED_PUBLIC_KEYS: JSON.stringify([retiredEntry]) }),
      );
      service.onModuleInit();

      // Verification-visible.
      expect(service.getPublicKeyForKid('retired-key-1')).toContain('BEGIN PUBLIC KEY');
      const jwks = service.getJwks();
      expect(jwks.keys.map((k) => k.kid)).toContain('retired-key-1');

      // Never becomes the active signing key.
      expect(service.getSigningKey().kid).not.toBe('retired-key-1');
    });

    it('ignores malformed OAUTH_RETIRED_PUBLIC_KEYS without failing startup', () => {
      const service = new SigningKeyService(configOf({ APP_ENV: 'development', OAUTH_RETIRED_PUBLIC_KEYS: 'not json' }));
      expect(() => service.onModuleInit()).not.toThrow();
      // Only the freshly-generated dev key is present.
      expect(service.getJwks().keys).toHaveLength(1);
    });
  });
});
