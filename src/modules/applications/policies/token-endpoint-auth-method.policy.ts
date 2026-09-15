import { Injectable } from '@nestjs/common';

/**
 * Phase 2D.2 (docs/adr/ADR-018-application-trust-client-types.md
 * §Security implications) — `tokenEndpointAuthMethod` is derived strictly
 * from `clientType`, never independently client-settable: a CONFIDENTIAL
 * client (holds a real secret) authenticates with `client_secret_basic`; a
 * PUBLIC client (no secret — PKCE is its only proof of possession) uses
 * `none`. `CreateApplicationDto` does not even accept this field as input
 * (docs/APPLICATION_AUTHORIZATION.md) — `isValidCombination` exists as a
 * defense-in-depth check for any other write path (e.g. a future admin
 * override) that might otherwise be able to introduce a mismatch.
 */
export type TokenEndpointAuthMethod = 'client_secret_basic' | 'none';

@Injectable()
export class TokenEndpointAuthMethodPolicy {
  derive(clientType: string): TokenEndpointAuthMethod {
    return clientType === 'PUBLIC' ? 'none' : 'client_secret_basic';
  }

  isValidCombination(clientType: string, tokenEndpointAuthMethod: string): boolean {
    return tokenEndpointAuthMethod === this.derive(clientType);
  }
}
