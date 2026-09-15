import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * PHASE 2C — the ONLY client-supplied input to a context switch. Everything
 * else (which tenant this organization belongs to, whether the caller's
 * membership is ACTIVE, whether the organization/tenant themselves are
 * ACTIVE) is resolved and re-validated server-side — see
 * AuthenticationService.switchOrganizationContext().
 */
export class SwitchOrganizationContextDto {
  @ApiProperty({ description: 'The organization to make the active context for this session' })
  @IsUUID()
  organizationId: string;
}
