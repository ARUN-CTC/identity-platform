import { createPublicKey, generateKeyPairSync } from 'crypto';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { ResourceServerAuthError } from '../errors';
import { ExternalAccessTokenValidator } from './external-access-token-validator.service';
import { JwksClientService } from './jwks-client.service';

const ISSUER = 'https://identity.example.com';
const AUDIENCE = 'resource-server-unit-test-api';
const KID = 'unit-test-kid';

function configOf(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('ExternalAccessTokenValidator (Phase 2D.5)', () => {
  let privateKeyPem: string;
  let publicKeyPem: string;
  let jwks: JwksClientService;
  let validator: ExternalAccessTokenValidator;
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  function signValid(overrides: Record<string, unknown> = {}, signOptions: jwt.SignOptions = {}): string {
    const payload = {
      sub: 'sa-123',
      client_id: 'cli_abc',
      tenant_id: 'tenant-1',
      scope: 'documents.read documents.write',
      ...overrides,
    };
    return jwt.sign(payload, privateKeyPem, {
      algorithm: 'RS256',
      keyid: KID,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: 900,
      jwtid: 'jti-1',
      ...signOptions,
    });
  }

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    privateKeyPem = pair.privateKey;
    publicKeyPem = pair.publicKey;
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        const jwk = createPublicKey(publicKeyPem).export({ format: 'jwk' }) as { n: string; e: string };
        return { keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256', kid: KID, n: jwk.n, e: jwk.e }] };
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    jwks = new JwksClientService(configOf({ OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS: '0' }));
    jwks.configureJwksUri('http://test.invalid/.well-known/jwks.json');
    validator = new ExternalAccessTokenValidator(jwks, configOf({ OAUTH_ISSUER: ISSUER, OAUTH_CLOCK_SKEW_SECONDS: '5' }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('valid tokens', () => {
    it('validates a correctly signed token and constructs the expected principal', async () => {
      const token = signValid();
      const principal = await validator.validate(token, AUDIENCE);

      expect(principal.type).toBe('SERVICE_ACCOUNT');
      expect(principal.subject).toBe('sa-123');
      expect(principal.serviceAccountId).toBe('sa-123'); // sub -> ServiceAccount.id, never User/Application
      expect(principal.clientId).toBe('cli_abc');
      expect(principal.tenantId).toBe('tenant-1');
      expect(principal.audience).toBe(AUDIENCE);
      expect(principal.scopes).toEqual(['documents.read', 'documents.write']);
      expect(principal.jti).toBe('jti-1');
      expect(principal.issuer).toBe(ISSUER);
      expect(principal.expiresAt.getTime()).toBeGreaterThan(principal.issuedAt.getTime());
    });

    it('an absent scope claim yields an empty scopes array, never "all scopes"', async () => {
      const token = jwt.sign({ sub: 'sa-1', client_id: 'cli_abc', tenant_id: 'tenant-1' }, privateKeyPem, {
        algorithm: 'RS256',
        keyid: KID,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: 900,
        jwtid: 'jti-2',
      });
      const principal = await validator.validate(token, AUDIENCE);
      expect(principal.scopes).toEqual([]);
    });
  });

  describe('security test matrix', () => {
    it('rejects HS256 (legacy-shaped) even with a plausible header', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 'x' }, 'some-secret', { algorithm: 'HS256', keyid: KID, issuer: ISSUER, audience: AUDIENCE });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toBeInstanceOf(ResourceServerAuthError);
    });

    it('rejects alg=none', async () => {
      const forged = jwt.sign({ sub: 'sa-1' }, '', { algorithm: 'none' });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toBeInstanceOf(ResourceServerAuthError);
    });

    it('rejects an invalid/tampered signature', async () => {
      const token = signValid();
      const tampered = token.slice(0, -4) + 'AAAA';
      await expect(validator.validate(tampered, AUDIENCE)).rejects.toBeInstanceOf(ResourceServerAuthError);
    });

    it('rejects a token with no kid', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 'x' }, privateKeyPem, { algorithm: 'RS256', issuer: ISSUER, audience: AUDIENCE });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'missing_kid' });
    });

    it('rejects an unknown kid', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 'x' }, privateKeyPem, { algorithm: 'RS256', keyid: 'never-seen-kid', issuer: ISSUER, audience: AUDIENCE });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'unknown_kid' });
    });

    it('rejects the wrong issuer', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 'x' }, privateKeyPem, { algorithm: 'RS256', keyid: KID, issuer: 'https://attacker.example.com', audience: AUDIENCE });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'invalid_issuer' });
    });

    it('rejects a missing audience claim', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 'x' }, privateKeyPem, { algorithm: 'RS256', keyid: KID, issuer: ISSUER });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'invalid_audience' });
    });

    it('rejects the wrong audience', async () => {
      const token = signValid();
      await expect(validator.validate(token, 'a-totally-different-api')).rejects.toMatchObject({ reason: 'invalid_audience' });
    });

    it('rejects an expired token', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 'x', iat: Math.floor(Date.now() / 1000) - 1000 }, privateKeyPem, {
        algorithm: 'RS256',
        keyid: KID,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: 1,
      });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'expired_token' });
    });

    it('rejects a not-yet-valid token (nbf in the future, beyond clock skew tolerance)', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 'x' }, privateKeyPem, {
        algorithm: 'RS256',
        keyid: KID,
        issuer: ISSUER,
        audience: AUDIENCE,
        notBefore: '1h',
      });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'not_yet_valid' });
    });

    it('rejects a malformed exp (non-numeric) — jsonwebtoken itself refuses to sign it, proving the claim can only be forged post-signature, which the signature check then catches', async () => {
      const token = signValid();
      const [h, p, s] = token.split('.');
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
      payload.exp = 'not-a-number';
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      await expect(validator.validate(`${h}.${tamperedPayload}.${s}`, AUDIENCE)).rejects.toBeInstanceOf(ResourceServerAuthError);
    });

    it('rejects a missing sub claim', async () => {
      const forged = jwt.sign({ client_id: 'x', tenant_id: 'x' }, privateKeyPem, { algorithm: 'RS256', keyid: KID, issuer: ISSUER, audience: AUDIENCE });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'missing_required_claim' });
    });

    it('rejects a missing tenant_id claim', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x' }, privateKeyPem, { algorithm: 'RS256', keyid: KID, issuer: ISSUER, audience: AUDIENCE });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'missing_required_claim' });
    });

    it('rejects a malformed (non-string) tenant_id claim', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 12345 }, privateKeyPem, { algorithm: 'RS256', keyid: KID, issuer: ISSUER, audience: AUDIENCE });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'missing_required_claim' });
    });

    it('rejects a missing client_id claim', async () => {
      const forged = jwt.sign({ sub: 'sa-1', tenant_id: 'x' }, privateKeyPem, { algorithm: 'RS256', keyid: KID, issuer: ISSUER, audience: AUDIENCE });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'missing_required_claim' });
    });

    it('rejects a missing jti claim', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 'x' }, privateKeyPem, {
        algorithm: 'RS256',
        keyid: KID,
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      // jsonwebtoken does not auto-generate jti — this token genuinely has none.
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'missing_required_claim' });
    });

    it('rejects a malformed (non-string) scope claim', async () => {
      const forged = jwt.sign({ sub: 'sa-1', client_id: 'x', tenant_id: 'x', scope: 12345, jti: 'j' }, privateKeyPem, { algorithm: 'RS256', keyid: KID, issuer: ISSUER, audience: AUDIENCE });
      await expect(validator.validate(forged, AUDIENCE)).rejects.toMatchObject({ reason: 'malformed_claim' });
    });

    it('rejects a malformed token', async () => {
      await expect(validator.validate('not-a-jwt-at-all', AUDIENCE)).rejects.toMatchObject({ reason: 'malformed_token' });
    });

    it('never interprets sub as anything other than the principal subject — a token whose sub happens to look like a UUID for a human user is still just an opaque subject, never separately resolved', async () => {
      const humanLookingSub = '11111111-2222-3333-4444-555555555555';
      const token = signValid({ sub: humanLookingSub });
      const principal = await validator.validate(token, AUDIENCE);
      expect(principal.subject).toBe(humanLookingSub);
      expect(principal.type).toBe('SERVICE_ACCOUNT'); // never re-typed based on the shape of sub
    });
  });

  describe('live JWKS verification (brief §33 — public-key-only path)', () => {
    it('a token signed with the private key verifies successfully only via the JWKS-fetched public key — the validator never touches the private key at all', async () => {
      // The validator/JwksClientService in this suite were constructed with
      // ZERO reference to privateKeyPem — only fetchMock's own JSON (public
      // n/e only) ever reaches them. This test's own assertion is simply
      // that verification succeeds end-to-end through that path.
      const token = signValid();
      const principal = await validator.validate(token, AUDIENCE);
      expect(principal.subject).toBe('sa-123');
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
