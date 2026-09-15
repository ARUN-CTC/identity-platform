import { ClsStore } from 'nestjs-cls';

/**
 * Request-scoped values threaded through every layer via AsyncLocalStorage.
 * Phase 1 extracted source — copied from TravelOS
 * (apps/backend/src/common/context/app-cls-store.ts), classified REUSABLE.
 */
export interface AppClsStore extends ClsStore {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId: string;
  // Phase 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) — the caller's
  // currently SELECTED organization, populated by JwtAuthGuard from the
  // access token's own organizationId claim. Undefined/null = no
  // organization selected (tenant-wide only) — the same meaning it's had
  // since Phase 1's schema first anticipated this field on
  // security_session. Never itself trusted as authorization — see that
  // claim's own doc comment (TokenService.AccessTokenClaims).
  organizationId?: string | null;
  // Phase 2B.1 (docs/PLATFORM_OPERATOR_ARCHITECTURE.md) — populated
  // exclusively by PlatformJwtAuthGuard, on platform-operator-authenticated
  // requests only. Never set alongside tenantId/userId: each HTTP request
  // gets its own fresh CLS store (nestjs-cls' AsyncLocalStorage, opened per
  // request by ClsMiddleware), so a tenant request and a platform request
  // can never share, or leak into, each other's context.
  operatorId?: string;
  isPlatformOperator?: boolean;
}
