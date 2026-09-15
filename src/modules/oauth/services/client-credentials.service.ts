import { Injectable } from '@nestjs/common';
import { IdentityMetricNames, IdentityMetrics, parseScopeClaim, RequestContextService, verifyClientSecret } from '../../../common';
import { SecurityEventsService } from '../../security-audit/services';
import { ApplicationsRepository } from '../../applications/repositories';
import { OAuthApplicationPolicyService, OAuthEligibilityError } from '../../applications/policies';
import { ProductAccessService } from '../../product-entitlements/services';
import { ServiceAccountsRepository } from '../../service-accounts/repositories';
import { ServiceAccountTenantGrantsService } from '../../service-accounts/services';
import { TenantsService } from '../../tenants/services/tenants.service';
import { OAuthTokenError } from '../errors';
import { ExternalTokenService } from './external-token.service';

/** Raw, unvalidated request shape — every field optional; `ClientCredentialsService` itself validates. */
export interface ClientCredentialsRequest {
  grantType?: string;
  serviceAccountId?: string;
  serviceAccountSecret?: string;
  tenantId?: string;
  audience?: string;
  scope?: string;
}

export interface ClientCredentialsResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope?: string;
}

const FORBIDDEN_AUDIENCE_VALUES = new Set(['*', 'all', 'any']);

/**
 * Phase 2D.4 (docs/PHASE_2D4.md, docs/adr/ADR-015-service-tenant-authorization.md,
 * docs/adr/ADR-016-token-and-scope-model.md) — the ONLY orchestration this
 * service performs is the authorization chain itself:
 *
 *   Application (client_secret_basic)
 *   → ServiceAccount (its own credential, belongs to the authenticated Application)
 *   → ServiceAccountTenantGrant (ACTIVE, for the explicitly asserted tenant)
 *   → Tenant (ACTIVE)
 *   → TenantProductEntitlement + Product (ACTIVE, ProductAccessService — reused, not reimplemented)
 *   → scope / audience (OAuthApplicationPolicyService — reused, not reimplemented)
 *   → RS256 token (ExternalTokenService — reused, not reimplemented)
 *
 * Every step fails closed with a generic, non-distinguishing
 * `OAuthTokenError` — never revealing which specific link in the chain
 * broke (brief §13/§35/§36) — while a full, specific `reasonCode` is
 * recorded in the (never client-visible) audit metadata for every denial
 * (§38/§56). No step here creates, activates, or mutates an Application,
 * ServiceAccount, ServiceAccountTenantGrant, TenantProductEntitlement, or
 * Tenant row — issuance only ever reads (§41/§62/§63).
 */
@Injectable()
export class ClientCredentialsService {
  constructor(
    private readonly applications: ApplicationsRepository,
    private readonly oauthPolicy: OAuthApplicationPolicyService,
    private readonly serviceAccounts: ServiceAccountsRepository,
    private readonly grants: ServiceAccountTenantGrantsService,
    private readonly tenants: TenantsService,
    private readonly productAccess: ProductAccessService,
    private readonly externalTokens: ExternalTokenService,
    private readonly securityEvents: SecurityEventsService,
    private readonly metrics: IdentityMetrics,
    private readonly context: RequestContextService,
  ) {}

  async issueToken(basicAuth: { clientId: string; clientSecret: string } | null, request: ClientCredentialsRequest): Promise<ClientCredentialsResult> {
    // --- 1. Request shape (brief §7/§22/§25) -----------------------------
    if (!request.grantType) {
      throw await this.deny('invalid_request', 'grant_type is required', { reasonCode: 'missing_grant_type' });
    }
    if (request.grantType !== 'client_credentials') {
      throw await this.deny('unsupported_grant_type', 'Only grant_type=client_credentials is supported by this endpoint', {
        reasonCode: 'unsupported_grant_type',
        grantType: request.grantType,
      });
    }
    if (!request.tenantId) {
      throw await this.deny('invalid_request', 'tenant_id is required', { reasonCode: 'missing_tenant_id' });
    }
    if (!request.audience) {
      throw await this.deny('invalid_request', 'audience is required', { reasonCode: 'missing_audience' });
    }
    if (!request.serviceAccountId || !request.serviceAccountSecret) {
      throw await this.deny('invalid_request', 'service_account_id and service_account_secret are required', { reasonCode: 'missing_service_account_credentials' });
    }
    if (FORBIDDEN_AUDIENCE_VALUES.has(request.audience.toLowerCase()) || request.audience.includes('*')) {
      throw await this.deny('invalid_target', 'Wildcard/implicit-all audience values are not permitted', { reasonCode: 'wildcard_audience', audience: request.audience });
    }
    const requestedScopes = parseScopeClaim(request.scope);

    // --- 2. Client (Application) authentication (brief §9/§11/§13) ------
    if (!basicAuth) {
      throw await this.deny('invalid_client', 'Client authentication (Authorization: Basic) is required', { reasonCode: 'missing_client_authentication' });
    }
    const application = await this.applications.findByClientId(basicAuth.clientId);
    // Every branch below collapses to the identical, generic invalid_client
    // response — unknown client, wrong secret, PUBLIC client (no usable
    // secret / wrong auth method), inactive Application — brief §13: "Failure
    // must be indistinguishable from other client-authentication failures."
    if (
      !application ||
      application.tokenEndpointAuthMethod !== 'client_secret_basic' ||
      !verifyClientSecret(basicAuth.clientSecret, application.clientSecretHash) ||
      application.status !== 'ACTIVE'
    ) {
      throw await this.deny('invalid_client', 'Client authentication failed', {
        reasonCode: !application
          ? 'client_not_found'
          : application.tokenEndpointAuthMethod !== 'client_secret_basic'
            ? 'client_auth_method_not_supported'
            : application.status !== 'ACTIVE'
              ? 'application_inactive'
              : 'invalid_client_secret',
        clientId: basicAuth.clientId,
      });
    }

    // --- 3. Application eligibility: grant type, product active, scope, audience (reused, not reimplemented) ---
    try {
      await this.oauthPolicy.checkEligibility({
        clientId: application.clientId,
        grantType: 'client_credentials',
        requestedScopes,
        requestedAudience: request.audience,
      });
    } catch (error) {
      if (error instanceof OAuthEligibilityError) {
        const meta = { reasonCode: error.reason, applicationId: application.id, audience: request.audience, requestedScopes };
        if (error.reason === 'grant_type_not_allowed') {
          throw await this.deny('unauthorized_client', 'This application is not authorized for the client_credentials grant', meta);
        }
        if (error.reason === 'scope_not_allowed') {
          throw await this.deny('invalid_scope', 'One or more requested scopes are not allowed for this application', meta);
        }
        if (error.reason === 'audience_not_allowed') {
          throw await this.deny('invalid_target', 'The requested audience is not allowed for this application', meta);
        }
        // application_not_found / application_inactive / product_inactive:
        // application_not_found/inactive are unreachable here (already
        // checked in step 2); product_inactive is a downstream-of-
        // authentication denial — generic, per §36.
        throw await this.deny('access_denied', 'Request denied', meta);
      }
      throw error;
    }

    // --- 4. ServiceAccount authentication + ownership (brief §14/§55) ---
    const serviceAccount = await this.serviceAccounts.findById(request.serviceAccountId);
    if (
      !serviceAccount ||
      serviceAccount.applicationId !== application.id ||
      !verifyClientSecret(request.serviceAccountSecret, serviceAccount.credentialHash) ||
      serviceAccount.status !== 'ACTIVE'
    ) {
      // Generic access_denied — never reveals whether the ServiceAccount
      // exists at all, belongs to a DIFFERENT application, or merely has
      // the wrong secret (the same non-enumeration discipline as client
      // authentication above, extended to the second credential).
      throw await this.deny('access_denied', 'Request denied', {
        reasonCode: !serviceAccount
          ? 'service_account_not_found'
          : serviceAccount.applicationId !== application.id
            ? 'service_account_cross_application'
            : serviceAccount.status !== 'ACTIVE'
              ? 'service_account_inactive'
              : 'invalid_service_account_secret',
        applicationId: application.id,
      });
    }

    // --- 5. Tenant assertion + ServiceAccountTenantGrant (brief §15-18) --
    let tenant;
    try {
      tenant = await this.tenants.findById(request.tenantId);
    } catch {
      // Never reveal "tenant does not exist" vs. "you're not authorized for
      // it" — both collapse to the same access_denied (brief §36).
      throw await this.deny('access_denied', 'Request denied', { reasonCode: 'tenant_not_found', applicationId: application.id, serviceAccountId: serviceAccount.id });
    }
    if (tenant.status !== 'ACTIVE') {
      throw await this.deny('access_denied', 'Request denied', {
        reasonCode: 'tenant_inactive',
        applicationId: application.id,
        serviceAccountId: serviceAccount.id,
        tenantId: tenant.id,
      });
    }
    const grantActive = await this.grants.isGrantActive(tenant.id, serviceAccount.id);
    if (!grantActive) {
      throw await this.deny('access_denied', 'Request denied', {
        reasonCode: 'tenant_not_authorized',
        applicationId: application.id,
        serviceAccountId: serviceAccount.id,
        tenantId: tenant.id,
      });
    }

    // --- 6. Product entitlement + Product status (reused, not reimplemented, brief §19-21) ---
    const access = await this.productAccess.canAccess(tenant.id, application.productId);
    if (!access.allowed) {
      throw await this.deny('access_denied', 'Request denied', {
        reasonCode: access.reason ?? 'product_not_entitled',
        applicationId: application.id,
        serviceAccountId: serviceAccount.id,
        tenantId: tenant.id,
        productId: application.productId,
      });
    }

    // --- 7. Sign (brief §26-33) ------------------------------------------
    const scope = requestedScopes.length > 0 ? requestedScopes.join(' ') : undefined;
    const accessToken = this.externalTokens.sign(
      {
        sub: serviceAccount.id, // never Application.id, never security_user.id (brief §27)
        client_id: application.clientId,
        tenant_id: tenant.id, // contextual only — never authorization by itself (brief §28)
        scope,
        // organization_id deliberately omitted — no organization context ever
        // applies to a ServiceAccount (brief §29).
      },
      { audience: request.audience },
    );
    const expiresIn = this.externalTokens.getDefaultTtlSeconds();

    // --- 8. Audit success — only after signing actually succeeded (brief §39) ---
    await this.securityEvents.recordPlatformEvent({
      eventType: 'OAUTH_TOKEN_ISSUED',
      resourceType: 'ServiceAccount',
      resourceId: serviceAccount.id,
      metadata: {
        result: 'SUCCESS',
        applicationId: application.id,
        serviceAccountId: serviceAccount.id,
        tenantId: tenant.id,
        productId: application.productId,
        audience: request.audience,
        requestedScopes,
      },
      // Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Request
      // correlation) — a pure additive audit-metadata enrichment; changes
      // no conditional logic, no response shape, no error semantics (brief
      // §53: Client Credentials must regress cleanly).
      correlationId: this.context.traceId,
    });
    this.metrics.increment(IdentityMetricNames.OAUTH_TOKEN_ISSUED);

    return { accessToken, tokenType: 'Bearer', expiresIn, scope };
  }

  /**
   * Records a denial audit event (never containing a secret, credential,
   * token, or private key — brief §38) and returns the corresponding
   * OAuth-shaped error for the caller to `throw await this.deny(...)`. A
   * single chokepoint so no denial path can accidentally skip auditing, and
   * the write is always awaited (never fire-and-forget) — the same
   * durable-before-responding discipline every other audited action in this
   * codebase already follows.
   */
  private async deny(code: OAuthTokenError['code'], description: string, metadata: Record<string, unknown>): Promise<OAuthTokenError> {
    this.metrics.increment(IdentityMetricNames.OAUTH_TOKEN_DENIED);
    await this.securityEvents.recordPlatformEvent({
      eventType: 'OAUTH_TOKEN_DENIED',
      resourceType: 'ServiceAccount',
      resourceId: typeof metadata.serviceAccountId === 'string' ? metadata.serviceAccountId : undefined,
      metadata: { result: 'DENIED', ...metadata },
      correlationId: this.context.traceId,
    });
    return new OAuthTokenError(code, description);
  }
}
