import { Injectable } from '@nestjs/common';
import { Application } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaService } from '../../../database';
import { UpdateApplicationDto } from '../dto/update-application.dto';

export interface CreateApplicationRow {
  productId: string;
  name: string;
  clientId: string;
  clientSecretHash: string | null;
  clientType: string;
  secretCreatedAt: Date | null;
  redirectUris: string[];
  allowedOrigins: string[];
  // Phase 2D.2 — deny-by-default OAuth client configuration.
  grantTypes: string[];
  allowedScopes: string[];
  audiences: string[];
  // Derived server-side from clientType (ADR-018) — never client input.
  tokenEndpointAuthMethod: string;
}

/** application is global reference data (no tenant_id, no RLS — see database/ddl/005_product.sql). */
@Injectable()
export class ApplicationsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
  ) {}

  async findManyForProduct(productId: string, skip: number, take: number): Promise<[Application[], number]> {
    const where = { productId };
    const [items, total] = await Promise.all([
      this.prisma.application.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.application.count({ where }),
    ]);
    return [items, total];
  }

  findById(id: string): Promise<Application | null> {
    return this.prisma.application.findFirst({ where: { id } });
  }

  findByClientId(clientId: string): Promise<Application | null> {
    return this.prisma.application.findFirst({ where: { clientId } });
  }

  create(row: CreateApplicationRow): Promise<Application> {
    return this.prisma.application.create({ data: { ...row, createdBy: this.context.userId } });
  }

  /**
   * Phase 2UI.2 (docs/CREDENTIAL_ROTATION.md) — optimistic-lock conditional
   * update, exactly the same `updateMany` + WHERE-guard +
   * `result.count === 1` pattern TenantProductEntitlementsRepository.transition()
   * already uses for its own concurrency safety. Two simultaneous rotation
   * requests both read the same `expectedVersion`; only the first UPDATE to
   * commit actually applies (its WHERE clause still matches), the second's
   * WHERE clause no longer matches (the trigger-maintained `version` column
   * has already advanced) and this returns false — the caller turns that
   * into a 409 rather than silently overwriting a secret the first request
   * already returned to its own caller.
   */
  async rotateSecret(id: string, expectedVersion: bigint, newSecretHash: string): Promise<boolean> {
    const result = await this.prisma.application.updateMany({
      where: { id, version: expectedVersion },
      data: { clientSecretHash: newSecretHash, secretCreatedAt: new Date(), secretRevokedAt: null, updatedBy: this.context.userId },
    });
    return result.count === 1;
  }

  /**
   * PHASE 2D.2 SECURITY FIX — explicit field allow-list, never `{...dto}`.
   * Spreading the whole DTO into Prisma's `data` made the write path's only
   * defense against a client sending an unrecognized property (e.g.
   * `productId`, `clientId`, `clientType`, `clientSecretHash`) the GLOBAL
   * `ValidationPipe`'s `forbidNonWhitelisted` (main.ts) — a general-purpose
   * HTTP-layer setting entirely unrelated to this specific, stated-critical
   * invariant ("Application registered for Product A must not obtain
   * access to Product B," docs/PHASE_2D_ARCHITECTURE.md §16). Verified
   * directly: with the pipe bypassed (as every e2e test in this repo's
   * TestingModule-based harness already does — main.ts's bootstrap() is
   * never invoked in tests), a `productId` in the request body was
   * previously written straight through to the database. Naming every
   * written field explicitly here makes the immutability of `productId`
   * (and every other non-updatable field) a repository-level guarantee,
   * independent of whatever HTTP-layer validation happens to run in front
   * of it.
   */
  update(id: string, dto: UpdateApplicationDto): Promise<Application> {
    return this.prisma.application.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        redirectUris: dto.redirectUris,
        allowedOrigins: dto.allowedOrigins,
        grantTypes: dto.grantTypes,
        allowedScopes: dto.allowedScopes,
        audiences: dto.audiences,
        updatedBy: this.context.userId,
      },
    });
  }
}
