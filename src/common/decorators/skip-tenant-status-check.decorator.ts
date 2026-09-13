import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_STATUS_CHECK_KEY = 'skip_tenant_status_check';

/**
 * Exempts a route from TenantStatusGuard's SUSPENDED/CANCELLED check —
 * needed for tenant lifecycle/administration routes that must stay
 * reachable regardless of the tenant's own status (otherwise a suspended
 * tenant could never be reactivated through its own API). Phase 1
 * extracted source — copied from TravelOS, classified REUSABLE.
 */
export const SkipTenantStatusCheck = () => SetMetadata(SKIP_TENANT_STATUS_CHECK_KEY, true);
