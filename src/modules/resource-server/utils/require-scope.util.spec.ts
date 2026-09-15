import { ResourceServerAuthError } from '../errors';
import { hasScope, requireAnyScope, requireScope, requireScopes } from './require-scope.util';

function principalWith(scopes: string[]) {
  return { scopes };
}

describe('Scope evaluation (Phase 2D.6)', () => {
  describe('hasScope — exact matching only', () => {
    it('matches an exact scope', () => {
      expect(hasScope(principalWith(['documents.read']), 'documents.read')).toBe(true);
    });

    it('does not match a missing scope', () => {
      expect(hasScope(principalWith(['documents.read']), 'documents.write')).toBe(false);
    });

    it('does not match a longer scope containing the required one as a prefix ("documents.read.anything" != "documents.read")', () => {
      expect(hasScope(principalWith(['documents.read.anything']), 'documents.read')).toBe(false);
    });

    it('does not match a scope containing the required one as a substring ("documents.readwrite" != "documents.read")', () => {
      expect(hasScope(principalWith(['documents.readwrite']), 'documents.read')).toBe(false);
    });

    it('does not match case-insensitively', () => {
      expect(hasScope(principalWith(['Documents.Read']), 'documents.read')).toBe(false);
    });

    it('duplicate scopes in the token do not change the result', () => {
      expect(hasScope(principalWith(['documents.read', 'documents.read']), 'documents.read')).toBe(true);
    });

    it('an empty scope list never matches anything', () => {
      expect(hasScope(principalWith([]), 'documents.read')).toBe(false);
    });

    it('a malformed (empty-string) scope entry never accidentally matches a real requirement', () => {
      expect(hasScope(principalWith(['']), 'documents.read')).toBe(false);
      expect(hasScope(principalWith(['documents.read']), '')).toBe(false);
    });
  });

  describe('requireScope', () => {
    it('does not throw when the scope is present', () => {
      expect(() => requireScope(principalWith(['a']), 'a')).not.toThrow();
    });

    it('throws ResourceServerAuthError(insufficient_scope) when absent', () => {
      expect(() => requireScope(principalWith(['a']), 'b')).toThrow(ResourceServerAuthError);
      try {
        requireScope(principalWith(['a']), 'b');
      } catch (e) {
        expect((e as ResourceServerAuthError).code).toBe('insufficient_scope');
      }
    });
  });

  describe('requireScopes — explicit AND semantics', () => {
    it('passes when every required scope is present', () => {
      expect(() => requireScopes(principalWith(['a', 'b', 'c']), ['a', 'b'])).not.toThrow();
    });

    it('throws when any one required scope is missing', () => {
      expect(() => requireScopes(principalWith(['a']), ['a', 'b'])).toThrow(ResourceServerAuthError);
    });

    it('an empty requirement list is trivially satisfied', () => {
      expect(() => requireScopes(principalWith([]), [])).not.toThrow();
    });
  });

  describe('requireAnyScope — explicit OR semantics, deliberately separate from requireScopes', () => {
    it('passes when at least one of the listed scopes is present', () => {
      expect(() => requireAnyScope(principalWith(['b']), ['a', 'b', 'c'])).not.toThrow();
    });

    it('throws when none of the listed scopes are present', () => {
      expect(() => requireAnyScope(principalWith(['x']), ['a', 'b', 'c'])).toThrow(ResourceServerAuthError);
    });

    it('an empty "any of" list can never be satisfied — always throws', () => {
      expect(() => requireAnyScope(principalWith(['a', 'b', 'c']), [])).toThrow(ResourceServerAuthError);
    });
  });
});
