import { ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ResourceServerAuthError } from '../../errors';
import { AuthenticatedExternalPrincipal } from '../../interfaces';
import { AuthorizationDecision, ResourceAuthorizationPolicy } from '../interfaces';
import { ResourceAuthorizationPolicyRegistry } from '../services';
import { ResourceAuthorizationGuard } from './resource-authorization.guard';

function principal(overrides: Partial<AuthenticatedExternalPrincipal> = {}): AuthenticatedExternalPrincipal {
  return {
    type: 'SERVICE_ACCOUNT',
    subject: 'sa-1',
    serviceAccountId: 'sa-1',
    clientId: 'cli-1',
    tenantId: 'tenant-1',
    audience: 'demo-api',
    scopes: [],
    jti: 'jti-1',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 900_000),
    issuer: 'https://identity.example.com',
    ...overrides,
  };
}

describe('ResourceAuthorizationGuard (Phase 2D.6)', () => {
  let registry: ResourceAuthorizationPolicyRegistry;

  beforeEach(() => {
    registry = new ResourceAuthorizationPolicyRegistry();
  });

  function guardWith(metadata: unknown) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(metadata) } as unknown as Reflector;
    return new ResourceAuthorizationGuard(reflector, registry);
  }

  const OPTIONS = { productId: 'p-a', resource: 'r', action: 'read' };

  it('denies (401) when no principal is attached — this guard must run after ExternalBearerAuthGuard', async () => {
    const guard = guardWith(OPTIONS);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({}) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ResourceServerAuthError);
  });

  it('fails closed (500) when the route has no @RequireResourceAuthorization metadata — a configuration error, never a silent default', async () => {
    const guard = guardWith(undefined);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ externalPrincipal: principal() }) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('denies (403, forbidden) when no policy is registered for the requested productId', async () => {
    const guard = guardWith(OPTIONS);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ externalPrincipal: principal() }) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('enforces required scopes BEFORE consulting any policy (Layer 5, generic)', async () => {
    const policy: ResourceAuthorizationPolicy = { authorize: jest.fn().mockResolvedValue({ allowed: true }) };
    registry.register('p-a', policy);
    const guard = guardWith({ ...OPTIONS, requiredScopes: ['openid'] });
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ externalPrincipal: principal({ scopes: [] }) }) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'insufficient_scope' });
    expect(policy.authorize).not.toHaveBeenCalled(); // never reached — scope failure is cheaper and checked first
  });

  it('allows through when scopes are satisfied and the registered policy allows', async () => {
    const policy: ResourceAuthorizationPolicy = { authorize: jest.fn().mockResolvedValue({ allowed: true }) };
    registry.register('p-a', policy);
    const guard = guardWith({ ...OPTIONS, requiredScopes: ['openid'] });
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ externalPrincipal: principal({ scopes: ['openid'] }) }) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('denies when the registered policy returns {allowed: false}', async () => {
    const policy: ResourceAuthorizationPolicy = { authorize: jest.fn().mockResolvedValue({ allowed: false, reasonCode: 'no_permission' }) };
    registry.register('p-a', policy);
    const guard = guardWith(OPTIONS);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ externalPrincipal: principal() }) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('treats an ambiguous decision (allowed: undefined/truthy-but-not-true) as a denial, never an accidental allow', async () => {
    const policy: ResourceAuthorizationPolicy = { authorize: jest.fn().mockResolvedValue({} as AuthorizationDecision) };
    registry.register('p-a', policy);
    const guard = guardWith(OPTIONS);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ externalPrincipal: principal() }) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('denies when the registered policy throws — provider error is never treated as success', async () => {
    const policy: ResourceAuthorizationPolicy = { authorize: jest.fn().mockRejectedValue(new Error('boom — some internal product detail')) };
    registry.register('p-a', policy);
    const guard = guardWith(OPTIONS);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ externalPrincipal: principal() }) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    const rejection = guard.canActivate(ctx);
    await expect(rejection).rejects.toMatchObject({ code: 'forbidden' });
    // the underlying error's own message never leaks into the thrown error's response body
    try {
      await rejection;
    } catch (e) {
      const body = (e as ResourceServerAuthError).getResponse() as { error_description: string };
      expect(body.error_description).not.toContain('boom');
      expect(body.error_description).not.toContain('internal product detail');
    }
  });

  it('provider isolation: a policy registered for productId A is never invoked for a request naming productId B', async () => {
    const policyA: ResourceAuthorizationPolicy = { authorize: jest.fn().mockResolvedValue({ allowed: true }) };
    const policyB: ResourceAuthorizationPolicy = { authorize: jest.fn().mockResolvedValue({ allowed: false }) };
    registry.register('p-a', policyA);
    registry.register('p-b', policyB);

    const guardForA = guardWith({ productId: 'p-a', resource: 'r', action: 'read' });
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ externalPrincipal: principal() }) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    await expect(guardForA.canActivate(ctx)).resolves.toBe(true);

    expect(policyA.authorize).toHaveBeenCalledTimes(1);
    expect(policyB.authorize).not.toHaveBeenCalled();
  });

  it('re-registering a policy for the same productId replaces the previous one (last registration wins)', async () => {
    registry.register('p-a', { authorize: jest.fn().mockResolvedValue({ allowed: false }) });
    const replacement: ResourceAuthorizationPolicy = { authorize: jest.fn().mockResolvedValue({ allowed: true }) };
    registry.register('p-a', replacement);

    const guard = guardWith(OPTIONS);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ externalPrincipal: principal() }) }), getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(replacement.authorize).toHaveBeenCalledTimes(1);
  });

  it('an unregistered productId returns undefined from the registry, never a default/fallback policy', () => {
    expect(registry.get('never-registered')).toBeUndefined();
  });
});
