import { Injectable } from '@nestjs/common';
import { Application } from '@prisma/client';
import { TokenService } from '../../jwt/services';
import { AuthorizeRequest } from './authorize.service';
import { CreatePendingAuthorizationRow, PendingAuthorizationsRepository } from '../repositories';

/**
 * Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md §7) — the
 * "remember this validated OAuth request across a login round trip"
 * capability. `create()` is only ever called after
 * `AuthorizeService.validateClientAndRedirect()` has already confirmed
 * `clientId`/`redirectUri` are real and trusted — this class does not
 * re-validate them, matching `AuthorizationCodesRepository`'s own
 * "narrow, no business logic beyond lifecycle" shape.
 */
@Injectable()
export class PendingAuthorizationsService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly repository: PendingAuthorizationsRepository,
  ) {}

  async create(request: AuthorizeRequest, application: Application): Promise<string> {
    const { plain, hash } = this.tokenService.generatePendingAuthorizationReference();
    const expiresAt = new Date(Date.now() + this.tokenService.pendingAuthorizationTtlSeconds * 1000);

    const row: CreatePendingAuthorizationRow = {
      referenceHash: hash,
      responseType: request.responseType,
      clientId: application.clientId,
      redirectUri: request.redirectUri!,
      scope: request.scope,
      state: request.state,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
      audience: request.audience,
      organizationId: request.organizationId ?? null,
      nonce: request.nonce,
      expiresAt,
    };
    await this.repository.create(row);
    return plain;
  }

  /**
   * Looks up and atomically consumes the reference in one step — returns
   * `null` for anything not found/expired/already-consumed (brief §9's
   * "protected against replay"), never distinguishing which to the caller
   * (same non-enumeration discipline every other token-consumption path in
   * this codebase already applies).
   */
  async consume(referencePlain: string): Promise<AuthorizeRequest | null> {
    const hash = this.tokenService.hashRefreshToken(referencePlain);
    const row = await this.repository.findByReferenceHash(hash);
    if (!row || row.consumedAt || row.expiresAt < new Date()) {
      return null;
    }
    const won = await this.repository.tryConsume(hash);
    if (!won) {
      return null;
    }
    return {
      responseType: row.responseType ?? undefined,
      clientId: row.clientId ?? undefined,
      redirectUri: row.redirectUri,
      scope: row.scope ?? undefined,
      state: row.state ?? undefined,
      codeChallenge: row.codeChallenge ?? undefined,
      codeChallengeMethod: row.codeChallengeMethod ?? undefined,
      audience: row.audience ?? undefined,
      organizationId: row.organizationId ?? undefined,
      nonce: row.nonce ?? undefined,
    };
  }
}
