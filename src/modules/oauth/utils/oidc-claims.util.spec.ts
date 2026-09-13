import { mapOidcUserClaims, OidcClaimsUserInput } from './oidc-claims.util';

describe('mapOidcUserClaims (Phase 2D.8)', () => {
  const baseUser: OidcClaimsUserInput = {
    id: 'user-123',
    firstName: 'Ada',
    lastName: 'Lovelace',
    username: 'ada',
    email: 'ada@example.com',
    emailVerifiedAt: null,
  };

  it('returns only sub when no scope beyond openid is granted', () => {
    const claims = mapOidcUserClaims(baseUser, ['openid']);
    expect(claims).toEqual({ sub: 'user-123' });
  });

  it('returns only sub when scopes is empty (defense in depth)', () => {
    const claims = mapOidcUserClaims(baseUser, []);
    expect(claims).toEqual({ sub: 'user-123' });
  });

  it('includes name/given_name/family_name/preferred_username only when profile scope is granted', () => {
    const claims = mapOidcUserClaims(baseUser, ['openid', 'profile']);
    expect(claims.name).toBe('Ada Lovelace');
    expect(claims.given_name).toBe('Ada');
    expect(claims.family_name).toBe('Lovelace');
    expect(claims.preferred_username).toBe('ada');
    expect(claims.email).toBeUndefined();
    expect(claims.email_verified).toBeUndefined();
  });

  it('includes email/email_verified only when email scope is granted', () => {
    const claims = mapOidcUserClaims(baseUser, ['openid', 'email']);
    expect(claims.email).toBe('ada@example.com');
    expect(claims.email_verified).toBe(false);
    expect(claims.name).toBeUndefined();
  });

  it('email_verified reflects emailVerifiedAt !== null — never hardcoded true', () => {
    const verified = mapOidcUserClaims({ ...baseUser, emailVerifiedAt: new Date() }, ['openid', 'email']);
    expect(verified.email_verified).toBe(true);

    const unverified = mapOidcUserClaims({ ...baseUser, emailVerifiedAt: null }, ['openid', 'email']);
    expect(unverified.email_verified).toBe(false);
  });

  it('both profile and email claims are included when both scopes are granted', () => {
    const claims = mapOidcUserClaims(baseUser, ['openid', 'profile', 'email']);
    expect(claims).toEqual({
      sub: 'user-123',
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
      preferred_username: 'ada',
      email: 'ada@example.com',
      email_verified: false,
    });
  });

  it('omits name when both firstName and lastName are null, even with profile scope', () => {
    const claims = mapOidcUserClaims({ ...baseUser, firstName: null, lastName: null, username: null }, ['profile']);
    expect(claims).toEqual({ sub: 'user-123' });
  });

  it('never leaks fields outside the OidcUserClaims shape (no accidental passthrough)', () => {
    const claims = mapOidcUserClaims(baseUser, ['openid', 'profile', 'email']);
    expect(Object.keys(claims).sort()).toEqual(['email', 'email_verified', 'family_name', 'given_name', 'name', 'preferred_username', 'sub'].sort());
  });
});
