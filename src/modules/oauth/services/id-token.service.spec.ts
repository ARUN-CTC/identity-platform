import { createPublicKey } from 'crypto';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { ExternalTokenService } from './external-token.service';
import { IdTokenService } from './id-token.service';
import { SigningKeyService } from './signing-key.service';

const ISSUER = 'https://identity.example.com';

function configOf(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('IdTokenService (Phase 2D.8)', () => {
  let signingKeys: SigningKeyService;
  let externalTokens: ExternalTokenService;
  let service: IdTokenService;
  let signingKid: string;
  let publicKeyPem: string;

  beforeAll(() => {
    signingKeys = new SigningKeyService(configOf({ APP_ENV: 'development' }));
    signingKeys.onModuleInit();
    const active = signingKeys.getSigningKey();
    signingKid = active.kid;
    publicKeyPem = createPublicKey(active.privateKeyPem).export({ type: 'spki', format: 'pem' }) as string;

    externalTokens = new ExternalTokenService(signingKeys, configOf({ OAUTH_ISSUER: ISSUER, OAUTH_AUDIENCE: 'irrelevant-default-audience' }));
    service = new IdTokenService(signingKeys, externalTokens, configOf({ OAUTH_ISSUER: ISSUER }));
  });

  it('signs an RS256 ID Token, verifiable with the corresponding public key', () => {
    const token = service.sign({ sub: 'user-123', aud: 'client-abc', nonce: 'nonce-xyz' });

    const decoded = jwt.decode(token, { complete: true })!;
    expect(decoded.header.alg).toBe('RS256');
    expect(decoded.header.kid).toBe(signingKid);

    const verified = jwt.verify(token, publicKeyPem, { algorithms: ['RS256'], issuer: ISSUER, audience: 'client-abc' }) as jwt.JwtPayload;
    expect(verified.sub).toBe('user-123');
    expect(verified.aud).toBe('client-abc');
    expect(verified.nonce).toBe('nonce-xyz');
    expect(verified.iss).toBe(ISSUER);
    expect(verified.token_use).toBe('id_token');
    expect(typeof verified.iat).toBe('number');
    expect(typeof verified.exp).toBe('number');
  });

  it('never includes tenant_id, jti, scope, or client_id (Access-Token-only claims) on the ID Token', () => {
    const token = service.sign({ sub: 'user-123', aud: 'client-abc', nonce: 'nonce-xyz' });
    const claims = jwt.decode(token) as Record<string, unknown>;
    expect(claims.tenant_id).toBeUndefined();
    expect(claims.jti).toBeUndefined();
    expect(claims.scope).toBeUndefined();
    expect(claims.client_id).toBeUndefined();
  });

  it('rejects verification against the WRONG audience (aud = client_id, never a resource audience)', () => {
    const token = service.sign({ sub: 'user-123', aud: 'client-abc', nonce: 'nonce-xyz' });
    expect(() => jwt.verify(token, publicKeyPem, { algorithms: ['RS256'], issuer: ISSUER, audience: 'some-resource-api' })).toThrow();
  });

  it('carries optional user claims only when explicitly provided (no fabrication)', () => {
    const token = service.sign({ sub: 'user-123', aud: 'client-abc', nonce: 'nonce-xyz', email: 'a@example.com', email_verified: true });
    const claims = jwt.decode(token) as Record<string, unknown>;
    expect(claims.email).toBe('a@example.com');
    expect(claims.email_verified).toBe(true);
    expect(claims.name).toBeUndefined();
  });

  it('uses the same signing key infrastructure (kid/JWKS) as ExternalTokenService — no duplicated key management', () => {
    const accessToken = externalTokens.sign({ sub: 'sa-1' });
    const idToken = service.sign({ sub: 'user-123', aud: 'client-abc', nonce: 'n' });
    const accessHeader = jwt.decode(accessToken, { complete: true })!.header;
    const idHeader = jwt.decode(idToken, { complete: true })!.header;
    expect(idHeader.kid).toBe(accessHeader.kid);
  });
});
