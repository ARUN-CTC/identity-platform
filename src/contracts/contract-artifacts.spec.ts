import { readFileSync } from 'fs';
import { join } from 'path';
import { IDENTITY_BEARER_ERROR_HTTP_STATUS } from './identity-error.contract';
import { ResourceServerAuthError } from '../modules/resource-server/errors';
import { OAuthTokenError } from '../modules/oauth/errors';

/**
 * Phase 2D.12 (docs/API_SECURITY_CONTRACT_FREEZE.md) — a drift guard for
 * the hand-authored contract artifacts in `docs/contracts/` (the OpenAPI
 * artifact, `identity-api-v1.json`, is instead regenerated directly from
 * the real application via `database/scripts/export-openapi-contract.ts`,
 * so it cannot drift by construction). Fails if a future code change
 * alters an HTTP status this artifact promises, without the artifact
 * being updated to match.
 */
describe('Phase 2D.12 — contract artifact drift guard', () => {
  const errorContract = JSON.parse(readFileSync(join(__dirname, '..', '..', 'docs', 'contracts', 'error-contract-v1.json'), 'utf-8'));

  it('every documented bearer_token_errors code produces exactly the documented HTTP status', () => {
    for (const entry of errorContract.bearer_token_errors.codes) {
      const error = new ResourceServerAuthError(entry.code, 'missing_bearer', 'test');
      expect(error.getStatus()).toBe(entry.http_status);
    }
  });

  it('bearer_token_errors covers exactly the same codes as IDENTITY_BEARER_ERROR_HTTP_STATUS — no undocumented code, no stale documented one', () => {
    const documented = errorContract.bearer_token_errors.codes.map((e: { code: string }) => e.code).sort();
    const actual = Object.keys(IDENTITY_BEARER_ERROR_HTTP_STATUS).sort();
    expect(documented).toEqual(actual);
  });

  it('every documented token_endpoint_errors code produces exactly the documented HTTP status', () => {
    for (const entry of errorContract.token_endpoint_errors.codes) {
      const error = new OAuthTokenError(entry.code, 'test');
      expect(error.getStatus()).toBe(entry.http_status);
    }
  });

  describe('identity-api-v1.json (generated via database/scripts/export-openapi-contract.ts)', () => {
    const openapi = JSON.parse(readFileSync(join(__dirname, '..', '..', 'docs', 'contracts', 'identity-api-v1.json'), 'utf-8'));

    it('is a well-formed OpenAPI 3 document naming this platform', () => {
      expect(openapi.openapi).toMatch(/^3\./);
      expect(openapi.info.title).toBe('Identity Platform API');
    });

    it('still contains every frozen v1 endpoint — a stale/regenerated-against-a-broken-app artifact would fail this', () => {
      for (const path of ['/oauth/authorize', '/oauth/token', '/oauth/userinfo']) {
        expect(openapi.paths).toHaveProperty(path);
      }
    });

    it('has a non-trivial number of documented paths (regenerating against a broken app would produce far fewer)', () => {
      expect(Object.keys(openapi.paths).length).toBeGreaterThan(50);
    });
  });
});
