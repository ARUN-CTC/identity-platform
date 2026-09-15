import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthenticatedExternalPrincipal } from '../interfaces';
import { RequestWithExternalPrincipal } from '../guards/external-bearer-auth.guard';

/**
 * Phase 2D.5 — reads the principal `ExternalBearerAuthGuard` already
 * attached to the request, for a protected controller method to consume
 * directly (e.g. `@CurrentExternalPrincipal() principal: AuthenticatedExternalPrincipal`).
 * Never itself performs validation — a route without the guard applied
 * would simply see `undefined` here, which is why this decorator is only
 * ever meaningful on a route also carrying `@UseGuards(ExternalBearerAuthGuard)`.
 */
export const CurrentExternalPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedExternalPrincipal | undefined => {
  const request = ctx.switchToHttp().getRequest<RequestWithExternalPrincipal>();
  return request.externalPrincipal;
});
