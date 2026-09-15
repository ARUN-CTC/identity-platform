import { createPublicKey, generateKeyPairSync } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwksClientService } from './jwks-client.service';

function configOf(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function jwkFor(kid: string, publicKeyPem: string) {
  const jwk = createPublicKey(publicKeyPem).export({ format: 'jwk' }) as { n: string; e: string };
  return { kty: 'RSA', use: 'sig', alg: 'RS256', kid, n: jwk.n, e: jwk.e };
}

describe('JwksClientService (Phase 2D.5)', () => {
  let publicKeyPem1: string;
  let publicKeyPem2: string;
  const KID_1 = 'kid-one';
  const KID_2 = 'kid-two';
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    const pair1 = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const pair2 = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    publicKeyPem1 = pair1.publicKey;
    publicKeyPem2 = pair2.publicKey;
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function serviceWithJwks(keys: ReturnType<typeof jwkFor>[]) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ keys }) });
    const svc = new JwksClientService(configOf({ OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS: '60000' }));
    svc.configureJwksUri('http://test.invalid/.well-known/jwks.json');
    return svc;
  }

  it('fetches and caches a key, returning it without a second fetch on a repeat lookup for the SAME kid', async () => {
    const svc = serviceWithJwks([jwkFor(KID_1, publicKeyPem1)]);
    const pem1 = await svc.getPublicKeyForKid(KID_1);
    expect(pem1).toEqual(expect.any(String));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const pem2 = await svc.getPublicKeyForKid(KID_1);
    expect(pem2).toBe(pem1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no re-fetch for an already-cached kid
  });

  it('supports multiple simultaneously active keys', async () => {
    const svc = serviceWithJwks([jwkFor(KID_1, publicKeyPem1), jwkFor(KID_2, publicKeyPem2)]);
    const pem1 = await svc.getPublicKeyForKid(KID_1);
    const pem2 = await svc.getPublicKeyForKid(KID_2);
    expect(pem1).not.toBe(pem2);
    expect(fetchMock).toHaveBeenCalledTimes(1); // both resolved from the same single fetch
  });

  it('triggers exactly one refresh for an unknown kid, then returns null if still unresolved (fail closed)', async () => {
    const svc = serviceWithJwks([jwkFor(KID_1, publicKeyPem1)]);
    const result = await svc.getPublicKeyForKid('never-published-kid');
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-fetch on every repeated unknown-kid lookup within the cooldown window (anti-amplification)', async () => {
    const svc = serviceWithJwks([jwkFor(KID_1, publicKeyPem1)]);
    await svc.getPublicKeyForKid('unknown-a');
    await svc.getPublicKeyForKid('unknown-b');
    await svc.getPublicKeyForKid('unknown-c');
    expect(fetchMock).toHaveBeenCalledTimes(1); // cooldown suppressed the 2nd/3rd attempts
  });

  it('picks up a rotated key once the cooldown has elapsed and a new lookup occurs', async () => {
    const svc = new JwksClientService(configOf({ OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS: '0' })); // no cooldown, for this test only
    svc.configureJwksUri('http://test.invalid/.well-known/jwks.json');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [jwkFor(KID_1, publicKeyPem1)] }) });
    expect(await svc.getPublicKeyForKid(KID_1)).toEqual(expect.any(String));

    // Simulate rotation: the issuer's JWKS now serves a new kid.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [jwkFor(KID_2, publicKeyPem2)] }) });
    const rotated = await svc.getPublicKeyForKid(KID_2);
    expect(rotated).toEqual(expect.any(String));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a failed refresh (network error) leaves the existing cache intact and does not throw', async () => {
    const svc = new JwksClientService(configOf({ OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS: '0' }));
    svc.configureJwksUri('http://test.invalid/.well-known/jwks.json');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [jwkFor(KID_1, publicKeyPem1)] }) });
    const pem1 = await svc.getPublicKeyForKid(KID_1);
    expect(pem1).toEqual(expect.any(String));

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const stillCached = await svc.getPublicKeyForKid(KID_1);
    expect(stillCached).toBe(pem1); // cached key still verifies even though JWKS is currently unreachable

    const unknownDuringOutage = await svc.getPublicKeyForKid('some-other-kid');
    expect(unknownDuringOutage).toBeNull(); // an unresolvable kid during an outage fails closed, never guessed
  });

  it('a non-2xx JWKS response is treated as a failed refresh, not a crash', async () => {
    const svc = new JwksClientService(configOf({ OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS: '0' }));
    svc.configureJwksUri('http://test.invalid/.well-known/jwks.json');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const result = await svc.getPublicKeyForKid(KID_1);
    expect(result).toBeNull();
  });

  it('a malformed JWKS body (not {keys:[...]}) is treated as a failed refresh, not a crash', async () => {
    const svc = new JwksClientService(configOf({ OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS: '0' }));
    svc.configureJwksUri('http://test.invalid/.well-known/jwks.json');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ notKeys: 'garbage' }) });
    const result = await svc.getPublicKeyForKid(KID_1);
    expect(result).toBeNull();
  });

  it('skips a malformed/malicious individual key entry without poisoning the rest of the set', async () => {
    // A non-string `n` (Node's crypto.createPublicKey throws a TypeError for
    // this — unlike merely-unusual-but-decodable base64url text, which Node
    // tolerates leniently) — exercises the per-entry catch/skip path
    // without relying on a specific string being rejected as "invalid
    // base64url," which Node does not reliably do.
    const malformedEntry = { kty: 'RSA', use: 'sig', alg: 'RS256', kid: 'bad-entry', n: 12345 as unknown as string, e: 'AQAB' };
    const svc = serviceWithJwks([malformedEntry, jwkFor(KID_1, publicKeyPem1)]);
    expect(await svc.getPublicKeyForKid(KID_1)).toEqual(expect.any(String));
    expect(await svc.getPublicKeyForKid('bad-entry')).toBeNull();
  });

  it('concurrent lookups for an unknown kid share one in-flight refresh, not one fetch per caller', async () => {
    const svc = serviceWithJwks([jwkFor(KID_1, publicKeyPem1)]);
    await Promise.all([svc.getPublicKeyForKid('x'), svc.getPublicKeyForKid('x'), svc.getPublicKeyForKid('x')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
