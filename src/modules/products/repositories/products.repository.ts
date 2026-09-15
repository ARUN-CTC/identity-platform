import { Injectable } from '@nestjs/common';
import { Product } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaService } from '../../../database';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';

/**
 * Phase 2B — product is global reference data (no tenant_id, no RLS — see
 * database/ddl/005_product.sql, docs/PHASE_2B.md). Mirrors
 * OrganizationTypesRepository's own pattern for exactly the same class of
 * table: plain PrismaService throughout — no PrismaContextService/RLS
 * transaction needed, and Phase 2B has no delete endpoint (see the DDL
 * file's own comment), so there's no soft-delete-safe deleteMany either.
 */
@Injectable()
export class ProductsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
  ) {}

  async findMany(skip: number, take: number): Promise<[Product[], number]> {
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ skip, take, orderBy: { name: 'asc' } }),
      this.prisma.product.count(),
    ]);
    return [items, total];
  }

  findById(id: string): Promise<Product | null> {
    return this.prisma.product.findFirst({ where: { id } });
  }

  /** Case-insensitive — matches the DB's own uk_product_slug functional index (see product.prisma's own comment). */
  findBySlug(slug: string): Promise<Product | null> {
    return this.prisma.product.findFirst({ where: { slug: { equals: slug, mode: 'insensitive' } } });
  }

  create(dto: CreateProductDto): Promise<Product> {
    return this.prisma.product.create({ data: { ...dto, createdBy: this.context.userId } });
  }

  update(id: string, dto: UpdateProductDto): Promise<Product> {
    return this.prisma.product.update({ where: { id }, data: { ...dto, updatedBy: this.context.userId } });
  }
}
