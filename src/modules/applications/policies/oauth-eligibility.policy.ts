import { HttpStatus, Injectable } from '@nestjs/common';
import { Application } from '@prisma/client';
import { AppException } from '../../../common';
import { ProductsService } from '../../products/services';
import { ApplicationsRepository } from '../repositories';
import { ApplicationAudiencePolicy } from './audience.policy';
import { ApplicationGrantPolicy } from './grant-type.policy';
import { RedirectUriPolicy } from './redirect-uri.policy';
import { ApplicationScopePolicy } from './scope.policy';

export type OAuthEligibilityDenialReason =
  | 'application_not_found'
  | 'application_inactive'
  | 'product_inactive'
  | 'grant_type_not_allowed'
  | 'scope_not_allowed'
  | 'audience_not_allowed'
  | 'redirect_uri_not_allowed';

/**
 * Phase 2D.2 — a categorized denial, distinct per reason (unlike the
 * human-login/organization-context enumeration-resistance pattern
 * elsewhere in this codebase). OAuth client errors are conventionally
 * specific (RFC 6749 §5.2's own `invalid_client`/`invalid_scope`/
 * `unauthorized_client` taxonomy) — there is no equivalent
 * account-enumeration privacy concern for a machine client identifier the
 * way there is for a human email address, so this deliberately does not
 * collapse every reason into one generic message.
 */
export class OAuthEligibilityError extends AppException {
  constructor(
    public readonly reason: OAuthEligibilityDenialReason,
    message: string,
  ) {
    super('OAUTH_APPLICATION_NOT_ELIGIBLE', message, HttpStatus.FORBIDDEN);
  }
}

/**
 * Phase 2D.2 (brief §24 "OAuthApplicationPolicy") — the single, composed
 * eligibility check a future `/authorize`/`/token` implementation must call
 * instead of re-deriving these rules itself. Issues NO token — returns the
 * validated `Application` row on success, throws a categorized
 * `OAuthEligibilityError` on any failure. Every individual rule (grant
 * type, scope, audience, redirect URI, application/product active status)
 * is delegated to its own dedicated policy class, never reimplemented here
 * — this class is composition only, so a future endpoint and this phase's
 * own tests are provably checking the identical rule, not two copies that
 * could drift apart.
 */
@Injectable()
export class OAuthApplicationPolicyService {
  constructor(
    private readonly applications: ApplicationsRepository,
    private readonly products: ProductsService,
    private readonly grantPolicy: ApplicationGrantPolicy,
    private readonly scopePolicy: ApplicationScopePolicy,
    private readonly audiencePolicy: ApplicationAudiencePolicy,
    private readonly redirectUriPolicy: RedirectUriPolicy,
  ) {}

  async checkEligibility(params: {
    clientId: string;
    grantType?: string;
    requestedScopes?: string[];
    requestedAudience?: string;
    redirectUri?: string;
  }): Promise<Application> {
    const application = await this.applications.findByClientId(params.clientId);
    if (!application) {
      throw new OAuthEligibilityError('application_not_found', 'Unknown client');
    }
    if (application.status !== 'ACTIVE') {
      throw new OAuthEligibilityError('application_inactive', 'This application is not active');
    }

    // A missing Product here would mean a broken FK (application.productId
    // references product(id) ON DELETE CASCADE — the row cannot outlive its
    // Product) — findOne() throwing 404 is unreachable in practice, kept as
    // defense in depth, not silently swallowed.
    const product = await this.products.findOne(application.productId);
    if (product.status !== 'ACTIVE') {
      throw new OAuthEligibilityError('product_inactive', "This application's product is not active");
    }

    if (params.grantType !== undefined && !this.grantPolicy.isGrantTypeAllowed(application, params.grantType)) {
      throw new OAuthEligibilityError('grant_type_not_allowed', 'This application is not configured for the requested grant type');
    }
    if (params.requestedScopes !== undefined && !this.scopePolicy.validateRequestedScopes(application, params.requestedScopes)) {
      throw new OAuthEligibilityError('scope_not_allowed', 'One or more requested scopes are not allowed for this application');
    }
    if (params.requestedAudience !== undefined && !this.audiencePolicy.isAudienceAllowed(application, params.requestedAudience)) {
      throw new OAuthEligibilityError('audience_not_allowed', 'The requested audience is not allowed for this application');
    }
    if (params.redirectUri !== undefined && !this.redirectUriPolicy.isRedirectUriAllowed(application, params.redirectUri)) {
      throw new OAuthEligibilityError('redirect_uri_not_allowed', 'The redirect_uri does not exactly match a registered value');
    }

    return application;
  }
}
