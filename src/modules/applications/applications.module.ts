import { Module } from '@nestjs/common';
import { PlatformOperatorsModule } from '../platform-operators/platform-operators.module';
import { ProductsModule } from '../products/products.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { ApplicationsController, ProductApplicationsController } from './controllers';
import {
  ApplicationAudiencePolicy,
  ApplicationGrantPolicy,
  ApplicationScopePolicy,
  OAuthApplicationPolicyService,
  OriginPolicy,
  RedirectUriPolicy,
  TokenEndpointAuthMethodPolicy,
} from './policies';
import { ApplicationsRepository } from './repositories';
import { ApplicationsService } from './services';

@Module({
  imports: [ProductsModule, SecurityAuditModule, PlatformOperatorsModule],
  controllers: [ApplicationsController, ProductApplicationsController],
  providers: [
    ApplicationsService,
    ApplicationsRepository,
    ApplicationGrantPolicy,
    ApplicationScopePolicy,
    ApplicationAudiencePolicy,
    RedirectUriPolicy,
    OriginPolicy,
    TokenEndpointAuthMethodPolicy,
    OAuthApplicationPolicyService,
  ],
  // Every policy is exported (not just ApplicationsService) — a future
  // /authorize|/token implementation (a different module) will inject
  // these directly rather than reimplementing their rules
  // (docs/PHASE_2D_ARCHITECTURE.md §Implementation Roadmap).
  exports: [
    ApplicationsService,
    ApplicationsRepository,
    ApplicationGrantPolicy,
    ApplicationScopePolicy,
    ApplicationAudiencePolicy,
    RedirectUriPolicy,
    OriginPolicy,
    TokenEndpointAuthMethodPolicy,
    OAuthApplicationPolicyService,
  ],
})
export class ApplicationsModule {}
