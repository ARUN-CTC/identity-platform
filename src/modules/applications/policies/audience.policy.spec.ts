import { Application } from '@prisma/client';
import { AppException } from '../../../common';
import { ApplicationAudiencePolicy } from './audience.policy';

function appWith(audiences: string[]): Pick<Application, 'audiences'> {
  return { audiences };
}

describe('ApplicationAudiencePolicy', () => {
  const policy = new ApplicationAudiencePolicy();

  describe('isAudienceAllowed (runtime check)', () => {
    it('PASS: an allowed audience', () => {
      expect(policy.isAudienceAllowed(appWith(['travel-api']), 'travel-api')).toBe(true);
    });

    it('DENY: a wrong audience', () => {
      expect(policy.isAudienceAllowed(appWith(['travel-api']), 'healthcare-api')).toBe(false);
    });

    it('DENY: nothing allowed by default', () => {
      expect(policy.isAudienceAllowed(appWith([]), 'travel-api')).toBe(false);
    });
  });

  describe('validateAudiencesForRegistration', () => {
    it('accepts a normal audience list', () => {
      expect(() => policy.validateAudiencesForRegistration(['travel-api', 'travel-admin-api'])).not.toThrow();
    });

    it("rejects '*'", () => {
      expect(() => policy.validateAudiencesForRegistration(['*'])).toThrow(AppException);
    });

    it("rejects 'all'/'any' (case-insensitive)", () => {
      expect(() => policy.validateAudiencesForRegistration(['ALL'])).toThrow(AppException);
      expect(() => policy.validateAudiencesForRegistration(['any'])).toThrow(AppException);
    });

    it('rejects an embedded wildcard', () => {
      expect(() => policy.validateAudiencesForRegistration(['travel-*'])).toThrow(AppException);
    });

    it('rejects an empty-string audience', () => {
      expect(() => policy.validateAudiencesForRegistration([''])).toThrow(AppException);
    });

    it('rejects duplicates', () => {
      expect(() => policy.validateAudiencesForRegistration(['travel-api', 'travel-api'])).toThrow(AppException);
    });
  });
});
