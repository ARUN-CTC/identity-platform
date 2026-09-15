import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common';
import { JwksResponse } from '../interfaces';
import { SigningKeyService } from '../services';

/**
 * Phase 2D.1 (docs/KEY_MANAGEMENT_ARCHITECTURE.md §3,
 * docs/EXTERNAL_API_TRUST_BOUNDARY.md §2) — publishes only the public half
 * of every currently-verification-valid external signing key. Public,
 * unauthenticated by design (JWKS is not a secret — it is what lets a
 * resource server verify a signature without ever holding this platform's
 * private key), excluded from the global `api/v1` prefix so it resolves at
 * the standard, spec-required path (`main.ts`).
 */
@ApiTags('oauth')
@Controller('.well-known')
export class JwksController {
  constructor(private readonly signingKeys: SigningKeyService) {}

  @Get('jwks.json')
  @Public()
  @ApiOperation({ summary: 'Publish public RSA keys for verifying externally-issued (OAuth/OIDC) RS256 tokens' })
  getJwks(): JwksResponse {
    return this.signingKeys.getJwks();
  }
}
