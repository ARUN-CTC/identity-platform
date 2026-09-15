import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto, Public, RequirePlatformPermissions, ResponseMessage } from '../../../common';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../../platform-operators/guards';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ProductsService } from '../services/products.service';

/**
 * Phase 2B — platform-administration surface for registering Products
 * (docs/PHASE_2B.md).
 *
 * PHASE 2B.1 MIGRATION (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, ADR-010):
 * this controller now requires Platform Operator authentication —
 * `@RequirePermissions`/the tenant-scoped PermissionsGuard/SUPER_ADMIN are
 * no longer sufficient here, on purpose. `@Public()` exempts the *global*
 * (tenant) JwtAuthGuard; PlatformJwtAuthGuard + PlatformPermissionsGuard,
 * applied locally, are the real gate — see
 * tests/phase2b1-platform-operator.e2e-spec.ts for the explicit regression
 * proof that a tenant-scoped SUPER_ADMIN token is now rejected here. No
 * DELETE endpoint — status (ACTIVE/SUSPENDED/DISABLED) is the lifecycle
 * mechanism.
 */
@ApiTags('products')
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Post()
  @RequirePlatformPermissions('PRODUCT_MANAGE')
  @ApiOperation({ summary: 'Register a new Product' })
  @ResponseMessage('Product created successfully')
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequirePlatformPermissions('PRODUCT_VIEW')
  @ApiOperation({ summary: 'List registered products' })
  list(@Query() query: PaginationQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePlatformPermissions('PRODUCT_VIEW')
  @ApiOperation({ summary: 'Get a product by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePlatformPermissions('PRODUCT_MANAGE')
  @ApiOperation({ summary: 'Update a product (name, description, status)' })
  @ResponseMessage('Product updated successfully')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(id, dto);
  }
}
