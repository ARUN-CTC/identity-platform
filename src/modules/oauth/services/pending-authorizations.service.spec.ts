import { Application } from '@prisma/client';
import { PendingAuthorizationsService } from './pending-authorizations.service';
import type { AuthorizeRequest } from './authorize.service';
import type { CreatePendingAuthorizationRow, PendingAuthorizationsRepository } from '../repositories';
import type { TokenService } from '../../jwt/services';

/**
 * Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md §7). Pure unit
 * coverage — the repository (real DB access) is mocked so this exercises
 * only this service's own logic: building the row to persist, and the
 * non-enumerating not-found/expired/already-consumed/race-lost collapse in
 * `consume()`.
 */
describe('PendingAuthorizationsService', () => {
  const APPLICATION = { id: 'app-1', clientId: 'client-abc' } as Application;
  const BASE_REQUEST: AuthorizeRequest = {
    responseType: 'code',
    clientId: 'client-abc',
    redirectUri: 'https://app.example.com/callback',
    scope: 'openid profile',
    state: 'state-xyz',
    codeChallenge: 'challenge-value',
    codeChallengeMethod: 'S256',
    audience: 'resource-api',
    organizationId: 'org-1',
    nonce: 'nonce-value',
  };

  function buildDeps() {
    const tokenService = {
      generatePendingAuthorizationReference: jest.fn().mockReturnValue({ plain: 'plain-ref', hash: 'hashed-ref' }),
      pendingAuthorizationTtlSeconds: 600,
      hashRefreshToken: jest.fn().mockReturnValue('hashed-ref'),
    } as unknown as jest.Mocked<TokenService>;
    const repository = {
      create: jest.fn().mockResolvedValue(undefined),
      findByReferenceHash: jest.fn(),
      tryConsume: jest.fn(),
    } as unknown as jest.Mocked<PendingAuthorizationsRepository>;
    return { tokenService, repository };
  }

  describe('create', () => {
    it('persists every OAuth request field, keyed only by the reference hash — never the plain value', async () => {
      const { tokenService, repository } = buildDeps();
      const service = new PendingAuthorizationsService(tokenService, repository);

      const plain = await service.create(BASE_REQUEST, APPLICATION);

      expect(plain).toBe('plain-ref');
      const row = repository.create.mock.calls[0][0] as CreatePendingAuthorizationRow;
      expect(row.referenceHash).toBe('hashed-ref');
      expect(row).not.toHaveProperty('reference');
      expect(row.clientId).toBe(APPLICATION.clientId);
      expect(row.redirectUri).toBe(BASE_REQUEST.redirectUri);
      expect(row.scope).toBe(BASE_REQUEST.scope);
      expect(row.state).toBe(BASE_REQUEST.state);
      expect(row.codeChallenge).toBe(BASE_REQUEST.codeChallenge);
      expect(row.codeChallengeMethod).toBe(BASE_REQUEST.codeChallengeMethod);
      expect(row.audience).toBe(BASE_REQUEST.audience);
      expect(row.organizationId).toBe(BASE_REQUEST.organizationId);
      expect(row.nonce).toBe(BASE_REQUEST.nonce);
    });

    it('derives clientId from the validated Application record, never from the raw request', async () => {
      const { tokenService, repository } = buildDeps();
      const service = new PendingAuthorizationsService(tokenService, repository);

      await service.create({ ...BASE_REQUEST, clientId: 'attacker-supplied-client-id' }, APPLICATION);

      const row = repository.create.mock.calls[0][0] as CreatePendingAuthorizationRow;
      expect(row.clientId).toBe(APPLICATION.clientId);
    });
  });

  describe('consume', () => {
    const FUTURE = new Date(Date.now() + 60_000);
    const PAST = new Date(Date.now() - 60_000);

    it('returns the reconstructed AuthorizeRequest on a valid, unconsumed, unexpired reference', async () => {
      const { tokenService, repository } = buildDeps();
      repository.findByReferenceHash.mockResolvedValue({
        referenceHash: 'hashed-ref',
        responseType: 'code',
        clientId: 'client-abc',
        redirectUri: 'https://app.example.com/callback',
        scope: 'openid profile',
        state: 'state-xyz',
        codeChallenge: 'challenge-value',
        codeChallengeMethod: 'S256',
        audience: 'resource-api',
        organizationId: 'org-1',
        nonce: 'nonce-value',
        consumedAt: null,
        expiresAt: FUTURE,
      } as never);
      repository.tryConsume.mockResolvedValue(true);

      const service = new PendingAuthorizationsService(tokenService, repository);
      const result = await service.consume('plain-ref');

      expect(result).toEqual(BASE_REQUEST);
      expect(repository.tryConsume).toHaveBeenCalledWith('hashed-ref');
    });

    it('returns null when the reference does not exist', async () => {
      const { tokenService, repository } = buildDeps();
      repository.findByReferenceHash.mockResolvedValue(null);

      const service = new PendingAuthorizationsService(tokenService, repository);
      expect(await service.consume('unknown-ref')).toBeNull();
      expect(repository.tryConsume).not.toHaveBeenCalled();
    });

    it('returns null (never re-authorizes) when the reference was already consumed — replay protection', async () => {
      const { tokenService, repository } = buildDeps();
      repository.findByReferenceHash.mockResolvedValue({
        referenceHash: 'hashed-ref',
        redirectUri: 'https://app.example.com/callback',
        consumedAt: new Date(),
        expiresAt: FUTURE,
      } as never);

      const service = new PendingAuthorizationsService(tokenService, repository);
      expect(await service.consume('replayed-ref')).toBeNull();
      expect(repository.tryConsume).not.toHaveBeenCalled();
    });

    it('returns null when the reference has expired', async () => {
      const { tokenService, repository } = buildDeps();
      repository.findByReferenceHash.mockResolvedValue({
        referenceHash: 'hashed-ref',
        redirectUri: 'https://app.example.com/callback',
        consumedAt: null,
        expiresAt: PAST,
      } as never);

      const service = new PendingAuthorizationsService(tokenService, repository);
      expect(await service.consume('expired-ref')).toBeNull();
      expect(repository.tryConsume).not.toHaveBeenCalled();
    });

    it('returns null when a concurrent consumer already won the atomic consume race, even though the read looked valid', async () => {
      const { tokenService, repository } = buildDeps();
      repository.findByReferenceHash.mockResolvedValue({
        referenceHash: 'hashed-ref',
        redirectUri: 'https://app.example.com/callback',
        consumedAt: null,
        expiresAt: FUTURE,
      } as never);
      repository.tryConsume.mockResolvedValue(false);

      const service = new PendingAuthorizationsService(tokenService, repository);
      expect(await service.consume('raced-ref')).toBeNull();
    });
  });
});
