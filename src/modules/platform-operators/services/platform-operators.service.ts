import { HttpStatus, Injectable } from '@nestjs/common';
import { PlatformOperator } from '@prisma/client';
import { AppException, PaginatedResult, PaginationQueryDto, RequestContextService, ResourceConflictException, ResourceNotFoundException } from '../../../common';
import { SecurityEventsService } from '../../security-audit/services';
import { UsersService } from '../../users/services';
import { CreatePlatformOperatorDto } from '../dto/create-platform-operator.dto';
import { PlatformOperatorStatusValue } from '../dto/update-platform-operator-status.dto';
import { PlatformOperatorSessionsRepository, PlatformOperatorsRepository } from '../repositories';

const LAST_OPERATOR_ERROR_SUBSTRING = 'final active Platform Operator';

/**
 * Phase 2B.1 — Platform Operator lifecycle
 * (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, docs/PLATFORM_OPERATOR_LIFECYCLE.md).
 * Every write here is reachable only through PlatformPermissionsGuard
 * (`PLATFORM_OPERATOR_VIEW`/`PLATFORM_OPERATOR_MANAGE`) — see
 * PlatformOperatorsController.
 */
@Injectable()
export class PlatformOperatorsService {
  constructor(
    private readonly repository: PlatformOperatorsRepository,
    private readonly sessions: PlatformOperatorSessionsRepository,
    private readonly usersService: UsersService,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async list(query: PaginationQueryDto): Promise<PaginatedResult<PlatformOperator>> {
    const [items, total] = await this.repository.findMany(query.skip, query.take);
    return new PaginatedResult(items, total, query);
  }

  async findOne(id: string): Promise<PlatformOperator & { permissionCodes: string[] }> {
    const operator = await this.repository.findById(id);
    if (!operator) {
      throw new ResourceNotFoundException('PlatformOperator', id);
    }
    const permissionCodes = await this.repository.listPermissionCodes(id);
    return { ...operator, permissionCodes };
  }

  /**
   * Requires the target email to already resolve to an existing,
   * already-activated global Identity (docs/PLATFORM_OPERATOR_ARCHITECTURE.md,
   * "Creating an operator" — no brand-new-Identity provisioning here). Every
   * initial permissionCode is grant-ceiling-checked against the CALLER's own
   * platform permissions (same rule already enforced for tenant role
   * grants — UserRolesService.assertCallerCanGrant) — the caller cannot
   * hand out platform authority they do not themselves hold.
   */
  async create(dto: CreatePlatformOperatorDto): Promise<PlatformOperator & { permissionCodes: string[] }> {
    const identity = await this.usersService.findGlobalIdentitySummaryByEmail(dto.email);
    if (!identity || !identity.hasPassword) {
      throw new AppException(
        'PLATFORM_OPERATOR_IDENTITY_NOT_READY',
        `No existing, already-activated account found for '${dto.email}' — the person must already have a working Identity Platform account before being granted Platform Operator authority`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.repository.findByUserId(identity.id);
    if (existing) {
      throw new ResourceConflictException('PlatformOperator', `'${dto.email}' is already a Platform Operator`);
    }

    await this.assertCallerCanGrant(dto.permissionCodes);

    const operator = await this.repository.create(identity.id);
    for (const code of dto.permissionCodes) {
      const permission = await this.repository.findPermissionByCode(code);
      if (!permission || !permission.platformOnly) {
        throw new AppException('PLATFORM_PERMISSION_NOT_FOUND', `Unknown platform permission code: ${code}`, HttpStatus.BAD_REQUEST);
      }
      await this.repository.grantPermission(operator.id, permission.id);
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'PLATFORM_OPERATOR_CREATED',
      resourceType: 'PlatformOperator',
      resourceId: operator.id,
      metadata: { email: dto.email, permissionCodes: dto.permissionCodes },
    });

    return this.findOne(operator.id);
  }

  /**
   * Status transitions go through the DB (trg_platform_operator_protect_last_active,
   * database/ddl/006_platform_operator.sql) — the last-active-operator
   * invariant is enforced there, concurrency-safely, not just by an
   * application-level count check that a race could slip past (Step 19).
   * Disabling also immediately revokes every session/refresh-token this
   * operator holds — closing the "valid token survives disablement" gap
   * for the refresh path the same way PlatformJwtAuthGuard's live status
   * re-check closes it for the access-token path.
   */
  async setStatus(id: string, status: PlatformOperatorStatusValue): Promise<PlatformOperator> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new ResourceNotFoundException('PlatformOperator', id);
    }

    let updated: PlatformOperator;
    try {
      updated = await this.repository.setStatus(id, status);
    } catch (error) {
      if (error instanceof Error && error.message.includes(LAST_OPERATOR_ERROR_SUBSTRING)) {
        throw new AppException('LAST_ACTIVE_PLATFORM_OPERATOR', 'Cannot disable the final active Platform Operator.', HttpStatus.CONFLICT);
      }
      throw error;
    }

    if (status === 'DISABLED') {
      await this.sessions.revokeAllSessionsForOperator(id, 'OPERATOR_DISABLED');
      await this.sessions.revokeAllRefreshTokensForOperator(id);
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: status === 'DISABLED' ? 'PLATFORM_OPERATOR_DISABLED' : 'PLATFORM_OPERATOR_REACTIVATED',
      resourceType: 'PlatformOperator',
      resourceId: id,
      metadata: { fromStatus: existing.status, toStatus: status },
    });

    return updated;
  }

  async grantPermission(id: string, permissionCode: string): Promise<void> {
    const operator = await this.repository.findById(id);
    if (!operator) {
      throw new ResourceNotFoundException('PlatformOperator', id);
    }
    await this.assertCallerCanGrant([permissionCode]);

    const permission = await this.repository.findPermissionByCode(permissionCode);
    if (!permission || !permission.platformOnly) {
      throw new AppException('PLATFORM_PERMISSION_NOT_FOUND', `Unknown platform permission code: ${permissionCode}`, HttpStatus.BAD_REQUEST);
    }
    const already = await this.repository.hasPermission(id, permissionCode);
    if (already) {
      throw new ResourceConflictException('PlatformOperatorPermission', `Operator already holds ${permissionCode}`);
    }
    await this.repository.grantPermission(id, permission.id);
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'PLATFORM_OPERATOR_PERMISSION_GRANTED',
      resourceType: 'PlatformOperator',
      resourceId: id,
      metadata: { permissionCode },
    });
  }

  async revokePermission(id: string, permissionCode: string): Promise<void> {
    const operator = await this.repository.findById(id);
    if (!operator) {
      throw new ResourceNotFoundException('PlatformOperator', id);
    }
    await this.repository.revokePermission(id, permissionCode);
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'PLATFORM_OPERATOR_PERMISSION_REVOKED',
      resourceType: 'PlatformOperator',
      resourceId: id,
      metadata: { permissionCode },
    });
  }

  /** Grant-ceiling: the caller may only grant platform permission codes they themselves already hold — same rule already enforced for tenant role grants (UserRolesService). */
  private async assertCallerCanGrant(permissionCodes: string[]): Promise<void> {
    const callerOperatorId = this.context.requireOperatorId();
    const callerCodes = await this.repository.listPermissionCodes(callerOperatorId);
    const missing = permissionCodes.filter((code) => !callerCodes.includes(code));
    if (missing.length > 0) {
      throw new AppException(
        'INSUFFICIENT_PLATFORM_PRIVILEGE_TO_GRANT',
        `Cannot grant permissions you do not hold yourself: ${missing.join(', ')}`,
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
