import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
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
}
