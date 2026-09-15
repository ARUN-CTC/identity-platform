import { CanActivate, ExecutionContext, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_RESOURCE_AUTHORIZATION_KEY, RequireResourceAuthorizationOptions } from '../decorators';
import { AuthorizationDecision, ResourceAuthorizationRequest } from '../interfaces';
import { ResourceAuthorizationPolicyRegistry } from '../services';
import { GENERIC_INVALID_TOKEN_MESSAGE, ResourceServerAuthError } from '../../errors';
import { RequestWithExternalPrincipal } from '../../guards/external-bearer-auth.guard';
import { toResourceAuthorizationContext } from '../../interfaces';
import { requireScopes } from '../../utils';

const GENERIC_FORBIDDEN_MESSAGE = 'You are not authorized to perform this action';

/**
 * Phase 2D.6 (docs/RESOURCE_AUTHORIZATION_CONTRACT.md) — the SECOND guard
 * in the pipeline, deliberately separate from `ExternalBearerAuthGuard`
 * (brief §20: "Authentication Guard ≠ Authorization Guard"). Runs strictly
 * AFTER it on any protected route (`@UseGuards(ExternalBearerAuthGuard,
 * ResourceAuthorizationGuard)` — NestJS applies guards in array order) and
 * depends entirely on the principal that guard already attached; it never
 * re-validates a token itself.
 *
 * Responsibilities, and only these:
 *   1. Confirm a principal exists (fails closed — 401 — if this guard
 *      somehow runs without `ExternalBearerAuthGuard` having run first).
 *   2. Enforce Layer 5 (OAuth scope) directly, generically, BEFORE
 *      consulting any product policy — scope evaluation is a Identity-
 *      Platform-owned, product-neutral concern (brief §12/§13).
 *   3. Look up the registered `ResourceAuthorizationPolicy` for the
 *      route's own `productId` and delegate Layers 6-7 (product IAM,
 *      resource policy) to it — no policy registered, a thrown provider
 *      error, or a decision that isn't exactly `{allowed: true}` are ALL
 *      denials, never an allow (brief §23: never treat provider failure as
 *      success).
 *
 * Every denial is a generic, non-distinguishing `ResourceServerAuthError`
 * (`forbidden`, 403) or, for the scope layer specifically,
 * `insufficient_scope` (403) — the internal reason is logged
 * (`resource_authorization_denied reason=...`), never returned to the
 * caller (brief §24).
 */
@Injectable()
export class ResourceAuthorizationGuard implements CanActivate {
  private readonly logger = new Logger(ResourceAuthorizationGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly registry: ResourceAuthorizationPolicyRegistry,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<RequestWithExternalPrincipal>();
    const principal = request.externalPrincipal;

    // Invariant: authorization is only ever meaningful for an already-
    // authenticated principal. A missing principal here means either this
    // guard was misapplied without ExternalBearerAuthGuard preceding it, or
    // (structurally impossible in practice, but checked anyway) that guard
    // somehow allowed the request through without attaching one — either
    // way, fail closed as an authentication failure, not an authorization one.
    if (!principal) {
      this.logDenial('missing_principal', {});
      throw new ResourceServerAuthError('invalid_token', 'missing_bearer', GENERIC_INVALID_TOKEN_MESSAGE);
    }

    const options = this.reflector.getAllAndOverride<RequireResourceAuthorizationOptions | undefined>(REQUIRE_RESOURCE_AUTHORIZATION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!options) {
      // Server misconfiguration (a route applied this guard without
      // @RequireResourceAuthorization) — not caller-triggerable, fails
      // closed with 500 rather than defaulting to any product/resource/action.
      throw new InternalServerErrorException('This endpoint is not correctly configured for resource authorization (missing @RequireResourceAuthorization)');
    }

    const context = toResourceAuthorizationContext(principal);

    // --- Layer 5: OAuth scope (generic, product-neutral, enforced here directly) ---
    if (options.requiredScopes && options.requiredScopes.length > 0) {
      try {
        requireScopes(context, options.requiredScopes);
      } catch (err) {
        this.logDenial('resource_scope_denied', { productId: options.productId, requiredScopes: options.requiredScopes });
        throw err; // already a correctly-shaped ResourceServerAuthError('insufficient_scope', ...)
      }
    }

    // --- Layers 6-7: product IAM + resource policy, delegated entirely ---
    const authRequest: ResourceAuthorizationRequest = {
      productId: options.productId,
      resource: options.resource,
      action: options.action,
      requiredScopes: options.requiredScopes,
      requiredPermissions: options.requiredPermissions,
    };

    const policy = this.registry.get(options.productId);
    if (!policy) {
      this.logDenial('no_policy_registered', { productId: options.productId });
      throw new ResourceServerAuthError('forbidden', 'no_policy_registered', GENERIC_FORBIDDEN_MESSAGE);
    }

    let decision: AuthorizationDecision;
    try {
      decision = await policy.authorize(context, authRequest);
    } catch {
      // Provider error → deny, unconditionally. Never logged with the
      // underlying error's own message externally (it may contain
      // product-internal detail this platform has no business exposing),
      // and never treated as an ambiguous/retryable state that could
      // resolve to "allow."
      this.logDenial('authorization_provider_error', { productId: options.productId, resource: options.resource, action: options.action });
      throw new ResourceServerAuthError('forbidden', 'authorization_provider_error', GENERIC_FORBIDDEN_MESSAGE);
    }

    if (!decision || decision.allowed !== true) {
      this.logDenial('authorization_denied', { productId: options.productId, resource: options.resource, action: options.action, reasonCode: decision?.reasonCode });
      throw new ResourceServerAuthError('forbidden', 'authorization_denied', GENERIC_FORBIDDEN_MESSAGE);
    }

    this.logger.log(`resource_authorization_allowed productId=${options.productId} resource=${options.resource} action=${options.action} tenant_id=${context.tenantId} jti=${principal.jti}`);
    return true;
  }

  private logDenial(reasonCode: string, fields: Record<string, unknown>): void {
    this.logger.warn(`resource_authorization_denied reason=${reasonCode} ${JSON.stringify(fields)}`);
  }
}
