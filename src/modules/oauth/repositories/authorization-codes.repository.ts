import { Injectable } from '@nestjs/common';
import { OAuthAuthorizationCode } from '@prisma/client';
import { PrismaContextService } from '../../../database';

export interface CreateAuthorizationCodeRow {
  codeHash: string;
  applicationId: string;
  userId: string;
  tenantId: string;
  organizationId: string | null;
  redirectUri: string;
  audience: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
  /** Phase 2D.8 — present only for an OIDC transaction (`scopes` includes `openid`); `null` otherwise. */
  nonce: string | null;
  expiresAt: Date;
}

/**
 * Phase 2D.7 (docs/OAUTH_AUTHORIZATION_CODE_PKCE.md §6/§9) — the ONLY
 * access path to `oauth_authorization_code`. Deliberately narrow: exactly
 * three methods, no list/update/delete-by-id, no controller anywhere
 * exposes this table as a tenant-facing CRUD resource (brief §16). Every
 * method takes `tenantId` explicitly and routes through
 * `PrismaContextService.runInContext` — at issuance it is the authenticated
 * session's own (trusted) tenantId; at redemption it is parsed from the
 * code's own opaque prefix BEFORE this repository is ever called
 * (`TokenService.parseAuthorizationCode`) — there is no code path here that
 * lets one tenant's ambient context reach another tenant's row (RLS
 * enforces this at the database layer too, defense in depth).
 */
@Injectable()
export class AuthorizationCodesRepository {
  constructor(private readonly prismaContext: PrismaContextService) {}

  create(row: CreateAuthorizationCodeRow): Promise<OAuthAuthorizationCode> {
    return this.prismaContext.runInContext((tx) => tx.oAuthAuthorizationCode.create({ data: row }), row.tenantId);
  }

  findByCodeHash(tenantId: string, codeHash: string): Promise<OAuthAuthorizationCode | null> {
    return this.prismaContext.runInContext((tx) => tx.oAuthAuthorizationCode.findFirst({ where: { tenantId, codeHash } }), tenantId);
  }

  /**
   * Atomic, concurrency-safe single-use consumption (brief §48/§18) — a
   * conditional UPDATE, not a SELECT-then-UPDATE: `count === 1` is the ONLY
   * proof this caller won the race to redeem this code, closing the
   * check-then-act (TOCTOU) window a naive read-then-write would leave
   * open. Re-checks `consumedAt IS NULL` and `expiresAt > now()` at the
   * exact moment of the write, not merely at an earlier read. Mirrors
   * `InvitationTokensRepository.claim()`'s identical compare-and-swap
   * idiom, applied here to a structurally different, single-use token type
   * (brief §36: keep the two lifecycles/storage separate — reuse the
   * PATTERN, not the table or the method).
   */
  async tryConsume(tenantId: string, codeHash: string): Promise<boolean> {
    const result = await this.prismaContext.runInContext(
      (tx) =>
        tx.oAuthAuthorizationCode.updateMany({
          where: { tenantId, codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        }),
      tenantId,
    );
    return result.count === 1;
  }

  /**
   * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Authorization
   * transaction lifecycle) — deletes every row for ONE tenant whose
   * `expiresAt` has already passed, regardless of `consumedAt` (an expired
   * code is worthless whether or not it was ever redeemed — `tryConsume`
   * already treats `expiresAt <= now()` as equally invalid either way, so
   * there is no reason to retain it past that point). NEVER touches a row
   * whose `expiresAt` is still in the future — an active/unexpired code is
   * never a cleanup candidate, consumed or not (brief §9: "do not delete
   * active/unexpired authorization codes").
   *
   * RLS-scoped like every other method here — this is the per-tenant
   * building block; a genuine cross-tenant maintenance sweep is the
   * standalone `database/scripts/cleanup-expired-authorization-codes.ts`
   * script (run with an elevated/RLS-exempt role, exactly like
   * `database/scripts/bootstrap-platform-operator.ts`), never a
   * background-worker framework introduced into the running application
   * itself.
   */
  async deleteExpiredForTenant(tenantId: string, now: Date = new Date()): Promise<number> {
    const result = await this.prismaContext.runInContext((tx) => tx.oAuthAuthorizationCode.deleteMany({ where: { tenantId, expiresAt: { lte: now } } }), tenantId);
    return result.count;
  }
}
