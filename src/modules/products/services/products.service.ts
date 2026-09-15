import { Injectable } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { PaginatedResult, PaginationQueryDto, RequestContextService, ResourceConflictException, ResourceNotFoundException } from '../../../common';
import { SecurityEventsService } from '../../security-audit/services';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ProductsRepository } from '../repositories/products.repository';

/**
 * Phase 2B — Product is the abstract SaaS offering (TravelOS, Healthcare,
 * Gym, ...), registered once by an Identity Platform administrator, not by
 * any tenant (docs/PHASE_2B.md, docs/PHASE_2B_DOMAIN_MODEL.md).
 *
 * PHASE 2B.1 (docs/PLATFORM_OPERATOR_ARCHITECTURE.md): callers now
 * authenticate as a Platform Operator, who has no tenant context at all —
 * security events recorded here use `recordPlatformEvent` (scope
 * 'PLATFORM', tenantId genuinely NULL), replacing Phase 2B's original
 * workaround of borrowing the acting tenant-admin's own ambient tenantId
 * (which no longer exists to borrow). This is the "Do not fake tenant
 * attribution" fix Step 15 required.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async list(query: PaginationQueryDto): Promise<PaginatedResult<Product>> {
    const [items, total] = await this.repository.findMany(query.skip, query.take);
    return new PaginatedResult(items, total, query);
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.repository.findById(id);
    if (!product) {
      throw new ResourceNotFoundException('Product', id);
    }
    return product;
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const existing = await this.repository.findBySlug(dto.slug);
    if (existing) {
      throw new ResourceConflictException('Product', `A product with slug '${dto.slug}' already exists`);
    }
    // Phase 2D.11 (docs/PRODUCTION_READINESS.md §Error handling) — the
    // pre-check above narrows, but does not eliminate, the race between two
    // concurrent requests for the same slug; the unique constraint is the
    // actual authority. No global P2002 filter is wired in this codebase, so
    // without this catch the race's loser would surface as an unhandled 500.
    let product: Product;
    try {
      product = await this.repository.create(dto);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ResourceConflictException('Product', `A product with slug '${dto.slug}' already exists`);
      }
      throw err;
    }
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'PRODUCT_CREATED',
      resourceType: 'Product',
      resourceId: product.id,
      metadata: { name: product.name, slug: product.slug },
    });
    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const existing = await this.findOne(id);
    const updated = await this.repository.update(id, dto);
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: dto.status === 'DISABLED' ? 'PRODUCT_DISABLED' : 'PRODUCT_UPDATED',
      resourceType: 'Product',
      resourceId: id,
      metadata: { before: { name: existing.name, status: existing.status }, after: { name: updated.name, status: updated.status } },
    });
    return updated;
  }
}
