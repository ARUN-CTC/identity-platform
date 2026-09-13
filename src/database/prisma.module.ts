import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaContextService } from './prisma-context.service';

/** Phase 1 extracted source — copied from TravelOS, classified REUSABLE. */
@Global()
@Module({
  providers: [PrismaService, PrismaContextService],
  exports: [PrismaService, PrismaContextService],
})
export class PrismaModule {}
