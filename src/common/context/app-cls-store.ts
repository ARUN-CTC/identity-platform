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
}
