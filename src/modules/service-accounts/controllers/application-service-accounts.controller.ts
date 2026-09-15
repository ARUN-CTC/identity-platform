import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto, Public, RequirePlatformPermissions, ResponseMessage } from '../../../common';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../../platform-operators/guards';
import { CreateServiceAccountDto } from '../dto/create-service-account.dto';
import { ServiceAccountsService } from '../services';

/** PHASE 2D.3 — mirrors ProductApplicationsController's own reasoning exactly: platform-level registration, Platform Operator authentication only. */
@ApiTags('service-accounts')
@ApiParam({ name: 'applicationId', format: 'uuid' })
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('applications/:applicationId/service-accounts')
export class ApplicationServiceAccountsController {
  constructor(private readonly service: ServiceAccountsService) {}

  @Get()
  @RequirePlatformPermissions('SERVICE_ACCOUNT_VIEW')
  @ApiOperation({ summary: 'List service accounts (machine principals) registered under an application' })
  list(@Param('applicationId', ParseUUIDPipe) applicationId: string, @Query() query: PaginationQueryDto) {
    return this.service.listForApplication(applicationId, query);
  }

  @Post()
  @RequirePlatformPermissions('SERVICE_ACCOUNT_MANAGE')
  @ApiOperation({
    summary: 'Register a new service account under an application',
    description: 'The response includes the plaintext credential exactly once — it is never shown again after this call.',
  })
  @ResponseMessage('Service account created successfully')
  create(@Param('applicationId', ParseUUIDPipe) applicationId: string, @Body() dto: CreateServiceAccountDto) {
    return this.service.create(applicationId, dto);
  }
}
