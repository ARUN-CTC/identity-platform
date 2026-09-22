import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
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

  /** Phase 2UI.2 (docs/CREDENTIAL_ROTATION.md) — mirrors ApplicationsController.rotateSecret() exactly. No request body. ATOMIC REPLACEMENT. */
  @Post(':id/credentials/rotate')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions('SERVICE_ACCOUNT_MANAGE')
  @ApiOperation({ summary: "Rotate a service account's credential — the new plaintext value is shown exactly once, in this response, never again" })
  rotateCredential(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.rotateCredential(id);
  }
}
