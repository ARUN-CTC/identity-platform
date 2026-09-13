import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RateLimitExceededException } from './rate-limit-exceeded.exception';
import { buildRateLimitKey, sourceIdentifierFor } from './rate-limit-key.util';
import { getRateLimitPolicy } from './rate-limit.policies';
import { RATE_LIMIT_POLICY_KEY } from './rate-limit-policy.decorator';
import { RateLimitService } from './rate-limit.service';

/**
 * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Rate limiting) —
 * generic, provider-neutral rate-limiting guard. Applied via
 * `@RateLimited(policy)` (brief §4's own `GET /oauth/authorize`,
 * `POST /oauth/token`, `GET /oauth/userinfo`). Deliberately lives in
 * `common`, not the `oauth`/`resource-server` feature modules — it depends
 * on neither, so it can be reused by any future rate-limited route without
 * creating a dependency from shared infrastructure back onto a specific
 * feature.
 *
 * The key is built from `client_id` (query or body, whichever the request
 * shape carries — never a Basic-auth-derived value, keeping this guard
 * free of any OAuth-specific parsing) plus a hashed, bounded source
 * identifier (`buildRateLimitKey`) — never the raw IP, never any other
 * request field, so changing `state`/`nonce`/`scope`/`redirect_uri` can
 * never reset or evade the limit (brief §4).
 *
 * Fails OPEN only on a missing policy (a route-configuration bug, not a
 * caller-triggerable condition) by allowing the request through — the
 * inverse of every other guard's fail-closed posture in this codebase
 * would be wrong here specifically, since a rate limiter is a defense-in-
 * depth availability control, not an authorization decision; a
 * misconfigured rate limit must never itself become a way to deny
 * legitimate traffic. Every other path fails closed (any store error is
 * an unhandled rejection, matching the same "let it surface as a 500
 * rather than silently allow" discipline other guards apply to their own
 * unexpected errors).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const policyName = this.reflector.getAllAndOverride<string | undefined>(RATE_LIMIT_POLICY_KEY, [ctx.getHandler(), ctx.getClass()]);
    const policy = policyName ? getRateLimitPolicy(policyName) : undefined;
    if (!policy) {
      return true;
    }

    const request = ctx.switchToHttp().getRequest<Request>();
    const clientId = this.extractClientId(request);
    const key = buildRateLimitKey(sourceIdentifierFor(request), clientId);

    const result = await this.rateLimit.consume(key, policy);
    if (!result.allowed) {
      const response = ctx.switchToHttp().getResponse<Response>();
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new RateLimitExceededException(result.retryAfterSeconds);
    }
    return true;
  }

  private extractClientId(request: Request): string | undefined {
    const fromQuery = request.query?.['client_id'];
    if (typeof fromQuery === 'string' && fromQuery.length > 0) {
      return fromQuery;
    }
    const fromBody = (request.body as Record<string, unknown> | undefined)?.['client_id'];
    if (typeof fromBody === 'string' && fromBody.length > 0) {
      return fromBody;
    }
    return undefined;
  }
}
