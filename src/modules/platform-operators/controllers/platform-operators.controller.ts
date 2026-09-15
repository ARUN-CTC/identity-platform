import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto, Public, RequirePlatformPermissions, ResponseMessage } from '../../../common';
import { CreatePlatformOperatorDto } from '../dto/create-platform-operator.dto';
import { GrantPlatformPermissionDto } from '../dto/grant-platform-permission.dto';
import { UpdatePlatformOperatorStatusDto } from '../dto/update-platform-operator-status.dto';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../guards';
import { PlatformOperatorsService } from '../services';

/**
 * Phase 2B.1 — Platform Operator lifecycle management. Reachable only by an
 * already-authenticated Platform Operator holding PLATFORM_OPERATOR_VIEW/
 * PLATFORM_OPERATOR_MANAGE — never by a tenant-scoped SUPER_ADMIN/
 * TENANT_ADMIN token, however broad (PlatformJwtAuthGuard rejects a
 * tenant-shaped token outright; see docs/PLATFORM_OPERATOR_ARCHITECTURE.md).
 * `@Public()` exempts the global (tenant) JwtAuthGuard; PlatformJwtAuthGuard
 * + PlatformPermissionsGuard, applied locally, are the real gate.
 *
 * No DELETE — disable/reactivate (status) is the lifecycle mechanism,
 * exactly like Product/Application (docs/PHASE_2B.md) and for the same
 * reason: audit history for a security principal must remain meaningful.
 */
@ApiTags('platform-operators')
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('platform/operators')
export class PlatformOperatorsController {
  constructor(private readonly service: PlatformOperatorsService) {}

  @Post()
  @RequirePlatformPermissions('PLATFORM_OPERATOR_MANAGE')
  @ApiOperation({ summary: 'Grant Platform Operator authority to an existing, already-activated Identity' })
  @ResponseMessage('Platform Operator created successfully')
  create(@Body() dto: CreatePlatformOperatorDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequirePlatformPermissions('PLATFORM_OPERATOR_VIEW')
  @ApiOperation({ summary: 'List Platform Operators' })
  list(@Query() query: PaginationQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePlatformPermissions('PLATFORM_OPERATOR_VIEW')
  @ApiOperation({ summary: 'Get a Platform Operator by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePlatformPermissions('PLATFORM_OPERATOR_MANAGE')
  @ApiOperation({
    summary: 'Disable or reactivate a Platform Operator',
    description: 'Disabling immediately revokes every session/refresh-token this operator holds. Rejected with 409 if this would leave zero ACTIVE Platform Operators (enforced at the database level, concurrency-safe).',
  })
  @ResponseMessage('Platform Operator updated successfully')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlatformOperatorStatusDto) {
    return this.service.setStatus(id, dto.status);
  }

  @Post(':id/permissions')
  @RequirePlatformPermissions('PLATFORM_OPERATOR_MANAGE')
  @ApiOperation({ summary: "Grant a platform permission to an operator (grant-ceiling enforced against the caller's own permissions)" })
  @ResponseMessage('Permission granted successfully')
  async grantPermission(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GrantPlatformPermissionDto) {
    await this.service.grantPermission(id, dto.permissionCode);
    return null;
  }

  @Delete(':id/permissions/:code')
  @RequirePlatformPermissions('PLATFORM_OPERATOR_MANAGE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a platform permission from an operator' })
  @ResponseMessage('Permission revoked successfully')
  async revokePermission(@Param('id', ParseUUIDPipe) id: string, @Param('code') code: string) {
    await this.service.revokePermission(id, code);
    return null;
  }
}
