import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// REVOKED is reachable here (from ACTIVE or SUSPENDED) — but NOT the
// reverse: reactivating a REVOKED grant is a deliberately separate
// endpoint/action (POST .../reactivate), never implicit in a generic PATCH
// — the exact same discipline docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md already
// established for TenantProductEntitlement, reused here rather than
// reinvented (Step 16 of the brief: "REVOKED must never be treated as
// equivalent to ACTIVE").
export type PatchableGrantStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
export const PATCHABLE_GRANT_STATUSES: PatchableGrantStatus[] = ['ACTIVE', 'SUSPENDED', 'REVOKED'];

export class UpdateTenantGrantStatusDto {
  @ApiProperty({ enum: PATCHABLE_GRANT_STATUSES })
  @IsIn(PATCHABLE_GRANT_STATUSES)
  status: PatchableGrantStatus;
}
