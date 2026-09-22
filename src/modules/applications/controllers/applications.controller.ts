import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, RequirePlatformPermissions, ResponseMessage } from '../../../common';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../../platform-operators/guards';
import { UpdateApplicationDto } from '../dto/update-application.dto';
import { ApplicationsService } from '../services/applications.service';

/** PHASE 2B.1 MIGRATION — see products.controller.ts's own comment; same reasoning applies here. */
@ApiTags('applications')
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}

  @Get(':id')
  @RequirePlatformPermissions('APPLICATION_VIEW')
  @ApiOperation({ summary: 'Get an application by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePlatformPermissions('APPLICATION_MANAGE')
  @ApiOperation({ summary: 'Update an application (name, status, reserved OAuth config)' })
  @ResponseMessage('Application updated successfully')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateApplicationDto) {
    return this.service.update(id, dto);
  }

  /**
   * Phase 2UI.2 (docs/CREDENTIAL_ROTATION.md) — no request body: rotation
   * takes no input, matching the existing "credentials/rotate" action-verb
   * convention this endpoint's route mirrors (POST .../:id/reactivate
   * elsewhere in this codebase takes no body either). ATOMIC REPLACEMENT —
   * the old secret stops verifying immediately; see the doc for why.
   */
  @Post(':id/credentials/rotate')
  @HttpCode(HttpStatus.OK)
  @RequirePlatformPermissions('APPLICATION_MANAGE')
  @ApiOperation({ summary: "Rotate an application's client secret — the new plaintext value is shown exactly once, in this response, never again" })
  rotateSecret(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.rotateSecret(id);
  }
}
