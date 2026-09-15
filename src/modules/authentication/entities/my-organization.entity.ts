import { ApiProperty } from '@nestjs/swagger';

/**
 * PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) — one row of
 * `GET /v1/me/organizations`: an organization this authenticated (global)
 * Identity currently holds an ACTIVE membership in, and could select as
 * their active context via `POST /v1/auth/context/switch`. Deliberately
 * carries both the organization's own status and its tenant's status so a
 * client can grey out/explain a switch target it cannot actually select
 * (organization disabled, tenant suspended) without needing a second call.
 */
export class MyOrganizationEntity {
  @ApiProperty() organizationId: string;
  @ApiProperty() organizationName: string;
  @ApiProperty() organizationStatus: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() tenantCode: string;
  @ApiProperty() tenantName: string;
  @ApiProperty() tenantStatus: string;
  @ApiProperty() membershipStatus: string;
}
