import { Injectable, Logger } from '@nestjs/common';
import { ResourceAuthorizationPolicy } from '../interfaces';

/**
 * Phase 2D.6 — the ONLY place a `ResourceAuthorizationPolicy` implementation
 * is looked up from. Deliberately a plain, explicit `Map` keyed by an
 * opaque `productId` string — never a global mutable "current product"
 * variable (brief §35), and never populated with any real product's
 * implementation by this repository itself (see the interface's own doc
 * comment). Each registered entry is fully isolated: `get(productId)`
 * returns exactly the policy registered under that exact key, or
 * `undefined` — there is no fallback, no wildcard, no "closest match."
 *
 * A `register()` call for an already-registered `productId` REPLACES the
 * previous entry rather than silently coexisting with it or throwing — the
 * last registration for a given key wins, the same "re-register to update"
 * semantics `configureJwksUri()` (Phase 2D.5) already established for a
 * comparable test/bootstrap override.
 */
@Injectable()
export class ResourceAuthorizationPolicyRegistry {
  private readonly logger = new Logger(ResourceAuthorizationPolicyRegistry.name);
  private readonly policies = new Map<string, ResourceAuthorizationPolicy>();

  register(productId: string, policy: ResourceAuthorizationPolicy): void {
    this.policies.set(productId, policy);
    this.logger.log(`Resource authorization policy registered for productId=${productId}`);
  }

  unregister(productId: string): void {
    this.policies.delete(productId);
  }

  get(productId: string): ResourceAuthorizationPolicy | undefined {
    return this.policies.get(productId);
  }
}
