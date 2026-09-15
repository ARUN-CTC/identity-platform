import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, RequirePlatformPermissions, ResponseMessage } from '../../../common';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../../platform-operators/guards';
import { UpdateServiceAccountDto } from '../dto/update-service-account.dto';
import { ServiceAccountsService } from '../services';

/** PHASE 2D.3 — mirrors ApplicationsController exactly (flat GET/PATCH by id, application ownership immutable). */
@ApiTags('service-accounts')
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('service-accounts')
export class ServiceAccountsController {
  constructor(private readonly service: ServiceAccountsService) {}

  @Get(':id')
  @RequirePlatformPermissions('SERVICE_ACCOUNT_VIEW')
  @ApiOperation({ summary: 'Get a service account by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePlatformPermissions('SERVICE_ACCOUNT_MANAGE')
  @ApiOperation({ summary: 'Update a service account (name, status) — applicationId is immutable' })
  @ResponseMessage('Service account updated successfully')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceAccountDto) {
    return this.service.update(id, dto);
  }
}
