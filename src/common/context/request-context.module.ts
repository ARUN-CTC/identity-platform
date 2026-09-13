import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TenantStatusGuard } from '../guards/tenant-status.guard';
import { RequestContextService } from './request-context.service';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 * JwtAuthGuard/PermissionsGuard are registered as global guards in
 * AuthenticationModule instead of here, to avoid this @Global module
 * importing back into the security domain.
 */
@Global()
@Module({
  providers: [RequestContextService, { provide: APP_GUARD, useClass: TenantStatusGuard }],
  exports: [RequestContextService],
})
export class RequestContextModule {}
