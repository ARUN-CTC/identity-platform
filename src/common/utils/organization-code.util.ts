/**
 * Phase 2UI.2 (docs/TENANT_BOOTSTRAP.md) — the default `organization_code`
 * TenantBootstrapService derives when the caller doesn't supply one
 * explicitly. Extracted as a pure function (rather than a private method on
 * the service) so it has its own direct unit-test coverage, matching this
 * codebase's own established split: pure logic gets a unit test,
 * DB/transaction-dependent logic gets e2e coverage against the real
 * database (see client-credential.util.ts for the same pattern applied to
 * client_secret generation).
 *
 * VARCHAR(30) is organization_code's actual column width
 * (database/ddl/002_organization.sql) — truncating here, rather than
 * letting a long tenantCode overflow into a DB error, keeps the failure
 * mode a clean, predictable code value instead of an unexpected 500.
 */
export function deriveOrganizationCode(tenantCode: string): string {
  return `${tenantCode}-ORG`.toUpperCase().slice(0, 30);
}
