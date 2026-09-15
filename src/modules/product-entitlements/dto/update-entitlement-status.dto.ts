import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// REVOKED is reachable here (from ACTIVE or SUSPENDED) — but NOT the
// reverse: reactivating a REVOKED entitlement is a deliberately separate
// endpoint/action (POST .../reactivate), never implicit in a generic PATCH
// (docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md, "Why reactivation is a distinct
// transition").
export type PatchableEntitlementStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
export const PATCHABLE_ENTITLEMENT_STATUSES: PatchableEntitlementStatus[] = ['ACTIVE', 'SUSPENDED', 'REVOKED'];

export class UpdateEntitlementStatusDto {
  @ApiProperty({ enum: PATCHABLE_ENTITLEMENT_STATUSES })
  @IsIn(PATCHABLE_ENTITLEMENT_STATUSES)
  status: PatchableEntitlementStatus;
}
