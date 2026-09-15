import { Application } from '@prisma/client';
import { AppException } from '../../../common';
import { ApplicationScopePolicy } from './scope.policy';

function appWith(allowedScopes: string[]): Pick<Application, 'allowedScopes'> {
  return { allowedScopes };
}

describe('ApplicationScopePolicy', () => {
  const policy = new ApplicationScopePolicy();

  describe('validateRequestedScopes (runtime check)', () => {
    it('PASS: a requested scope within the allowed set', () => {
      expect(policy.validateRequestedScopes(appWith(['travel.read']), ['travel.read'])).toBe(true);
    });

    it('DENY: an unknown scope', () => {
      expect(policy.validateRequestedScopes(appWith(['travel.read']), ['travel.admin'])).toBe(false);
    });

    it('DENY: a partially unauthorized scope set (travel.read allowed, travel.admin not)', () => {
      expect(policy.validateRequestedScopes(appWith(['travel.read']), ['travel.read', 'travel.admin'])).toBe(false);
    });

    it('PASS: an empty requested-scope set is trivially satisfied', () => {
      expect(policy.validateRequestedScopes(appWith([]), [])).toBe(true);
    });
  });

  describe('validateScopesForRegistration — namespace ownership', () => {
    it('accepts scopes properly namespaced under the owning product', () => {
      expect(() => policy.validateScopesForRegistration('travelos', ['travelos.read', 'travelos.write'])).not.toThrow();
    });

    it('accepts the standard OIDC scopes regardless of product', () => {
      expect(() => policy.validateScopesForRegistration('travelos', ['openid', 'profile', 'email'])).not.toThrow();
    });

    it("rejects a scope namespaced under a DIFFERENT product", () => {
      expect(() => policy.validateScopesForRegistration('travelos', ['healthcare.read'])).toThrow(AppException);
    });

    it('rejects an un-namespaced, non-standard scope', () => {
      expect(() => policy.validateScopesForRegistration('travelos', ['read'])).toThrow(AppException);
    });

    it('rejects an empty-string scope', () => {
      expect(() => policy.validateScopesForRegistration('travelos', [''])).toThrow(AppException);
    });

    it('rejects duplicate scopes', () => {
      expect(() => policy.validateScopesForRegistration('travelos', ['travelos.read', 'travelos.read'])).toThrow(AppException);
    });
  });
});
