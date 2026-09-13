import { Global, Module } from '@nestjs/common';
import { IdentityMetrics } from './identity-metrics.service';

/**
 * Phase 2D.9 — `@Global()` so every feature module can inject
 * `IdentityMetrics` without each one separately importing this module,
 * mirroring how `ClsModule.forRoot({ global: true })` is already
 * registered once in `AppModule`.
 */
@Global()
@Module({
  providers: [IdentityMetrics],
  exports: [IdentityMetrics],
})
export class IdentityMetricsModule {}
