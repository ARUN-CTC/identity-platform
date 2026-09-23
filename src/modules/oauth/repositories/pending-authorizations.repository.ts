import { Injectable } from '@nestjs/common';
import { OAuthPendingAuthorization } from '@prisma/client';
import { PrismaContextService } from '../../../database';

export interface CreatePendingAuthorizationRow {
  referenceHash: string;
  responseType?: string;
  clientId?: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  audience?: string;
  organizationId?: string | null;
  nonce?: string;
  expiresAt: Date;
}

/**
 * Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md §7) —
 * `oauth_pending_authorization` has no RLS (no tenant is known when a row
 * is created), so every method here runs through Prisma directly, not
 * `prismaContext.runInContext(fn, tenantId)` — there is no tenantId to set
 * as the session GUC. Exactly 3 narrow methods, mirroring
 * AuthorizationCodesRepository's own shape (create / find / atomic
 * tryConsume) — no update/list/delete-by-id CRUD exposed.
 */
@Injectable()
export class PendingAuthorizationsRepository {
  constructor(private readonly prismaContext: PrismaContextService) {}

  create(row: CreatePendingAuthorizationRow): Promise<OAuthPendingAuthorization> {
    return this.prismaContext.runInContext((tx) => tx.oAuthPendingAuthorization.create({ data: row }));
  }

  findByReferenceHash(referenceHash: string): Promise<OAuthPendingAuthorization | null> {
    return this.prismaContext.runInContext((tx) => tx.oAuthPendingAuthorization.findFirst({ where: { referenceHash } }));
  }

  /**
   * ATOMIC single-use consumption — the same conditional-UPDATE pattern
   * AuthorizationCodesRepository.tryConsume() already uses. `count === 1`
   * is the only proof of winning the race; closes the same TOCTOU window a
   * read-then-write would leave open (replay protection, brief §9/§23).
   */
  async tryConsume(referenceHash: string): Promise<boolean> {
    const result = await this.prismaContext.runInContext((tx) =>
      tx.oAuthPendingAuthorization.updateMany({
        where: { referenceHash, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      }),
    );
    return result.count === 1;
  }

  async deleteExpired(now: Date = new Date()): Promise<number> {
    const result = await this.prismaContext.runInContext((tx) => tx.oAuthPendingAuthorization.deleteMany({ where: { expiresAt: { lte: now } } }));
    return result.count;
  }
}
