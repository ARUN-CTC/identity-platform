import { Injectable } from '@nestjs/common';
import { ServiceAccount } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaService } from '../../../database';

export interface CreateServiceAccountRow {
  applicationId: string;
  name: string;
  credentialHash: string;
}

/**
 * Phase 2D.3 — service_account is platform-level reference data, exactly
 * like application/product (no tenant_id, no RLS — database/ddl/009_service_account.sql).
 * `update()` names every written field explicitly (never `{...dto}`) —
 * the same repository-layer discipline Phase 2D.2's own security fix
 * established for ApplicationsRepository, applied here from the start
 * rather than discovered as a defect later: `applicationId` is immutable
 * (Step 13 of the brief) and must never depend solely on whatever HTTP-
 * layer validation happens to be wired in front of this call.
 */
@Injectable()
export class ServiceAccountsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
  ) {}

  async findManyForApplication(applicationId: string, skip: number, take: number): Promise<[ServiceAccount[], number]> {
    const where = { applicationId };
    const [items, total] = await Promise.all([
      this.prisma.serviceAccount.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.serviceAccount.count({ where }),
    ]);
    return [items, total];
  }

  findById(id: string): Promise<ServiceAccount | null> {
    return this.prisma.serviceAccount.findFirst({ where: { id } });
  }

  create(row: CreateServiceAccountRow): Promise<ServiceAccount> {
    return this.prisma.serviceAccount.create({ data: { ...row, createdBy: this.context.userId } });
  }

  update(id: string, dto: { name?: string; status?: string }): Promise<ServiceAccount> {
    return this.prisma.serviceAccount.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        updatedBy: this.context.userId,
      },
    });
  }

  /**
   * Phase 2UI.2 (docs/CREDENTIAL_ROTATION.md) — same optimistic-lock
   * `updateMany` + version-WHERE-guard pattern ApplicationsRepository.rotateSecret()
   * and TenantProductEntitlementsRepository.transition() already use.
   * Explicitly never touches applicationId, tenantGrants, or any
   * entitlement-adjacent data — only the credential fields — so rotation
   * can never accidentally change what this ServiceAccount is authorized
   * to do, only what proves it's the one doing it.
   */
  async rotateCredential(id: string, expectedVersion: bigint, newCredentialHash: string): Promise<boolean> {
    const result = await this.prisma.serviceAccount.updateMany({
      where: { id, version: expectedVersion },
      data: { credentialHash: newCredentialHash, credentialCreatedAt: new Date(), credentialRevokedAt: null, updatedBy: this.context.userId },
    });
    return result.count === 1;
  }
}
