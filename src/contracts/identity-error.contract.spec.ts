import { ResourceServerAuthError } from '../modules/resource-server/errors';
import { OAuthTokenError } from '../modules/oauth/errors';
import { IDENTITY_BEARER_ERROR_HTTP_STATUS } from './identity-error.contract';

/**
 * Phase 2D.10 — proves `IDENTITY_BEARER_ERROR_HTTP_STATUS` (the documented,
 * product-facing contract) never silently drifts from what
 * `ResourceServerAuthError` actually produces (the internal, non-exported
 * `STATUS_FOR_CODE` map). If a future phase changes an internal status
 * code, this test fails BEFORE the documentation quietly goes stale.
 */
describe('Phase 2D.10 — identity-error.contract (drift guard)', () => {
  it.each(Object.entries(IDENTITY_BEARER_ERROR_HTTP_STATUS))('ResourceServerAuthError(%s) actually responds with the documented status %i', (code, expectedStatus) => {
    const error = new ResourceServerAuthError(code as 'invalid_request' | 'invalid_token' | 'insufficient_scope' | 'forbidden', 'missing_bearer', 'test');
    expect(error.getStatus()).toBe(expectedStatus);
  });

  it('OAuthTokenError(invalid_client) still responds 401 — the one token-endpoint code this contract\'s callers most often branch on', () => {
    const error = new OAuthTokenError('invalid_client', 'test');
    expect(error.getStatus()).toBe(401);
  });
});
