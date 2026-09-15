import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto, Public, RequirePlatformPermissions, ResponseMessage } from '../../../common';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../../platform-operators/guards';
import { CreateApplicationDto } from '../dto/create-application.dto';
import { ApplicationsService } from '../services/applications.service';

/** PHASE 2B.1 MIGRATION — see products.controller.ts's own comment; same reasoning applies here. */
@ApiTags('applications')
@ApiParam({ name: 'productId', format: 'uuid' })
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('products/:productId/applications')
export class ProductApplicationsController {
  constructor(private readonly service: ApplicationsService) {}

  @Get()
  @RequirePlatformPermissions('APPLICATION_VIEW')
  @ApiOperation({ summary: 'List applications registered under a product' })
  list(@Param('productId', ParseUUIDPipe) productId: string, @Query() query: PaginationQueryDto) {
    return this.service.listForProduct(productId, query);
  }

  @Post()
  @RequirePlatformPermissions('APPLICATION_MANAGE')
  @ApiOperation({
    summary: 'Register a new application (client) under a product',
    description: 'The response includes clientSecret in plaintext exactly once, for a CONFIDENTIAL client — it is never shown again after this call.',
  })
  @ResponseMessage('Application created successfully')
  create(@Param('productId', ParseUUIDPipe) productId: string, @Body() dto: CreateApplicationDto) {
    return this.service.create(productId, dto);
  }
}
