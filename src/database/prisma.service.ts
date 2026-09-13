import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Phase 1 extracted source — copied from TravelOS, classified REUSABLE. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to the identity_platform_db database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
