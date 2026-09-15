import { Application } from '@prisma/client';
import { AppException } from '../../../common';
import { ApplicationGrantPolicy } from './grant-type.policy';

function appWith(grantTypes: string[]): Pick<Application, 'grantTypes'> {
  return { grantTypes };
}

describe('ApplicationGrantPolicy', () => {
  const policy = new ApplicationGrantPolicy();

  describe('isGrantTypeAllowed (runtime check)', () => {
    it('PASS: an allowed grant type', () => {
      expect(policy.isGrantTypeAllowed(appWith(['authorization_code']), 'authorization_code')).toBe(true);
    });

    it('DENY: a disallowed grant type', () => {
      expect(policy.isGrantTypeAllowed(appWith(['authorization_code']), 'client_credentials')).toBe(false);
    });

    it('DENY: an unknown grant type', () => {
      expect(policy.isGrantTypeAllowed(appWith(['authorization_code']), 'implicit')).toBe(false);
    });

    it('DENY: an empty grantTypes list allows nothing (deny-by-default)', () => {
      expect(policy.isGrantTypeAllowed(appWith([]), 'authorization_code')).toBe(false);
    });
  });

  describe('validateGrantTypesForRegistration', () => {
    it('accepts a valid single grant type for a CONFIDENTIAL client', () => {
      expect(() => policy.validateGrantTypesForRegistration('CONFIDENTIAL', ['authorization_code'])).not.toThrow();
    });

    it('accepts both approved grant types together for a CONFIDENTIAL client', () => {
      expect(() => policy.validateGrantTypesForRegistration('CONFIDENTIAL', ['authorization_code', 'client_credentials'])).not.toThrow();
    });

    it('accepts an empty list (nothing authorized yet)', () => {
      expect(() => policy.validateGrantTypesForRegistration('CONFIDENTIAL', [])).not.toThrow();
    });

    it('rejects an unsupported grant type (implicit)', () => {
      expect(() => policy.validateGrantTypesForRegistration('CONFIDENTIAL', ['implicit'])).toThrow(AppException);
    });

    it('rejects password (resource-owner password credentials)', () => {
      expect(() => policy.validateGrantTypesForRegistration('CONFIDENTIAL', ['password'])).toThrow(AppException);
    });

    it('rejects device_authorization', () => {
      expect(() => policy.validateGrantTypesForRegistration('CONFIDENTIAL', ['device_authorization'])).toThrow(AppException);
    });

    it('rejects token_exchange', () => {
      expect(() => policy.validateGrantTypesForRegistration('CONFIDENTIAL', ['token_exchange'])).toThrow(AppException);
    });

    it('rejects duplicate grant types', () => {
      expect(() => policy.validateGrantTypesForRegistration('CONFIDENTIAL', ['authorization_code', 'authorization_code'])).toThrow(AppException);
    });

    it('rejects client_credentials for a PUBLIC client (cannot authenticate itself)', () => {
      expect(() => policy.validateGrantTypesForRegistration('PUBLIC', ['client_credentials'])).toThrow(AppException);
    });

    it('accepts authorization_code for a PUBLIC client', () => {
      expect(() => policy.validateGrantTypesForRegistration('PUBLIC', ['authorization_code'])).not.toThrow();
    });
  });
});
