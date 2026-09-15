import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** tenantId comes from the URL path (/platform/tenants/:tenantId/service-account-grants) — never trusted from the body, same discipline every platform-tenant-admin endpoint in this codebase already uses. */
export class CreateTenantGrantDto {
  @ApiProperty({ description: 'The ServiceAccount being granted authorization to act on this Tenant.' })
  @IsUUID()
  serviceAccountId: string;
}
