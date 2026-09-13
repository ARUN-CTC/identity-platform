import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_POLICY_KEY = 'rateLimitPolicy';

/** Names which rate-limit policy (`rate-limit.policies.ts`, resolved fresh per-request via `getRateLimitPolicy`) a route is checked against — mirrors the `@ExpectedAudience`/`@RequireResourceAuthorization` SetMetadata idiom already established for the resource-server module. */
export const RateLimited = (policyName: string) => SetMetadata(RATE_LIMIT_POLICY_KEY, policyName);
