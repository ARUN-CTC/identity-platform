import { deriveOrganizationCode } from './organization-code.util';

describe('deriveOrganizationCode (Phase 2UI.2)', () => {
  it('appends -ORG and upper-cases the tenant code', () => {
    expect(deriveOrganizationCode('fleetops')).toBe('FLEETOPS-ORG');
  });

  it('is deterministic — the same tenantCode always derives the same organizationCode', () => {
    expect(deriveOrganizationCode('fleetops')).toBe(deriveOrganizationCode('fleetops'));
  });

  it('truncates to 30 characters — organization_code is VARCHAR(30) (database/ddl/002_organization.sql)', () => {
    const long = 'a'.repeat(40);
    const result = deriveOrganizationCode(long);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).toBe(`${long}-ORG`.toUpperCase().slice(0, 30));
  });

  it('preserves a mixed-case tenantCode as fully upper-case, never silently lower-cased', () => {
    expect(deriveOrganizationCode('FleetOps')).toBe('FLEETOPS-ORG');
  });
});
