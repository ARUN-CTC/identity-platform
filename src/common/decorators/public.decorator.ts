import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

/**
 * Exempts a route from JwtAuthGuard — the only way to reach an endpoint
 * without a valid access token. Used for login/refresh and health checks.
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
