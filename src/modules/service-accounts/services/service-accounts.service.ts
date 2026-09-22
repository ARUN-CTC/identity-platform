import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, ServiceAccount } from '@prisma/client';
import { AppException, PaginatedResult, PaginationQueryDto, RequestContextService, ResourceConflictException, ResourceNotFoundException, generateClientSecret, hashClientSecret } from '../../../common';
import { ApplicationsService } from '../../applications/services';
import { SecurityEventsService } from '../../security-audit/services';
import { CreateServiceAccountDto } from '../dto/create-service-account.dto';
import { UpdateServiceAccountDto } from '../dto/update-service-account.dto';
import { ServiceAccountsRepository } from '../repositories';

/** create()'s response — the one and only time the plaintext credential is ever shown (docs/PHASE_2D3.md, mirroring CreatedApplication from Phase 2B/2D.2). */
export interface CreatedServiceAccount extends Omit<ServiceAccount, 'credentialHash'> {
  credential: string;
}

/**
 * Phase 2D.3 (docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md,
 * docs/PHASE_2D3.md) — ServiceAccount (machine principal) registration
 * under an Application. Platform-level, no tenant scoping — same posture
 * as ApplicationsService, which this class deliberately mirrors rather
 * than reinventing its own conventions:
 *
 *   - `credentialHash` is stripped from every response except the
 *     one-time plaintext shown at creation (CreatedServiceAccount) — the
 *     exact same discipline as Application's own `clientSecretHash`.
 *   - The credential is generated/hashed with the SAME utilities
 *     Application's own client_secret already uses
 *     (generateClientSecret/hashClientSecret — SHA-256 over a 256-bit
 *     random value; a memory-hard KDF buys nothing for a high-entropy
 *     machine secret, same reasoning as every other non-human-facing
 *     credential in this codebase). This is a DIFFERENT secret value than
 *     any Application's own client_secret — never derived from, shared
 *     with, or confused with it (docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md §2).
 *   - `applicationId` is immutable after creation — UpdateServiceAccountDto
 *     has no such field, and ServiceAccountsRepository.update() names every
 *     written field explicitly (never `{...dto}`), closing the exact class
 *     of gap Phase 2D.2's own security review found and fixed for
 *     Application, from the very first line of code here rather than
 *     discovering it later.
 */
@Injectable()
export class ServiceAccountsService {
  constructor(
    private readonly repository: ServiceAccountsRepository,
    private readonly applicationsService: ApplicationsService,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async listForApplication(applicationId: string, query: PaginationQueryDto): Promise<PaginatedResult<ServiceAccount>> {
    await this.applicationsService.findOne(applicationId); // 404s a nonexistent application before an empty-but-misleading list
    const [items, total] = await this.repository.findManyForApplication(applicationId, query.skip, query.take);
    return new PaginatedResult(items.map((sa) => this.sanitize(sa)), total, query);
  }

  async findOne(id: string): Promise<ServiceAccount> {
    const serviceAccount = await this.repository.findById(id);
    if (!serviceAccount) {
      throw new ResourceNotFoundException('ServiceAccount', id);
    }
    return this.sanitize(serviceAccount);
  }

  /**
   * A ServiceAccount is always machine-authenticated — unlike a PUBLIC
   * OAuth Application, there is no "no secret" variant of a service
   * principal (PKCE has no server-to-server analog), so a credential is
   * always generated here, at creation, never conditionally.
   */
  async create(applicationId: string, dto: CreateServiceAccountDto): Promise<CreatedServiceAccount> {
    await this.applicationsService.findOne(applicationId); // 404s a nonexistent application — existence-checked only, not status-checked: an Application's status governs request-time eligibility (Step 31), never registration.

    const plainCredential = generateClientSecret();
    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = await this.repository.create({
        applicationId,
        name: dto.name,
        credentialHash: hashClientSecret(plainCredential),
      });
    } catch (error) {
      // uk_service_account_application_name (database/ddl/009_service_account.sql)
      // is the actual duplicate-prevention guarantee — the same local P2002
      // catch used by ServiceAccountTenantGrantsService.create() and
      // TenantProductEntitlementsService.create(), applied here for
      // consistency rather than left to surface as an unhandled 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ResourceConflictException('ServiceAccount', `An application already has a service account named "${dto.name}"`);
      }
      throw error;
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'SERVICE_ACCOUNT_CREATED',
      resourceType: 'ServiceAccount',
      resourceId: serviceAccount.id,
      metadata: { applicationId, name: serviceAccount.name },
    });
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'SERVICE_ACCOUNT_CREDENTIAL_CREATED',
      resourceType: 'ServiceAccount',
      resourceId: serviceAccount.id,
      metadata: {},
    });

    const { credentialHash: _credentialHash, ...rest } = serviceAccount;
    return { ...rest, credential: plainCredential };
  }

  /**
   * Phase 2UI.2 (docs/CREDENTIAL_ROTATION.md) — the same rotation
   * capability ApplicationsService.rotateSecret() adds for client secrets,
   * for the DIFFERENT credential a ServiceAccount holds (never derived
   * from, shared with, or confused with its parent Application's own
   * secret — same boundary create() above already documents). ATOMIC
   * REPLACEMENT, same operational consequence: the old credential stops
   * verifying immediately. applicationId, tenant grants, and entitlements
   * are never touched — enforced structurally by
   * ServiceAccountsRepository.rotateCredential() only ever writing the
   * three credential columns.
   */
  async rotateCredential(id: string): Promise<CreatedServiceAccount> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new ResourceNotFoundException('ServiceAccount', id);
    }
    if (existing.status !== 'ACTIVE') {
      throw new AppException('SERVICE_ACCOUNT_NOT_ROTATABLE', `Cannot rotate a credential while the service account's status is ${existing.status} (must be ACTIVE)`, HttpStatus.CONFLICT);
    }

    const plainCredential = generateClientSecret();
    const applied = await this.repository.rotateCredential(id, existing.version, hashClientSecret(plainCredential));
    if (!applied) {
      throw new AppException('CONCURRENT_MODIFICATION', 'This service account was modified concurrently — please retry', HttpStatus.CONFLICT);
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'SERVICE_ACCOUNT_CREDENTIAL_ROTATED',
      resourceType: 'ServiceAccount',
      resourceId: id,
      metadata: {},
    });

    const refreshed = await this.repository.findById(id);
    const { credentialHash: _credentialHash, ...rest } = refreshed!;
    return { ...rest, credential: plainCredential };
  }

  async update(id: string, dto: UpdateServiceAccountDto): Promise<ServiceAccount> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new ResourceNotFoundException('ServiceAccount', id);
    }

    const updated = await this.repository.update(id, dto);

    let eventType = 'SERVICE_ACCOUNT_UPDATED';
    if (dto.status && dto.status !== existing.status) {
      eventType = dto.status === 'DISABLED' ? 'SERVICE_ACCOUNT_DISABLED' : dto.status === 'SUSPENDED' ? 'SERVICE_ACCOUNT_SUSPENDED' : 'SERVICE_ACCOUNT_ENABLED';
    }
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType,
      resourceType: 'ServiceAccount',
      resourceId: id,
      metadata: { before: { name: existing.name, status: existing.status }, after: { name: updated.name, status: updated.status } },
    });
    return this.sanitize(updated);
  }

  private sanitize(serviceAccount: ServiceAccount): ServiceAccount {
    const { credentialHash: _credentialHash, ...rest } = serviceAccount;
    return rest as ServiceAccount;
  }
}
