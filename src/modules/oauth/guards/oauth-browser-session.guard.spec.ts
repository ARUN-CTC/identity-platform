import { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { OAuthBrowserSessionGuard } from './oauth-browser-session.guard';
import type { RequestContextService } from '../../../common';
import type { SessionsRepository } from '../../sessions/repositories';
import type { TokenService } from '../../jwt/services';

/**
 * Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md §6). Pure unit
 * coverage for the guard's decision tree — every DB/JWT dependency is
 * mocked, since the guard's own job is just wiring, not the underlying
 * verification/lookup logic those already have their own tests.
 */
describe('OAuthBrowserSessionGuard', () => {
  const TENANT_ID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
  const USER_ID = 'user-1';
  const SESSION_ID = 'session-1';

  function buildContext(headers: Record<string, string | undefined>, cookies: Record<string, string> = {}): ExecutionContext {
    const req = { headers, cookies } as unknown as Request;
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  function buildDeps() {
    const tokenService = {
      verifyAccessToken: jest.fn(),
      parseBrowserSessionSecret: jest.fn(),
      hashBrowserSessionSecret: jest.fn(),
    } as unknown as jest.Mocked<TokenService>;
    const context = {
      setTenantId: jest.fn(),
      setUserId: jest.fn(),
      setSessionId: jest.fn(),
      setOrganizationId: jest.fn(),
    } as unknown as jest.Mocked<RequestContextService>;
    const sessions = {
      findById: jest.fn(),
      findByBrowserSessionSecretHash: jest.fn(),
    } as unknown as jest.Mocked<SessionsRepository>;
    return { tokenService, context, sessions };
  }

  it('always returns true — it never rejects a request on its own', async () => {
    const { tokenService, context, sessions } = buildDeps();
    const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
    const result = await guard.canActivate(buildContext({}));
    expect(result).toBe(true);
    expect(context.setTenantId).not.toHaveBeenCalled();
  });

  describe('Bearer path', () => {
    it('resolves and populates context on a valid, live token', async () => {
      const { tokenService, context, sessions } = buildDeps();
      tokenService.verifyAccessToken.mockReturnValue({ sub: USER_ID, tenantId: TENANT_ID, sessionId: SESSION_ID, email: 'a@b.com' } as never);
      sessions.findById.mockResolvedValue({ id: SESSION_ID, tenantId: TENANT_ID, revokedAt: null } as never);

      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({ authorization: 'Bearer good-token' }));

      expect(sessions.findById).toHaveBeenCalledWith(TENANT_ID, SESSION_ID);
      expect(context.setTenantId).toHaveBeenCalledWith(TENANT_ID);
      expect(context.setUserId).toHaveBeenCalledWith(USER_ID);
      expect(context.setSessionId).toHaveBeenCalledWith(SESSION_ID);
    });

    it('does not populate context when the token fails verification', async () => {
      const { tokenService, context, sessions } = buildDeps();
      tokenService.verifyAccessToken.mockImplementation(() => {
        throw new Error('bad signature');
      });

      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({ authorization: 'Bearer forged-token' }));

      expect(context.setTenantId).not.toHaveBeenCalled();
    });

    it('does not populate context when the session behind a validly-signed token was revoked (live revocation check, not trust-the-JWT)', async () => {
      const { tokenService, context, sessions } = buildDeps();
      tokenService.verifyAccessToken.mockReturnValue({ sub: USER_ID, tenantId: TENANT_ID, sessionId: SESSION_ID, email: 'a@b.com' } as never);
      sessions.findById.mockResolvedValue({ id: SESSION_ID, tenantId: TENANT_ID, revokedAt: new Date() } as never);

      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({ authorization: 'Bearer stale-token' }));

      expect(context.setTenantId).not.toHaveBeenCalled();
    });

    it('does not populate context when the session no longer exists', async () => {
      const { tokenService, context, sessions } = buildDeps();
      tokenService.verifyAccessToken.mockReturnValue({ sub: USER_ID, tenantId: TENANT_ID, sessionId: SESSION_ID, email: 'a@b.com' } as never);
      sessions.findById.mockResolvedValue(null);

      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({ authorization: 'Bearer deleted-session-token' }));

      expect(context.setTenantId).not.toHaveBeenCalled();
    });

    it('ignores a malformed Authorization header (no Bearer prefix) and falls through to the cookie path', async () => {
      const { tokenService, context, sessions } = buildDeps();
      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({ authorization: 'Basic dXNlcjpwYXNz' }, {}));

      expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
      expect(context.setTenantId).not.toHaveBeenCalled();
    });
  });

  describe('cookie path', () => {
    it('resolves and populates context from a valid browser-session cookie', async () => {
      const { tokenService, context, sessions } = buildDeps();
      tokenService.parseBrowserSessionSecret.mockReturnValue({ tenantId: TENANT_ID, secret: 'the-secret' });
      tokenService.hashBrowserSessionSecret.mockReturnValue('hashed-secret');
      sessions.findByBrowserSessionSecretHash.mockResolvedValue({
        id: SESSION_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        organizationId: null,
      } as never);

      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({}, { identity_browser_session: `${Buffer.from(TENANT_ID).toString('base64url')}.the-secret` }));

      expect(sessions.findByBrowserSessionSecretHash).toHaveBeenCalledWith(TENANT_ID, 'hashed-secret');
      expect(context.setTenantId).toHaveBeenCalledWith(TENANT_ID);
      expect(context.setUserId).toHaveBeenCalledWith(USER_ID);
      expect(context.setSessionId).toHaveBeenCalledWith(SESSION_ID);
    });

    it('is never consulted when a Bearer header already resolved (Bearer takes precedence)', async () => {
      const { tokenService, context, sessions } = buildDeps();
      tokenService.verifyAccessToken.mockReturnValue({ sub: USER_ID, tenantId: TENANT_ID, sessionId: SESSION_ID, email: 'a@b.com' } as never);
      sessions.findById.mockResolvedValue({ id: SESSION_ID, tenantId: TENANT_ID, revokedAt: null } as never);

      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({ authorization: 'Bearer good-token' }, { identity_browser_session: 'should-be-ignored' }));

      expect(tokenService.parseBrowserSessionSecret).not.toHaveBeenCalled();
      expect(sessions.findByBrowserSessionSecretHash).not.toHaveBeenCalled();
    });

    it('does not populate context when no cookie is present', async () => {
      const { tokenService, context, sessions } = buildDeps();
      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({}, {}));

      expect(tokenService.parseBrowserSessionSecret).not.toHaveBeenCalled();
      expect(context.setTenantId).not.toHaveBeenCalled();
    });

    it('does not populate context when the cookie value cannot be parsed (malformed/tampered)', async () => {
      const { tokenService, context, sessions } = buildDeps();
      tokenService.parseBrowserSessionSecret.mockReturnValue(null);

      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({}, { identity_browser_session: 'garbage' }));

      expect(sessions.findByBrowserSessionSecretHash).not.toHaveBeenCalled();
      expect(context.setTenantId).not.toHaveBeenCalled();
    });

    it('does not populate context when no session matches the cookie hash (unknown/expired/revoked)', async () => {
      const { tokenService, context, sessions } = buildDeps();
      tokenService.parseBrowserSessionSecret.mockReturnValue({ tenantId: TENANT_ID, secret: 'the-secret' });
      tokenService.hashBrowserSessionSecret.mockReturnValue('hashed-secret');
      sessions.findByBrowserSessionSecretHash.mockResolvedValue(null);

      const guard = new OAuthBrowserSessionGuard(tokenService, context, sessions);
      await guard.canActivate(buildContext({}, { identity_browser_session: 'looks-valid-but-stale' }));

      expect(context.setTenantId).not.toHaveBeenCalled();
    });
  });
});
