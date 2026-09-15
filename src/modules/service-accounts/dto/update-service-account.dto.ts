import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type ServiceAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export const SERVICE_ACCOUNT_STATUSES: ServiceAccountStatus[] = ['ACTIVE', 'SUSPENDED', 'DISABLED'];

// No `applicationId` here — ServiceAccount ownership is immutable (Step 13
// of the brief; docs/PHASE_2D3.md). The global ValidationPipe's
// `forbidNonWhitelisted` rejects an attempt to send it in production; the
// repository layer additionally never writes a field this DTO doesn't
// declare (same explicit-allow-list discipline Phase 2D.2's own security
// fix established for Application — see ServiceAccountsRepository.update()).
export class UpdateServiceAccountDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: SERVICE_ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(SERVICE_ACCOUNT_STATUSES)
  status?: ServiceAccountStatus;
}
